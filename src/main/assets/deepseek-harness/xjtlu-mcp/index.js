export const name = 'xjtlu-campus-mcp'
export const inject = ['mcpManager']

export function apply(ctx) {
  if (ctx.mcpManager.list().some(server => server.name === 'xjtlu')) return
  ctx.mcpManager.register('xjtlu', {
    transport: 'streamable-http',
    url: 'http://127.0.0.1:39527/mcp',
    headers: { Authorization: 'Bearer ${credential:XJTLU_MCP_TOKEN}' }
  })
}
