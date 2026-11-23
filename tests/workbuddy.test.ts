import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectWorkbuddyInstall, saveWorkbuddyInstall } from '../src/main/workbuddy.ts'

// WorkBuddy 的一键写入：只动 mcpServers.xjtlu，保留同文件其他连接器，坏文件不覆盖。
it('WorkBuddy install writes mcpServers.xjtlu, keeps other connectors, and reports pairing and trust', async t => {
  const token = 'a'.repeat(64)
  const root = await mkdtemp(join(tmpdir(), 'workbuddy-install-'))
  const previous = process.env.WORKBUDDY_CONFIG_DIR
  process.env.WORKBUDDY_CONFIG_DIR = root
  t.after(async () => {
    if (previous === undefined) delete process.env.WORKBUDDY_CONFIG_DIR
    else process.env.WORKBUDDY_CONFIG_DIR = previous
    await rm(root, { recursive: true, force: true })
  })

  const empty = await inspectWorkbuddyInstall(token)
  assert.deepEqual(empty, { config: 'missing', pairing: 'unpaired', trust: 'pending' })

  assert.deepEqual(await saveWorkbuddyInstall(token), { config: 'written', pairing: 'paired', trust: 'pending' })
  const configPath = join(root, 'mcp.json')
  const written: any = JSON.parse(await readFile(configPath, 'utf8'))
  assert.equal(written.mcpServers.xjtlu.type, 'streamableHttp')
  assert.equal(written.mcpServers.xjtlu.url, 'http://127.0.0.1:39527/mcp')
  assert.equal(written.mcpServers.xjtlu.headers.Authorization, `Bearer ${token}`)

  // 已有其他连接器时要保留，且不再改写成别人的条目。
  await writeFile(configPath, JSON.stringify({ mcpServers: { qq: { type: 'sse', url: 'https://example.invalid/sse' } }, extra: { keep: true } }), 'utf8')
  assert.equal((await saveWorkbuddyInstall(token)).config, 'written')
  const merged: any = JSON.parse(await readFile(configPath, 'utf8'))
  assert.equal(merged.mcpServers.qq.url, 'https://example.invalid/sse')
  assert.equal(merged.extra.keep, true)
  assert.deepEqual(Object.keys(merged.mcpServers).sort(), ['qq', 'xjtlu'])
  assert.ok((await readdir(root)).includes('mcp.json.bak-before-xjtlu'))

  // 旧密钥视角为 outdated，换密钥重新写入后恢复。
  await saveWorkbuddyInstall('b'.repeat(64))
  assert.equal((await inspectWorkbuddyInstall(token)).pairing, 'outdated')
  assert.equal((await saveWorkbuddyInstall(token)).pairing, 'paired')

  // 信任记录按 sha256(origin)::服务名 记录，只用于界面提示。
  const approval = `${createHash('sha256').update('http://127.0.0.1:39527').digest('hex')}::xjtlu`
  await writeFile(join(root, 'mcp-approvals.json'), JSON.stringify({ [approval]: Date.now() }), 'utf8')
  assert.equal((await inspectWorkbuddyInstall(token)).trust, 'approved')
  await writeFile(join(root, 'mcp-approvals.json'), JSON.stringify({ 'other::svc': 1 }), 'utf8')
  assert.equal((await inspectWorkbuddyInstall(token)).trust, 'pending')

  // 无法解析的配置不覆盖，只报告 invalid。
  await writeFile(configPath, '{ broken', 'utf8')
  await assert.rejects(() => saveWorkbuddyInstall(token), /无法解析/)
  assert.equal(await readFile(configPath, 'utf8'), '{ broken')
  assert.equal((await inspectWorkbuddyInstall(token)).config, 'invalid')

  // 非法密钥直接拒绝，不落盘。
  await assert.rejects(() => saveWorkbuddyInstall('bad'), /访问密钥/)
})
