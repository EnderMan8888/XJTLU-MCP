// XJTLU-MCP × MiMo Code 接入验证脚本（虚构数据，不连接学校）。
// 用法（在仓库根目录）：
//   $env:XJTLU_MCP_TOKEN = '<64 位十六进制虚构密钥>'
//   node --experimental-strip-types docs/agent-clients/mimo-code/verify-mcp.ts
// 服务端使用与生产一致的 src/mcp/server.ts 实现，监听随机本机端口；
// 客户端按 mimocode.json 的 mcp.xjtlu 配置形态解析
//   headers.Authorization: "Bearer {env:XJTLU_MCP_TOKEN}"
// 后发起 Streamable HTTP 连接，核对 16 项工具、get_connection_status 调用、
// 错误密钥拒绝与正确密钥恢复。仅输出脱敏状态与数量。

import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CampusQueries, type CampusSources } from '../../../src/mcp/campus-queries.ts'
import { MCP_TOOL_NAMES, startCampusMcp } from '../../../src/mcp/server.ts'
import { initialState } from '../../../src/shared/ams.ts'
import { initialEbridgeState } from '../../../src/shared/ebridge.ts'
import { initialLibraryState } from '../../../src/shared/library.ts'
import { initialLmcState } from '../../../src/shared/lmc.ts'

const stamp = new Date().toISOString()

function fixture() {
  const ams = initialState()
  const ebridge = initialEbridgeState()
  const library = initialLibraryState()
  const lmc = initialLmcState()
  ams.phase = 'connected'
  ebridge.phase = 'connected'
  ebridge.timetableAt = stamp
  ebridge.examsAt = stamp
  library.phase = 'ready'
  library.fetchedAt = stamp
  lmc.phase = 'connected'
  lmc.coursesAt = stamp
  lmc.notificationsAt = stamp
  const sources: CampusSources = {
    ams: { getState: () => structuredClone(ams), refresh: async () => {}, loadScheduleAttendance: async () => {} },
    ebridge: { getState: () => structuredClone(ebridge), refresh: async () => {}, loadGrades: async () => {} },
    library: {
      getState: () => structuredClone(library),
      refresh: async () => {},
      readSeats: async query => ({ query, fetchedAt: stamp, seats: [] }),
      getReservations: async () => [],
      agentBookings: { get: () => undefined, request: () => null }
    },
    lmc: {
      getState: () => structuredClone(lmc),
      refresh: async () => {},
      loadCourse: async () => {},
      loadFolder: async () => {},
      readNotificationRange: async () => ({ notifications: [], fetchedAt: stamp, complete: true, issue: null }),
      startDownload: async () => null
    }
  }
  return new CampusQueries(sources, () => Date.now())
}

// 与 MiMo Code 配置变量替换一致：{env:NAME} 取启动进程环境中的 NAME。
function resolveAuth(template: string): string {
  return template.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => process.env[name] ?? '')
}

async function connect(url: string, authHeader: string): Promise<Client> {
  const client = new Client({ name: 'mimo-code-verify', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: authHeader } } }))
  return client
}

async function main() {
  // 虚构密钥由启动本脚本的进程通过环境变量传入，验证“环境变量由启动进程继承”。
  const key = process.env.XJTLU_MCP_TOKEN ?? ''
  const wrongKey = 'e1'.repeat(32)
  assert.match(key, /^[a-f0-9]{64}$/, '请先在启动进程设置 64 位十六进制虚构密钥 XJTLU_MCP_TOKEN')
  const server = await startCampusMcp(fixture(), key, '2.0.0', 0)
  const summary: Record<string, unknown> = { serverUrl: server.url.replace(/:\d+/, ':<port>'), checks: {} }
  const checks = summary.checks as Record<string, unknown>
  try {
    // 1. 环境变量缺失：{env:XJTLU_MCP_TOKEN} 解析为空，按 Bearer 认证失败处理。
    const original = process.env.XJTLU_MCP_TOKEN
    delete process.env.XJTLU_MCP_TOKEN
    const missingHeader = resolveAuth('Bearer {env:XJTLU_MCP_TOKEN}')
    let missingRejected = false
    try { await connect(server.url, missingHeader) } catch { missingRejected = true }
    checks.envMissingRejected = missingRejected && missingHeader === 'Bearer '
    assert.equal(checks.envMissingRejected, true)
    process.env.XJTLU_MCP_TOKEN = original

    // 2. 启动进程继承正确密钥：发现 16 项工具并调用 get_connection_status。
    const authHeader = resolveAuth('Bearer {env:XJTLU_MCP_TOKEN}')
    assert.equal(authHeader, `Bearer ${key}`)
    const client = await connect(server.url, authHeader)
    const tools = await client.listTools()
    checks.toolCount = tools.tools.length
    checks.toolNames = tools.tools.map(tool => tool.name)
    assert.equal(tools.tools.length, 16)
    assert.deepEqual(tools.tools.map(tool => tool.name), [...MCP_TOOL_NAMES])
    const status = await client.callTool({ name: 'get_connection_status', arguments: {} })
    checks.getStatusIsError = status.isError === true
    checks.getStatusHasData = !!(status.structuredContent as { data?: unknown } | undefined)?.data
    assert.equal(status.isError, false)
    await client.close()

    // 3. 错误密钥被拒绝（Bearer 认证错误）。
    let wrongRejected = false
    let wrongError = ''
    try { await connect(server.url, `Bearer ${wrongKey}`) } catch (error) { wrongRejected = true; wrongError = String((error as Error).message ?? error).slice(0, 120) }
    checks.wrongKeyRejected = wrongRejected
    checks.wrongKeyError = wrongError.replace(wrongKey, '<redacted>')
    assert.equal(wrongRejected, true)

    // 4. 换回正确密钥恢复连接。
    const recovered = await connect(server.url, resolveAuth('Bearer {env:XJTLU_MCP_TOKEN}'))
    const again = await recovered.listTools()
    checks.recoveredToolCount = again.tools.length
    assert.equal(again.tools.length, 16)
    await recovered.close()

    checks.passed = true
  } finally {
    await server.close()
  }
  console.log(JSON.stringify(summary, null, 2))
}

await main()
