import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MCP_PORT } from '../mcp/server.ts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isCampusConnector(value: unknown): boolean {
  return isRecord(value) && (value.url === `http://127.0.0.1:${MCP_PORT}/mcp`
    || value.url === `http://localhost:${MCP_PORT}/mcp`)
}

export async function readAgentConfig(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

export async function writeAgentConfig(path: string, original: string | undefined, contents: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.xjtlu-mcp-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
    if (await readAgentConfig(path) !== original) throw new Error('客户端配置刚刚发生了变化，请重试。')
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
