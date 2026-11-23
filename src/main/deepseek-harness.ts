import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentInstallStatus, CodexPairingStatus } from '../shared/mcp.ts'
import bundleManifest from './assets/deepseek-harness/xjtlu-mcp/package.json'
import bundleEntry from './assets/deepseek-harness/xjtlu-mcp/index.js?raw'
import bundlePatch from './assets/deepseek-harness/xjtlu-mcp/cordis.patch.yml?raw'
import bundleIcon from './assets/deepseek-harness/xjtlu-mcp/icon.svg?raw'
import bundleEnglish from './assets/deepseek-harness/xjtlu-mcp/locale/en.json?raw'
import bundleChinese from './assets/deepseek-harness/xjtlu-mcp/locale/zh.json?raw'

const run = promisify(execFile)
const bundleName = '@local/xjtlu-mcp'
const keyRef = 'XJTLU_MCP_TOKEN'
const bundleFiles = {
  'index.js': bundleEntry,
  'cordis.patch.yml': bundlePatch,
  'icon.svg': bundleIcon,
  'locale/en.json': bundleEnglish,
  'locale/zh.json': bundleChinese
}

async function currentBundleAssets(location: string): Promise<boolean> {
  const matches = await Promise.all(Object.entries(bundleFiles).map(async ([file, contents]) =>
    await readFile(join(location, file), 'utf8').catch(() => null) === contents))
  return matches.every(Boolean)
}

function harnessHome(): string {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

function installedHarness(appData: string): string | undefined {
  const localPrograms = join(dirname(appData), 'Local', 'Programs')
  const roots = [localPrograms, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
  for (const base of roots) {
    if (!base) continue
    const folder = join(base, 'DeepSeek Harness')
    if (existsSync(join(folder, 'DeepSeek Harness.exe')) &&
        existsSync(join(folder, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))) return folder
  }
}

function desktopProfile(): string { return join(harnessHome(), 'profiles', 'desktop') }

async function readBundle(profile: string) {
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  const bundles: unknown = manifest.dsh?.profile?.bundles
  const enabled = Array.isArray(bundles) && bundles.includes(bundleName)
  const location = join(profile, 'node_modules', bundleName)
  let version: string | undefined
  try {
    const installed = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'))
    if (installed.name === bundleName && typeof installed.version === 'string') version = installed.version
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { enabled, version, location }
}

function deepseekEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  delete env[keyRef]
  return env
}

async function manageBundle(harness: string, args: string[], failure: string): Promise<void> {
  // Mirrors the bundled dsh.cmd, with each argument passed directly to the executable.
  const cli = join(harness, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  await run(join(harness, 'DeepSeek Harness.exe'),
    ['--expose-internals', cli, 'plugin', '--profile', 'desktop', ...args, '--reporter=append-only'],
    { env: { ...deepseekEnvironment(), npm_config_offline: 'true', npm_config_ignore_scripts: 'true' },
      windowsHide: true, timeout: 125_000 }).catch(() => { throw new Error(failure) })
}

export async function inspectDeepseekAgent(appData: string, token: string, currentVersion: string): Promise<AgentInstallStatus> {
  const harness = installedHarness(appData)
  const profile = desktopProfile()
  if (!harness || !existsSync(join(profile, 'package.json'))) return {
    installation: 'not-installed', locations: [], removable: false,
    detail: harness ? '请先打开一次 DeepSeek Harness。' : '未找到 DeepSeek Harness 桌面端。'
  }
  const { enabled, version, location } = await readBundle(profile)
  const locations = version ? [{ label: '插件目录', path: location }] : []
  if (enabled && version) {
    const value = await useDeepseekCredential(appData, 'inspect', token).catch(() => 'unknown')
    const pairing = (['paired', 'unpaired', 'stored', 'outdated'].includes(value) ? value : 'unknown') as CodexPairingStatus
    const needsUpdate = version !== currentVersion || !await currentBundleAssets(location)
    return { installation: 'installed', pairing, version, locations, removable: true,
      detail: needsUpdate ? `可更新至 XJTLU-MCP v${currentVersion}，请从托盘退出 Harness 后再安装。` : undefined }
  }
  if (enabled || version) return { installation: 'partial', version, locations, removable: true, detail: '插件安装或启用尚未完成。' }
  return { installation: 'not-installed', locations, removable: false }
}

export async function installDeepseekPlugin(appData: string, userData: string, version: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('DeepSeek Harness 安装目前只支持 Windows。')
  const harness = installedHarness(appData)
  if (!harness) throw new Error('未找到 DeepSeek Harness 桌面端。')
  const profile = desktopProfile()
  if (!existsSync(join(profile, 'package.json'))) throw new Error('请先打开一次 DeepSeek Harness 完成初始化。')
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/.test(version)) throw new Error('工作台版本号无效。')
  const existing = await readBundle(profile)
  if (existing.enabled && existing.version === version && await currentBundleAssets(existing.location)) return

  // A durable local package lets Harness repair its profile without referring to the project checkout.
  const bundle = join(userData, 'agent-plugins', 'deepseek-harness', version)
  await mkdir(join(bundle, 'locale'), { recursive: true })
  const files = { ...bundleFiles, 'package.json': `${JSON.stringify({ ...bundleManifest, version }, null, 2)}\n` }
  await Promise.all(Object.entries(files).map(([file, contents]) => writeFile(join(bundle, file), contents)))

  await manageBundle(harness, ['add', `file:${bundle}`, '--offline', '--ignore-scripts'], 'DeepSeek Harness 插件安装失败。请从托盘完全退出客户端后重试。')
  const installed = await readBundle(profile)
  if (!installed.enabled || installed.version !== version || !await currentBundleAssets(installed.location)) {
    throw new Error('DeepSeek 插件更新尚未完成。')
  }
}

export async function uninstallDeepseekPlugin(appData: string): Promise<void> {
  const profile = desktopProfile()
  if (!existsSync(join(profile, 'package.json'))) return
  const bundle = await readBundle(profile)
  if (!bundle.enabled && !bundle.version) return
  const harness = installedHarness(appData)
  if (!harness) throw new Error('未找到 DeepSeek Harness 桌面端。')
  await manageBundle(harness, ['remove', bundleName], 'DeepSeek Harness 插件卸载失败。请从托盘完全退出客户端后重试。')
  const remaining = await readBundle(profile)
  if (remaining.enabled || remaining.version) throw new Error('DeepSeek 插件仍在客户端中。')
}

// Use Harness's own provider so writes share its file lock and preserve records and formatting.
const writeCredential = `
  import { readFileSync } from 'node:fs'
  import { join } from 'node:path'
  import { pathToFileURL } from 'node:url'

  const [runtime, dshHome, keyRef, action] = process.argv.slice(1)
  const load = name => import(pathToFileURL(join(runtime, name, 'lib', 'index.js')).href)
  const [{ Context }, { LocalCredentialProvider }, { credentialRef }] = await Promise.all([
    load('cordis'), load('dsh-credentials-local'), load('dsh-credentials')
  ])
  const token = readFileSync(0, 'utf8').trim()
  const root = new Context()
  try {
    await root.plugin(LocalCredentialProvider, {
      path: join(dshHome, '.credentials.yaml'), dshHome, watch: false
    })
    const ref = credentialRef(keyRef)
    if (action === 'inspect') {
      const stored = await root.credentials.resolve(ref)
      console.log(stored?.source !== 'file' ? 'unpaired' : !token ? 'stored' : stored.value === token ? 'paired' : 'outdated')
    } else {
      if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('Invalid MCP key')
      await root.credentials.set(ref, token)
    }
  } finally {
    await root.fiber.dispose()
  }
`

async function useDeepseekCredential(appData: string, action: 'inspect' | 'save', token: string): Promise<string> {
  const harness = installedHarness(appData)
  if (!harness) throw new Error('未找到 DeepSeek Harness 桌面端。')
  const runtime = join(harness, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai')
  return new Promise<string>((resolve, reject) => {
    const child = execFile(join(harness, 'DeepSeek Harness.exe'),
      ['--expose-internals', '--input-type=module', '--eval', writeCredential, '--', runtime, harnessHome(), keyRef, action],
      { env: deepseekEnvironment(), windowsHide: true, timeout: 40_000 }, (error, stdout) => {
        if (error) reject(new Error('无法读写 DeepSeek Harness 的配对凭据。'))
        else resolve(stdout.trim())
      })
    child.stdin?.on('error', () => { /* execFile reports a failed child. */ })
    child.stdin?.end(token + '\n')
  })
}

export async function saveDeepseekKey(appData: string, token: string): Promise<void> {
  await useDeepseekCredential(appData, 'save', token)
}
