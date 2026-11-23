import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { cleanupCodexAgent, inspectCodexAgent, migrateCodexMarketplace } from './codex-plugin'
import { cleanupDeepseekAgent, inspectDeepseekAgent } from './deepseek-harness'
import { inspectKimiAgent, uninstallKimiCode } from './kimi-code'
import { inspectMimoAgent, uninstallMimo } from './mimo-code'
import { inspectWorkbuddyAgent, uninstallWorkbuddy } from './workbuddy'
import type { AgentInstallStatus } from '../shared/mcp'

const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
const userData = join(appData, 'XJTLU-MCP-AMS')
const appPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const catalog = join(userData, 'agent-plugins', 'codex')
const version = JSON.parse(await readFile(join(appPath, 'package.json'), 'utf8')).version

const targets = [
  { name: 'ChatGPT / Codex', inspect: () => inspectCodexAgent(catalog, appPath, '', version), remove: () => cleanupCodexAgent(catalog) },
  { name: 'DeepSeek Harness', inspect: () => inspectDeepseekAgent(appData, '', version), remove: () => cleanupDeepseekAgent(appData, userData) },
  { name: '腾讯 WorkBuddy', inspect: () => inspectWorkbuddyAgent(''), remove: uninstallWorkbuddy },
  { name: 'Xiaomi MiMo Code', inspect: () => inspectMimoAgent('', version), remove: () => removeConnector(() => inspectMimoAgent('', version), uninstallMimo) },
  { name: 'Kimi Code', inspect: () => inspectKimiAgent(''), remove: () => removeConnector(() => inspectKimiAgent(''), uninstallKimiCode) }
]

async function removeConnector(inspect: () => Promise<AgentInstallStatus>, uninstall: () => Promise<void>): Promise<boolean> {
  const status = await inspect()
  if (status.installation === 'unknown') throw new Error('无法核对客户端配置。')
  if (!status.removable) return false
  await uninstall()
  if ((await inspect()).removable) throw new Error('客户端配置尚未移除。')
  return true
}

async function removeUnusedKeys(): Promise<void> {
  const user = homedir()
  const codex = process.env.CODEX_HOME?.trim() || join(user, '.codex')
  const kimi = process.env.KIMI_CODE_HOME?.trim() || join(user, '.kimi-code')
  const mimo = process.env.MIMOCODE_CONFIG_DIR?.trim() || join(user, '.config', 'mimocode')
  const harness = process.env.DSH_HOME?.trim() || join(user, '.dsh')
  const workbuddy = process.env.WORKBUDDY_CONFIG_DIR?.trim() || process.env.CODEBUDDY_CONFIG_DIR?.trim() || join(user, '.workbuddy')
  const configurations = [join(codex, 'config.toml'), join(kimi, 'mcp.json'), join(harness, '.credentials.yaml'), join(workbuddy, 'mcp.json'),
    ...['config.json', 'mimocode.json', 'mimocode.jsonc'].map(name => join(mimo, name))]
  const contents = await Promise.all(configurations.map(file => readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return ''
  })))
  const obsolete = ['XJTLU_MCP_TOKEN', 'XJTLU_CODEX_MCP_TOKEN'].filter(name => contents.every(text => !text.includes(name)))
  if (!obsolete.length) return
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; " + obsolete.map(name =>
      `[Environment]::SetEnvironmentVariable('${name}',[NullString]::Value,'User')`).join('; ')], { windowsHide: true, timeout: 10_000 })
}

async function go(): Promise<void> {
  const mode = process.argv[2]
  if (mode === 'register-upgrade') return migrateCodexMarketplace(catalog, appPath, version)
  if (mode !== 'inspect' && mode !== 'remove') throw new Error('Unknown maintenance operation')
  let pending = false
  for (const client of targets) {
    try {
      if (mode === 'inspect') {
        const status = await client.inspect()
        const label = status.removable ? '将核对并移除' : status.installation === 'not-installed' ? '未安装' : '卸载时进一步核对'
        console.log(client.name + ' · ' + label)
      } else console.log(client.name + ' · ' + (await client.remove() ? '已移除' : '未发现工作台安装的接入项'))
    } catch {
      pending = true
      console.log(client.name + ' · 待处理。请完全退出该客户端，检查接入配置后重试。')
    }
  }
  if (mode === 'remove' && !pending) {
    await removeUnusedKeys().catch(() => {
      pending = true
      console.log('Windows 用户环境变量 · 暂无法核对或清理，请重试。')
    })
  }
  console.log('豆包 · 若手动添加过本机连接器，请在「管理 → 连接器」核对 xjtlu（127.0.0.1:39527/mcp）并移除。')
  if (mode === 'remove' && pending) process.exitCode = 2
}

try { await go() }
catch {
  console.log('无法完成本机维护。请确认工作台和 Agent 客户端已退出后重试。')
  process.exitCode = 1
}
