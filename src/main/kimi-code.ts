import { homedir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { AgentInstallStatus } from '../shared/mcp.ts'
import { isCampusConnector, isRecord, readAgentConfig, writeAgentConfig } from './agent-config.ts'
import { inspectAgentKey, saveAgentKey } from './windows-agent-key.ts'

export function kimiConfigEntry(url: string): { url: string; bearerTokenEnvVar: string } {
  return { url, bearerTokenEnvVar: 'XJTLU_MCP_TOKEN' }
}

function configPath(): string {
  return join(process.env.KIMI_CODE_HOME?.trim() || join(homedir(), '.kimi-code'), 'mcp.json')
}

async function readConfig(path: string) {
  const original = await readAgentConfig(path)
  let config: unknown = {}
  if (original !== undefined) {
    try {
      config = JSON.parse(original.replace(/^\uFEFF/, ''))
    } catch {
      throw new Error('Kimi Code 的 mcp.json 无法解析。')
    }
  }
  if (!isRecord(config) || (config.mcpServers !== undefined && !isRecord(config.mcpServers))) {
    throw new Error('Kimi Code 的 mcp.json 配置结构无效。')
  }
  return { original, config, servers: config.mcpServers ?? {} }
}

export async function inspectKimiAgent(token: string): Promise<AgentInstallStatus> {
  const path = configPath()
  const locations = [{ label: '配置文件', path }]
  try {
    const { servers } = await readConfig(path)
    if (isCampusConnector(servers.xjtlu)) return { installation: 'installed', pairing: await inspectAgentKey(token), locations, removable: true }
    if ('xjtlu' in servers) return { installation: 'partial', detail: '已有同名连接器指向其他服务。', locations, removable: false }
    return { installation: 'not-installed', locations, removable: false }
  } catch { return { installation: 'unknown', detail: '无法读取 Kimi Code 配置。', locations, removable: false } }
}

export async function writeKimiConfig(url: string): Promise<void> {
  const path = configPath()
  const { original, config, servers } = await readConfig(path)
  const entry = kimiConfigEntry(url)
  if (isDeepStrictEqual(servers.xjtlu, entry)) return
  const next = { ...config, mcpServers: { ...servers, xjtlu: entry } }
  await writeAgentConfig(path, original, `${JSON.stringify(next, null, 2)}\n`)
}

export async function uninstallKimiCode(): Promise<void> {
  const path = configPath()
  const { original, config, servers } = await readConfig(path)
  if (!isCampusConnector(servers.xjtlu)) return
  delete servers.xjtlu
  await writeAgentConfig(path, original, `${JSON.stringify(config, null, 2)}\n`)
}

export async function installKimiCode(token: string, url: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Kimi Code 一键安装目前只支持 Windows。')
  await writeKimiConfig(url)
  await saveAgentKey(token)
}
