// WorkBuddy 接入的本机只读探针。
//
// 用途：在写入 mcp.json 之后、点「信任」之前，先确认地址与访问密钥本身可用；
// 也可在统一验收时复核 16 项工具的发现与 get_connection_status。
//
// 只做三次只读请求（initialize / tools/list / get_connection_status）与两次
// 负例（错误密钥、无密钥）。不调用任何学校数据工具，不发起预约、不下载文件，
// 不输出访问密钥、学校账号或签名链接，只输出脱敏的状态与数量。
//
// 用法（访问密钥来自启动进程的环境变量，不写进命令行）：
//   PowerShell:  $env:XJTLU_MCP_TOKEN = '<从「Agent 连接」页复制的访问密钥>'
//                node docs/agent-clients/workbuddy/probe-mcp.mjs
//   指定其他地址: node docs/agent-clients/workbuddy/probe-mcp.mjs http://127.0.0.1:39527/mcp
//
// 退出码：0 全部通过；1 有失败项。

import { createHash } from 'node:crypto'

const url = process.argv[2] || 'http://127.0.0.1:39527/mcp'
const token = process.env.XJTLU_MCP_TOKEN || ''
const results = []
const WANTED = [
  'get_connection_status', 'refresh_source', 'get_modules', 'get_timetable', 'get_exams', 'get_grades',
  'get_attendance_summary', 'get_attendance_records', 'get_library_overview', 'get_library_seats',
  'reserve_library_seat', 'get_library_reservations', 'get_lmc_notification', 'list_lmc_modules',
  'get_module_contents', 'download_lmc_file'
]

function record(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}

async function rpc(payload, { bearer, sessionId } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  const text = await res.text()
  const type = res.headers.get('content-type') || ''
  let json = null
  if (type.includes('text/event-stream')) {
    const line = text.split('\n').find((l) => l.startsWith('data:'))
    if (line) { try { json = JSON.parse(line.slice(5).trim()) } catch {} }
  } else {
    try { json = JSON.parse(text) } catch {}
  }
  return { status: res.status, sessionId: res.headers.get('mcp-session-id'), json, text }
}

const init = (id, bearer) => rpc({
  jsonrpc: '2.0', id, method: 'initialize',
  params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'workbuddy-pairing-probe', version: '0.0.0' } }
}, { bearer })

// 只保留可用于验收的字段：ok/code/stale/complete 与各来源的 phase、connected、needsLogin。
function redact(payload) {
  if (!payload || typeof payload !== 'object') return null
  const out = { ok: payload.ok, code: payload.code ?? null, stale: payload.stale, complete: payload.complete, sources: {} }
  for (const [name, value] of Object.entries(payload.data || {})) {
    if (value && typeof value === 'object') {
      out.sources[name] = { phase: value.phase ?? null, connected: value.connected ?? null, needsLogin: value.needsLogin ?? null }
    }
  }
  return out
}

async function main() {
  console.log(`endpoint: ${url}`)
  if (!token) {
    record('访问密钥', false, '进程环境变量 XJTLU_MCP_TOKEN 为空，未发起请求')
    return
  }
  // 只输出长度与摘要前缀，便于判断"配对的是哪一把钥匙"，不泄露密钥本身。
  console.log(`token: length=${token.length}, fingerprint=${createHash('sha256').update(token).digest('hex').slice(0, 8)}`)

  const first = await init(1, token)
  record('initialize', first.status === 200 && Boolean(first.json?.result), `HTTP ${first.status}, server=${first.json?.result?.serverInfo?.name ?? 'n/a'} ${first.json?.result?.serverInfo?.version ?? ''}`)
  if (first.status !== 200) { console.log(`body: ${first.text.slice(0, 160).replace(/\s+/g, ' ')}`); return }
  const sessionId = first.sessionId

  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { bearer: token, sessionId })

  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { bearer: token, sessionId })
  const names = (list.json?.result?.tools || []).map((t) => t.name)
  const missing = WANTED.filter((n) => !names.includes(n))
  record('tools/list', names.length === WANTED.length && missing.length === 0, `发现 ${names.length} 项${missing.length ? `，缺少 ${missing.join(',')}` : ''}`)

  const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_connection_status', arguments: {} } }, { bearer: token, sessionId })
  let payload = call.json?.result?.structuredContent
  if (!payload) { try { payload = JSON.parse(call.json?.result?.content?.[0]?.text ?? 'null') } catch {} }
  const summary = redact(payload)
  record('get_connection_status', call.status === 200 && call.json?.result?.isError !== true && summary?.ok === true, `HTTP ${call.status}, isError=${call.json?.result?.isError ?? 'n/a'}`)
  if (summary) console.log(`      ${JSON.stringify(summary.sources)}`)

  const wrong = await rpc({
    jsonrpc: '2.0', id: 4, method: 'initialize',
    params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'probe', version: '0' } }
  }, { bearer: 'a'.repeat(64) }).catch((e) => ({ status: 0, text: String(e?.message || e) }))
  record('错误密钥被拒绝', wrong.status === 401, `HTTP ${wrong.status} ${String(wrong.text || '').slice(0, 80).replace(/\s+/g, ' ')}`)

  const anon = await rpc({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } })
  record('无密钥被拒绝', anon.status === 401, `HTTP ${anon.status} ${anon.text.slice(0, 80).replace(/\s+/g, ' ')}`)

  const again = await init(6, token)
  record('换回正确密钥可恢复', again.status === 200, `HTTP ${again.status}`)
}

main()
  .catch((e) => record('探针执行', false, e?.message || String(e)))
  .finally(() => {
    const failed = results.filter((r) => !r.pass)
    console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length ? `，失败：${failed.map((f) => f.name).join('、')}` : ''}`)
    process.exitCode = failed.length ? 1 : 0
  })
