import { copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import type { AgentInstallStatus } from '../shared/mcp.ts'
import { isCampusConnector, isRecord, readAgentConfig, writeAgentConfig } from './agent-config.ts'
import { inspectAgentKey, saveAgentKey } from './windows-agent-key.ts'

const extensionId = 'XJTLU-MCP'
const legacyExtensionId = 'xjtlu-campus'
const configNames = ['config.json', 'mimocode.json', 'mimocode.jsonc']

function configDir(): string {
  return process.env.MIMOCODE_CONFIG_DIR?.trim() || join(homedir(), '.config', 'mimocode')
}

function registryPath(): string {
  return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Xiaomi MiMo', 'extensions.json')
}

async function readConfigs(directory: string) {
  return Promise.all(configNames.map(async name => {
    const path = join(directory, name)
    const original = await readAgentConfig(path)
    const body = original?.replace(/^\uFEFF/, '') ?? '{}\n'
    const errors: ParseError[] = []
    const config: unknown = parse(body, errors, { allowTrailingComma: true })
    if (errors.length || !isRecord(config) || (config.mcp !== undefined && !isRecord(config.mcp))) {
      throw new Error(`无法解析 MiMo Code 的 ${name}。`)
    }
    const entry = config.mcp?.xjtlu
    return { path, original, body, entry }
  }))
}

function extensionMatches(value: unknown): boolean {
  return isRecord(value) && (value.id === extensionId || value.id === legacyExtensionId) && value.origin === 'local' && isRecord(value.placements)
    && Array.isArray(value.placements.mcpKeys) && value.placements.mcpKeys.includes('xjtlu')
}

async function readRegistry(path: string) {
  const original = await readAgentConfig(path)
  if (original === undefined) return null
  let registry: unknown
  try { registry = JSON.parse(original.replace(/^\uFEFF/, '')) } catch { throw new Error('无法解析 MiMo 插件登记。') }
  if (!isRecord(registry) || !Array.isArray(registry.extensions)) throw new Error('MiMo 插件登记格式无效。')
  return { original, registry, entries: registry.extensions as unknown[] }
}

async function updateRegistry(path: string, state: NonNullable<Awaited<ReturnType<typeof readRegistry>>>, entries: unknown[]): Promise<void> {
  const generation = typeof state.registry.generation === 'number' ? state.registry.generation : 0
  const next = { ...state.registry, generation: generation + 1, extensions: entries }
  await writeAgentConfig(path, state.original, `${JSON.stringify(next, null, 2)}\n`)
}

function editConnector(config: Awaited<ReturnType<typeof readConfigs>>[number], entry: unknown): Promise<void> {
  const eol = config.body.includes('\r\n') ? '\r\n' : '\n'
  const edits = modify(config.body, ['mcp', 'xjtlu'], entry, { formattingOptions: { insertSpaces: true, tabSize: 2, eol } })
  const bom = config.original?.startsWith('\uFEFF') ? '\uFEFF' : ''
  return writeAgentConfig(config.path, config.original, bom + applyEdits(config.body, edits))
}

export async function inspectMimoAgent(token: string, version: string): Promise<AgentInstallStatus> {
  const directory = configDir()
  const path = registryPath()
  const locations = [{ label: '配置目录', path: directory }, { label: '插件登记', path }]
  const [configs, registry] = await Promise.allSettled([readConfigs(directory), readRegistry(path)])
  const owned = configs.status === 'fulfilled' ? configs.value.filter(config => isCampusConnector(config.entry)) : []
  if (owned.length) locations[0] = { label: '配置文件', path: owned.at(-1)!.path }
  const extension = registry.status === 'fulfilled' ? registry.value?.entries.find(extensionMatches) : undefined
  const installedVersion = isRecord(extension) && typeof extension.version === 'string' ? extension.version : undefined
  const removable = Boolean(owned.length || extension)
  if (configs.status === 'rejected' || registry.status === 'rejected') {
    return { installation: 'unknown', detail: '无法读取 MiMo 配置或插件登记。', version: installedVersion, locations, removable }
  }
  const effective = configs.value.filter(config => config.entry !== undefined).at(-1)
  if (effective && !isCampusConnector(effective.entry)) {
    return { installation: 'partial', detail: '已有同名连接器指向其他服务。', version: installedVersion, locations, removable }
  }
  const pairing = effective ? await inspectAgentKey(token) : undefined
  if (effective && extension) {
    const needsUpdate = installedVersion !== version || (isRecord(extension) && extension.id === legacyExtensionId)
    const detail = isRecord(extension) && extension.enabled === false ? '插件在 MiMo 中已停用。'
      : needsUpdate ? `可更新至 XJTLU-MCP v${version}，点击重新安装即可更新。` : '已登记到 MiMo 插件列表。'
    return { installation: 'installed', pairing, detail, version: installedVersion, locations, removable }
  }
  if (removable) return { installation: 'partial', pairing, detail: '客户端配置或插件登记尚未完成。', version: installedVersion, locations, removable }
  return { installation: 'not-installed', locations, removable }
}

export async function saveMimoInstall(token: string, url: string, version: string): Promise<void> {
  if (process.platform !== 'win32' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('MiMo Code 安装不可用。')
  const directory = configDir()
  const path = registryPath()
  const [configs, registry] = await Promise.all([readConfigs(directory), readRegistry(path)])
  if (!registry) throw new Error('请先安装并启动一次 MiMo Desktop。')
  const effective = configs.filter(config => config.entry !== undefined).at(-1)
  if (effective && !isCampusConnector(effective.entry)) throw new Error('MiMo 中已有同名连接器指向其他服务。')
  const sameName = registry.entries.find(entry => isRecord(entry) && entry.id === extensionId)
  if (sameName && !extensionMatches(sameName)) throw new Error('MiMo 中已有同名插件。')
  const registered = sameName ?? registry.entries.find(extensionMatches)
  const target = effective ?? configs.filter(config => config.original !== undefined).at(-1) ?? configs[1]
  const entry = { type: 'remote', url, oauth: false, enabled: true, headers: { Authorization: 'Bearer {env:XJTLU_MCP_TOKEN}' } }
  if (!isDeepStrictEqual(target.entry, entry)) await editConnector(target, entry)
  await saveAgentKey(token)
  if (!registered) await copyFile(path, `${path}.bak-before-xjtlu`)
  if (isRecord(registered) && registered.id === extensionId && registered.version === version && registered.enabled === true
    && !registry.entries.some(item => isRecord(item) && item.id === legacyExtensionId && extensionMatches(item))) return
  const extension = { id: extensionId, kind: 'plugin', origin: 'local', version, enabled: true, installedAt: Date.now(),
    authKeys: [], requiredSecretKeys: [], placements: { skillDirs: [], mcpKeys: ['xjtlu'], secretKeys: [], stateKeys: [`plugin:${extensionId}`], engineSkillNames: [] } }
  const entries = registry.entries.filter(item => !extensionMatches(item))
  await updateRegistry(path, registry, [...entries, extension])
}

export async function uninstallMimo(): Promise<void> {
  const path = registryPath()
  const [configs, registry] = await Promise.all([readConfigs(configDir()), readRegistry(path)])
  for (const config of configs) {
    if (isCampusConnector(config.entry)) await editConnector(config, undefined)
  }
  if (registry) {
    const kept = registry.entries.filter(entry => !extensionMatches(entry))
    if (kept.length !== registry.entries.length) await updateRegistry(path, registry, kept)
  }
}
