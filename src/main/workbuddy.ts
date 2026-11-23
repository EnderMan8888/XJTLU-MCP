import { copyFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { AgentInstallStatus, CodexPairingStatus, WorkbuddyInstallStatus, WorkbuddyTrustStatus } from '../shared/mcp.ts'
import { MCP_PORT } from '../mcp/server.ts'
import { isCampusConnector, isRecord, readAgentConfig, writeAgentConfig } from './agent-config.ts'

// WorkBuddy 只从用户配置目录的 mcp.json 读取自定义 MCP 服务；
// 该目录同样支持 WORKBUDDY_CONFIG_DIR / CODEBUDDY_CONFIG_DIR 覆盖，便于隔离验证。
const serverName = 'xjtlu'
const endpoint = `http://127.0.0.1:${MCP_PORT}/mcp`
const serviceOrigin = new URL(endpoint).origin

function configDir(): string {
  return process.env.WORKBUDDY_CONFIG_DIR?.trim()
    || process.env.CODEBUDDY_CONFIG_DIR?.trim()
    || join(homedir(), '.workbuddy')
}

function configPath(): string {
  return join(configDir(), 'mcp.json')
}

// WorkBuddy 把"已信任"记录在 mcp-approvals.json：键为 sha256(服务地址 origin)::服务名。
// 该值只用于界面提示，写入仍由用户在客户端点「信任」完成。
function approvalsPath(): string {
  return join(configDir(), 'mcp-approvals.json')
}

function approvalKey(): string {
  return `${createHash('sha256').update(serviceOrigin).digest('hex')}::${serverName}`
}

function configEntry(token: string): Record<string, unknown> {
  return {
    type: 'streamableHttp',
    url: endpoint,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30_000
  }
}

function parseConfig(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

type ReadResult = { kind: 'ok'; value: Record<string, unknown>; original: string } | { kind: 'missing' } | { kind: 'invalid' }

async function readConfig(path = configPath()): Promise<ReadResult> {
  try {
    const original = await readAgentConfig(path)
    if (original === undefined) return { kind: 'missing' }
    const value = parseConfig(original)
    return value && (value.mcpServers === undefined || isRecord(value.mcpServers))
      ? { kind: 'ok', value, original } : { kind: 'invalid' }
  } catch { return { kind: 'invalid' } }
}

function entryOf(config: Record<string, unknown>): Record<string, unknown> | null {
  const servers = config.mcpServers
  if (!isRecord(servers)) return null
  const entry = servers[serverName]
  return isRecord(entry) ? entry : null
}

function pairingOf(entry: Record<string, unknown> | null, token: string): CodexPairingStatus {
  if (!entry) return 'unpaired'
  const headers = isRecord(entry.headers) ? entry.headers : null
  const authorization = typeof headers?.Authorization === 'string' ? headers.Authorization : ''
  if (!token) return authorization ? 'stored' : 'unpaired'
  return authorization === `Bearer ${token}` ? 'paired' : 'outdated'
}

async function trustStatus(): Promise<WorkbuddyTrustStatus> {
  try {
    const parsed = parseConfig(await readFile(approvalsPath(), 'utf8'))
    if (!parsed) return 'unknown'
    return Object.hasOwn(parsed, approvalKey()) ? 'approved' : 'pending'
  } catch (error) {
    // 尚无信任记录文件时说明客户端从未确认过该地址，按待确认处理。
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'pending' : 'unknown'
  }
}

export async function inspectWorkbuddyInstall(token: string): Promise<WorkbuddyInstallStatus> {
  if (process.platform !== 'win32') return { config: 'unknown', pairing: 'unknown', trust: 'unknown' }
  const [result, trust] = await Promise.all([readConfig(), trustStatus()])
  const entry = result.kind === 'ok' ? entryOf(result.value) : null
  return { config: result.kind === 'invalid' ? 'invalid' : entry ? 'written' : 'missing', pairing: pairingOf(entry, token), trust }
}

export async function inspectWorkbuddyAgent(token: string): Promise<AgentInstallStatus> {
  const path = configPath()
  const result = await readConfig(path)
  const locations = [{ label: '配置文件', path }]
  if (result.kind === 'invalid') return { installation: 'unknown', detail: '无法读取 WorkBuddy 配置。', locations, removable: false }
  const entry = result.kind === 'ok' ? entryOf(result.value) : null
  if (isCampusConnector(entry)) {
    const trust = await trustStatus()
    return { installation: 'installed', pairing: pairingOf(entry, token), locations, removable: true,
      detail: trust === 'pending' ? '首次连接请在 WorkBuddy 中确认信任。' : undefined }
  }
  if (entry) return { installation: 'partial', detail: '已有同名连接器指向其他服务。', locations, removable: false }
  return { installation: 'not-installed', locations, removable: false }
}

export async function saveWorkbuddyInstall(token: string): Promise<WorkbuddyInstallStatus> {
  if (process.platform !== 'win32') throw new Error('WorkBuddy 接入目前只支持 Windows。')
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('访问密钥格式不正确，请从「Agent 连接」重新复制。')
  const path = configPath()
  let existing: Record<string, unknown> = {}
  const result = await readConfig(path)
  if (result.kind === 'invalid') throw new Error('WorkBuddy 的 mcp.json 无法解析，请先手动修正该文件。')
  if (result.kind === 'ok') {
    existing = result.value
    const servers = isRecord(existing.mcpServers) ? existing.mcpServers : {}
    // 只在首次写入该服务且文件原本存在时留一份可回退的副本。
    if (!(serverName in servers)) {
      try { await copyFile(path, `${path}.bak-before-xjtlu`) } catch { /* 备份失败不阻断接入 */ }
    }
  }
  const servers = isRecord(existing.mcpServers) ? existing.mcpServers : {}
  existing.mcpServers = { ...servers, [serverName]: configEntry(token) }
  await writeAgentConfig(path, result.kind === 'ok' ? result.original : undefined, `${JSON.stringify(existing, null, 2)}\n`)
  return inspectWorkbuddyInstall(token)
}

export async function uninstallWorkbuddy(): Promise<boolean> {
  const path = configPath()
  const result = await readConfig(path)
  if (result.kind === 'invalid') throw new Error('WorkBuddy 的 mcp.json 无法解析。')
  const entry = result.kind === 'ok' ? entryOf(result.value) : null
  if (entry && !isCampusConnector(entry)) return false
  const approvals = await readAgentConfig(approvalsPath())
  const trusted = approvals === undefined ? {} : parseConfig(approvals)
  if (!trusted) throw new Error('WorkBuddy 的信任记录无法解析。')
  if (result.kind === 'ok' && entry) {
    const servers = result.value.mcpServers as Record<string, unknown>
    delete servers[serverName]
    await writeAgentConfig(path, result.original, `${JSON.stringify(result.value, null, 2)}\n`)
  }
  const key = approvalKey()
  if (Object.hasOwn(trusted, key)) {
    delete trusted[key]
    await writeAgentConfig(approvalsPath(), approvals, `${JSON.stringify(trusted, null, 2)}\n`)
    return true
  }
  return Boolean(entry)
}
