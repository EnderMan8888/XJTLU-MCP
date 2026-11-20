import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { CodexPairingStatus, CodexPluginStatus } from '../shared/mcp.ts'

const run = promisify(execFile)
const marketplaceName = 'xjtlu-local'
const pluginId = `xjtlu-campus@${marketplaceName}`
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const options = { windowsHide: true, timeout: 10_000 }
const installationList = z.object({
  installed: z.array(z.object({ pluginId: z.string(), enabled: z.boolean(), version: z.string().nullish() }))
})
const marketplaceList = z.object({ marketplaces: z.array(z.object({ name: z.string() })) })
const pairingStates = z.enum(['paired', 'unpaired', 'outdated', 'stored'])

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

export async function codexPluginLink(appPath: string): Promise<string> {
  const marketplace = join(appPath, 'codex-plugin', '.agents', 'plugins', 'marketplace.json')
  await access(marketplace)
  const link = new URL('codex://plugins/xjtlu-campus')
  link.searchParams.set('marketplacePath', marketplace)
  return link.href
}

export async function registerCodexMarketplace(appPath: string): Promise<void> {
  const executable = await findCodex()
  const listed = await listCodexMarketplaces(executable).catch(() => null)
  if (listed?.marketplaces.some(entry => entry.name === marketplaceName)) return
  await run(executable, ['plugin', 'marketplace', 'add', join(appPath, 'codex-plugin'), '--json'], options)
}

async function listCodexMarketplaces(executable: string): Promise<z.infer<typeof marketplaceList>> {
  const { stdout } = await run(executable, ['plugin', 'marketplace', 'list', '--json'], options)
  return marketplaceList.parse(JSON.parse(stdout))
}

export async function inspectCodexPlugin(appPath: string): Promise<Omit<CodexPluginStatus, 'pairing'>> {
  const status: Omit<CodexPluginStatus, 'pairing'> = { installation: 'unknown', marketplace: 'unknown', version: null }
  const executable = await findCodex().catch(() => null)
  if (!executable) return status

  // Include the local catalog for this invocation even if the plugin was
  // previously installed by deep link. This does not persist the override.
  const root = join(appPath, 'codex-plugin')
  const catalogOverride = `marketplaces.${marketplaceName}={source_type="local",source=${JSON.stringify(root)}}`
  const [installed, catalogs] = await Promise.allSettled([
    run(executable, ['plugin', 'list', '--marketplace', marketplaceName, '--json', '-c', catalogOverride], options)
      .then(({ stdout }) => installationList.parse(JSON.parse(stdout))),
    listCodexMarketplaces(executable)
  ])
  if (installed.status === 'fulfilled') {
    const plugin = installed.value.installed.find(entry => entry.pluginId === pluginId)
    status.installation = plugin ? (plugin.enabled ? 'enabled' : 'disabled') : 'not-installed'
    status.version = plugin?.version ?? null
  }
  if (catalogs.status === 'fulfilled') {
    status.marketplace = catalogs.value.marketplaces.some(entry => entry.name === marketplaceName) ? 'registered' : 'unregistered'
  }
  return status
}

function runPairingCommand(command: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Keep the key out of the command line, stdout and renderer.
    const child = execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], options, (error, stdout) => {
      if (error) reject(new Error('无法访问本机 Codex 配对密钥。'))
      else resolve(stdout.trim())
    })
    child.stdin?.on('error', () => { /* A failed child reports an error through execFile. */ })
    child.stdin?.end(token + '\n')
  })
}

export async function inspectCodexPairing(token: string): Promise<CodexPairingStatus> {
  if (process.platform !== 'win32') return 'unknown'
  const command = [
    "$ErrorActionPreference='Stop'",
    '$key=[Console]::In.ReadLine()',
    "$stored=[Environment]::GetEnvironmentVariable('XJTLU_CODEX_MCP_TOKEN',[EnvironmentVariableTarget]::User)",
    "if (!$stored) { 'unpaired' } elseif (!$key) { 'stored' } elseif ($stored -ceq $key) { 'paired' } else { 'outdated' }"
  ].join('; ')
  const result = await runPairingCommand(command, token).catch(() => '')
  return pairingStates.safeParse(result).data ?? 'unknown'
}

export async function saveCodexPairingKey(token: string): Promise<void> {
  if (process.platform !== 'win32' || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('本机 Codex 插件配对不可用。')
  }
  const command = [
    "$ErrorActionPreference='Stop'",
    '$key=[Console]::In.ReadLine()',
    "if ($key -cnotmatch '\\A[0-9a-f]{64}\\z') { exit 2 }",
    "[Environment]::SetEnvironmentVariable('XJTLU_CODEX_MCP_TOKEN',$key,[EnvironmentVariableTarget]::User)"
  ].join('; ')
  await runPairingCommand(command, token)
}
