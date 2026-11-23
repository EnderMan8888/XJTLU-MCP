import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { writeKimiConfig } from '../src/main/kimi-code.ts'

it('Kimi Code installation writes only xjtlu and refuses to overwrite invalid configuration', async t => {
  const previousHome = process.env.KIMI_CODE_HOME
  const root = await mkdtemp(join(tmpdir(), 'xjtlu-kimi-'))
  const path = join(root, 'profile', 'mcp.json')
  process.env.KIMI_CODE_HOME = join(root, 'profile')
  t.after(async () => {
    if (previousHome === undefined) delete process.env.KIMI_CODE_HOME
    else process.env.KIMI_CODE_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  })

  const url = 'http://127.0.0.1:39527/mcp'
  const xjtlu = { url, bearerTokenEnvVar: 'XJTLU_MCP_TOKEN' }
  await writeKimiConfig(url)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { mcpServers: { xjtlu } })

  const other = { url: 'https://example.invalid/mcp' }
  await writeFile(path, '\uFEFF' + JSON.stringify({
    mcpServers: { other, xjtlu: { url: 'http://127.0.0.1:1/mcp' } },
    extras: { keep: true }
  }))
  await writeKimiConfig(url)
  const installed = await readFile(path, 'utf8')
  assert.deepEqual(JSON.parse(installed), { mcpServers: { other, xjtlu }, extras: { keep: true } })
  await writeKimiConfig(url)
  assert.equal(await readFile(path, 'utf8'), installed)

  for (const invalid of ['{ broken', '{"mcpServers": []}']) {
    await writeFile(path, invalid)
    await assert.rejects(writeKimiConfig(url), /mcp\.json/)
    assert.equal(await readFile(path, 'utf8'), invalid)
  }
})
