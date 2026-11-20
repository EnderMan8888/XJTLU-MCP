import type { McpKeyStore } from '../infrastructure/mcp-key-store.ts'
import type { CodexPairingStatus, McpConfigFormat, McpStatus } from '../shared/mcp.ts'
import type { CampusQueries } from '../mcp/campus-queries.ts'
import { MCP_PORT, MCP_TOOL_NAMES, startCampusMcp } from '../mcp/server.ts'

export class McpService {
  private state: McpStatus = { phase: 'stopped', url: null, message: 'Agent 连接尚未开启。', tools: [...MCP_TOOL_NAMES] }
  private listener: Awaited<ReturnType<typeof startCampusMcp>> | null = null
  private token = ''
  private tail: Promise<void> = Promise.resolve()
  private disposed = false
  private queries: CampusQueries
  private keys: Pick<McpKeyStore, 'readOrCreate' | 'rotate'>
  private version: string
  private publish: (state: McpStatus) => void
  private port: number
  constructor(queries: CampusQueries, keys: Pick<McpKeyStore, 'readOrCreate' | 'rotate'>, version: string, publish: (state: McpStatus) => void, port = MCP_PORT) { this.queries = queries; this.keys = keys; this.version = version; this.publish = publish; this.port = port }
  getStatus(): McpStatus { return structuredClone(this.state) }
  private update(next: Partial<McpStatus>): void { this.state = { ...this.state, ...next }; this.publish(this.getStatus()) }
  private enqueue(operation: () => Promise<void>): Promise<void> { const result = this.tail.then(operation); this.tail = result.catch(() => {}); return result }
  private async stop(): Promise<void> { const listener = this.listener; this.listener = null; this.token = ''; if (listener) await listener.close() }
  private async start(rotate = false): Promise<void> {
    if (this.disposed) return
    this.update({ phase: 'starting', url: null, message: '正在开启本机 Agent 连接…' })
    try {
      const token = rotate ? await this.keys.rotate() : await this.keys.readOrCreate()
      const listener = await startCampusMcp(this.queries, token, this.version, this.port)
      if (this.disposed) { await listener.close(); return }
      this.listener = listener; this.token = token
      this.update({ phase: 'ready', url: listener.url, message: `已开启，可向本机 Agent 提供 ${MCP_TOOL_NAMES.length} 项校园工具。` })
    } catch { this.update({ phase: 'error', url: null, message: 'Agent 连接未能开启。请检查端口 39527 是否被占用，或重置访问密钥后重试。' }) }
  }
  setEnabled(enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) return
      if (enabled) { if (!this.listener) await this.start() }
      else { await this.stop(); this.update({ phase: 'stopped', url: null, message: 'Agent 连接已关闭。' }) }
    })
  }
  rotateKey(): Promise<void> { return this.enqueue(async () => { if (!this.disposed) { await this.stop(); await this.start(true) } }) }
  pairCodex(saveKey: (token: string) => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      if (!this.listener || !this.token || this.disposed) throw new Error('请先开启 Agent 连接。')
      await saveKey(this.token)
    })
  }
  inspectCodexPairing(inspectKey: (token: string) => Promise<CodexPairingStatus>): Promise<CodexPairingStatus> {
    return this.tail.then(() => inspectKey(this.token))
  }
  copyConfig(format: McpConfigFormat, write: (value: string) => void): void {
    if (!this.listener || !this.token || this.disposed) throw new Error('请先开启 Agent 连接。')
    if (format === 'token') write(this.token)
    else if (format === 'codex') write(`[mcp_servers.xjtlu]\nurl = "${this.listener.url}"\nhttp_headers = { Authorization = "Bearer ${this.token}" }\n`)
    else if (format === 'json') write(JSON.stringify({ mcpServers: { xjtlu: { type: 'http', url: this.listener.url, headers: { Authorization: `Bearer ${this.token}` } } } }, null, 2))
    else throw new Error('不支持的配置格式。')
  }
  dispose(): Promise<void> { this.disposed = true; return this.enqueue(() => this.stop()) }
}
