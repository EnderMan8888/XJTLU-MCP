import { execFile } from 'node:child_process'
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { AgentInstallStatus } from '../shared/mcp.ts'
import { inspectAgentKey, saveAgentKey } from './windows-agent-key.ts'

const run = promisify(execFile)
const marketplaceName = 'xjtlu-local'
const pluginName = 'xjtlu-campus'
const pluginId = `${pluginName}@${marketplaceName}`
const marketplaceFile = '.agents/plugins/marketplace.json'
const manifestFile = `plugins/${pluginName}/.codex-plugin/plugin.json`
const mcpFile = '.mcp.json'
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const options = { windowsHide: true, timeout: 10_000 }
const installationList = z.object({
  installed: z.array(z.object({ pluginId: z.string(), enabled: z.boolean(), version: z.string().nullish() }))
})
const marketplaceList = z.object({ marketplaces: z.array(z.object({ name: z.string(), root: z.string() })) })
const installResult = z.object({ pluginId: z.string(), version: z.string() })

async function findCodex(): Promise<string> {
  if (process.platform !== 'win32') throw new Error('本机 Codex 插件只支持 Windows。')
  const command = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    "$cli=Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
    'if ($cli) { [Console]::WriteLine($cli.Source); exit 0 }',
    "$app=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1",
    "if ($app) { [Console]::WriteLine((Join-Path $app.InstallLocation 'app\\resources\\codex.exe')); exit 0 }",
    'exit 1'
  ].join('; ')
  const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], options)
  const executable = stdout.trim()
  await access(executable)
  return executable
}

export async function codexPluginLink(catalog: string, appPath: string): Promise<string> {
  const marketplace = join(await availableCatalog(catalog, appPath), marketplaceFile)
  await access(marketplace)
  const link = new URL(`codex://plugins/${pluginName}`)
  link.searchParams.set('marketplacePath', marketplace)
  return link.href
}

async function availableCatalog(catalog: string, appPath: string): Promise<string> {
  return await access(join(catalog, marketplaceFile)).then(() => catalog, () => join(appPath, 'codex-plugin'))
}

async function stageCodexMarketplace(catalog: string, appPath: string, version: string): Promise<void> {
  const source = join(appPath, 'codex-plugin')
  const files = [manifestFile, `plugins/${pluginName}/${mcpFile}`, marketplaceFile]
  const contents = await Promise.all(files.map(file => readFile(join(source, file), 'utf8')))
  const manifest = JSON.parse(contents[0])
  contents[0] = `${JSON.stringify({ ...manifest, version }, null, 2)}\n`
  for (const [index, file] of files.entries()) {
    const destination = join(catalog, file)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents[index])
  }
}

async function registerCodexMarketplace(executable: string, catalog: string): Promise<void> {
  // Codex can add the new catalog even when an old location makes listing fail.
  const listed = await listCodexMarketplaces(executable).catch(() => undefined)
  const previous = listed?.marketplaces.find(entry => entry.name === marketplaceName)
  if (previous && resolve(previous.root).toLowerCase() === resolve(catalog).toLowerCase()) return
  if (previous) await run(executable, ['plugin', 'marketplace', 'remove', marketplaceName, '--json'], options)
  try {
    await run(executable, ['plugin', 'marketplace', 'add', catalog, '--json'], options)
  } catch (error) {
    if (previous) await run(executable, ['plugin', 'marketplace', 'add', previous.root, '--json'], options).catch(() => {})
    throw error
  }
}

async function listCodexMarketplaces(executable: string): Promise<z.infer<typeof marketplaceList>> {
  const { stdout } = await run(executable, ['plugin', 'marketplace', 'list', '--json'], options)
  return marketplaceList.parse(JSON.parse(stdout))
}

export async function inspectCodexAgent(catalog: string, appPath: string, token: string, version: string): Promise<AgentInstallStatus> {
  const status: AgentInstallStatus = { installation: 'unknown', locations: [], removable: false }
  const executable = await findCodex().catch(() => null)
  if (!executable) return { ...status, detail: '未找到本机 Codex。' }

  // Include the local catalog for this invocation even if the plugin was
  // previously installed by deep link. This does not persist the override.
  const root = await availableCatalog(catalog, appPath)
  const catalogOverride = `marketplaces.${marketplaceName}={source_type="local",source=${JSON.stringify(root)}}`
  const [installed, catalogs] = await Promise.allSettled([
    run(executable, ['plugin', 'list', '--marketplace', marketplaceName, '--json', '-c', catalogOverride], options)
      .then(({ stdout }) => installationList.parse(JSON.parse(stdout))),
    listCodexMarketplaces(executable)
  ])
  const registered = catalogs.status === 'fulfilled' ? catalogs.value.marketplaces.find(entry => entry.name === marketplaceName) : undefined
  const registeredRoot = registered && await access(join(registered.root, marketplaceFile)).then(() => registered.root, () => undefined)
  status.locations.push({ label: '插件来源', path: registeredRoot ?? root })
  if (catalogs.status === 'rejected' || (registered && !registeredRoot)) {
    status.detail = '现有插件目录无法核对，点击安装可重新登记。'
  }
  if (installed.status !== 'fulfilled') return status
  const plugin = installed.value.installed.find(entry => entry.pluginId === pluginId)
  if (!plugin) return { ...status, installation: 'not-installed' }
  let needsKeyMigration = false
  if (plugin.version && /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(plugin.version)) {
    const cache = join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'plugins', 'cache', marketplaceName, pluginName, plugin.version)
    if (await access(cache).then(() => true, () => false)) {
      status.locations.unshift({ label: '插件目录', path: cache })
      needsKeyMigration = await readFile(join(cache, mcpFile), 'utf8')
        .then(text => JSON.parse(text)?.mcpServers?.[pluginName]?.bearer_token_env_var === 'XJTLU_CODEX_MCP_TOKEN')
        .catch(() => false)
    }
  }
  const detail = status.detail ?? (needsKeyMigration ? '插件仍引用旧的密钥变量，点击重新安装即可改用共享密钥。'
    : plugin.version !== version ? `可更新至 v${version}，点击重新安装即可更新。`
    : registered ? undefined : '插件目录尚未登记，重新安装即可登记。')
  return { ...status, installation: plugin.enabled ? 'installed' : 'disabled', version: plugin.version ?? undefined,
    pairing: needsKeyMigration ? 'outdated' : await inspectAgentKey(token), detail, removable: true }
}

export async function installCodexAgent(catalog: string, appPath: string, token: string, version: string): Promise<void> {
  const executable = await findCodex().catch(() => { throw new Error('未找到本机 Codex。') })
  await saveAgentKey(token)
  try {
    await stageCodexMarketplace(catalog, appPath, version)
    await registerCodexMarketplace(executable, catalog)
    const { stdout } = await run(executable, ['plugin', 'add', pluginId, '--json'], options)
    const installed = installResult.parse(JSON.parse(stdout))
    if (installed.pluginId !== pluginId || installed.version !== version) throw new Error('插件版本不匹配。')
  } catch {
    throw new Error('无法安装 XJTLU-MCP 插件。请确认本机 Codex 和插件目录可用。')
  }
}

export async function uninstallCodexAgent(): Promise<void> {
  const executable = await findCodex().catch(() => { throw new Error('未找到本机 Codex。') })
  await run(executable, ['plugin', 'remove', pluginId, '--json'], options).catch(() => {
    throw new Error('无法卸载 XJTLU-MCP 插件。请在 ChatGPT 插件页核对安装状态。')
  })
}

export async function cleanupCodexAgent(catalog: string): Promise<boolean> {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  const cache = join(home, 'plugins', 'cache', marketplaceName, pluginName)
  const config = await readFile(join(home, 'config.toml'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return ''
  })
  const present = await access(cache).then(() => true, () => false)
  const registered = config.includes(marketplaceName)
  if (!registered && !present && !await access(catalog).then(() => true, () => false)) return false
  if (registered || present) {
    const executable = await findCodex()
    const { stdout } = await run(executable, ['plugin', 'list', '--json'], options)
    if (installationList.parse(JSON.parse(stdout)).installed.some(entry => entry.pluginId === pluginId) || present) {
      await uninstallCodexAgent()
    }
    if ((await listCodexMarketplaces(executable)).marketplaces.some(entry => entry.name === marketplaceName)) {
      await run(executable, ['plugin', 'marketplace', 'remove', marketplaceName, '--json'], options)
      if ((await listCodexMarketplaces(executable)).marketplaces.some(entry => entry.name === marketplaceName)) throw new Error('Codex 插件目录仍在登记中。')
    }
    if (await access(cache).then(() => true, () => false)) {
      if ((await readdir(cache)).length) throw new Error('Codex 插件缓存仍在使用。')
    }
  }
  await rm(catalog, { recursive: true, force: true })
  return true
}

export async function migrateCodexMarketplace(catalog: string, appPath: string, version: string): Promise<void> {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  const config = await readFile(join(home, 'config.toml'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return ''
  })
  if (!config.includes(marketplaceName)) return
  const executable = await findCodex().catch(() => null)
  if (!executable) return
  const current = (await listCodexMarketplaces(executable)).marketplaces.find(entry => entry.name === marketplaceName)
  if (!current || resolve(current.root).toLowerCase() === resolve(catalog).toLowerCase()) return
  await stageCodexMarketplace(catalog, appPath, version)
  await registerCodexMarketplace(executable, catalog)
}
