import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { McpKeyStore } from '../src/infrastructure/mcp-key-store.ts'

it('MCP access keys persist encrypted, rotate, and fail closed for unreadable or unavailable encryption', async t => {
  const root = resolve('.scratch/mcp-key-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'key-'))
  t.after(async () => { if (!directory.startsWith(root + sep)) throw new Error('Unexpected fixture path'); await rm(directory, { recursive: true, force: true }) })
  const key = randomBytes(32)
  const cipher = {
    available: async () => true,
    async encrypt(text: string) { const iv = randomBytes(12), encrypt = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, encrypt.update(text, 'utf8'), encrypt.final(), encrypt.getAuthTag()]) },
    async decrypt(bytes: Buffer) { const decrypt = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decrypt.setAuthTag(bytes.subarray(-16)); return Buffer.concat([decrypt.update(bytes.subarray(12, -16)), decrypt.final()]).toString('utf8') }
  }
  const store = new McpKeyStore(directory, cipher), first = await store.readOrCreate()
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(await store.readOrCreate(), first)
  assert.equal((await readFile(join(directory, 'mcp-access.bin'))).includes(Buffer.from(first)), false)
  const next = await store.rotate(); assert.notEqual(next, first); assert.equal(await store.readOrCreate(), next)
  await writeFile(join(directory, 'mcp-access.bin'), Buffer.from('invalid'))
  await assert.rejects(store.readOrCreate(), /无法读取/)
  await assert.rejects(new McpKeyStore(directory, { ...cipher, available: async () => false }).rotate(), /加密不可用/)
})
