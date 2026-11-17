import { describe, it, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { CredentialStore, type CredentialCrypto } from '../src/infrastructure/credential-store.ts'

const synthetic = { username: 'synthetic-school-account', password: 'synthetic-secret-password' }

// An independent authenticated cipher exercises the storage contract. A separate
// Electron check exercises the real Windows safeStorage provider.
function testCrypto(): CredentialCrypto {
  const key = randomBytes(32)
  return {
    available: async () => true,
    encrypt: async (plaintext) => {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
    },
    decrypt: async (buffer) => {
      const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12))
      decipher.setAuthTag(buffer.subarray(12, 28))
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8')
    }
  }
}

async function directory(t: TestContext): Promise<string> {
  const base = join(process.cwd(), '.scratch', 'credential-tests')
  await mkdir(base, { recursive: true })
  const target = await mkdtemp(join(base, 'case-'))
  t.after(async () => {
    const resolved = await realpath(target)
    const resolvedBase = await realpath(base)
    assert.ok(resolved.startsWith(resolvedBase + sep), 'Cleanup must remain inside the test workspace')
    await rm(resolved, { recursive: true, force: true })
  })
  return target
}

describe('encrypted credential storage', () => {
  it('encrypts the username and password on disk and returns only metadata to the UI', async (t) => {
    const dir = await directory(t)
    const store = new CredentialStore(dir, testCrypto())
    await store.save(synthetic)
    const disk = await readFile(join(dir, 'ams-credentials.json'), 'utf8')
    assert.equal(disk.includes(synthetic.username), false)
    assert.equal(disk.includes(synthetic.password), false)
    assert.deepEqual(await store.read(), synthetic)
    const status = await store.status()
    assert.equal(status.saved, true)
    assert.equal(status.username, synthetic.username)
    assert.equal('password' in status, false)
    assert.equal(JSON.stringify(status).includes(synthetic.password), false)
    assert.deepEqual(await readdir(dir), ['ams-credentials.json'])
  })

  it('refuses to persist anything when system encryption is unavailable', async (t) => {
    const dir = await directory(t)
    const crypto = testCrypto()
    crypto.available = async () => false
    const store = new CredentialStore(dir, crypto)
    await assert.rejects(store.save(synthetic), /加密不可用/)
    assert.deepEqual(await readdir(dir), [])
    assert.equal((await store.status()).available, false)
  })

  it('treats provider failure as unavailable instead of writing plaintext', async (t) => {
    const dir = await directory(t)
    const crypto = testCrypto()
    crypto.available = async () => { throw new Error('provider error') }
    const store = new CredentialStore(dir, crypto)
    await assert.rejects(store.save(synthetic), /加密不可用/)
    assert.deepEqual(await readdir(dir), [])
  })

  it('preserves a previous saved record if a replacement cannot be encrypted', async (t) => {
    const dir = await directory(t)
    const crypto = testCrypto()
    const store = new CredentialStore(dir, crypto)
    await store.save(synthetic)
    const before = await readFile(join(dir, 'ams-credentials.json'), 'utf8')
    crypto.encrypt = async () => { throw new Error('contains private details') }
    await assert.rejects(store.save({ ...synthetic, password: 'replacement' }), { message: '加密保存失败，未更新已保存的密码。' })
    assert.equal(await readFile(join(dir, 'ams-credentials.json'), 'utf8'), before)
    assert.deepEqual(await store.read(), synthetic)
  })

  it('rejects malformed input before persisting a file', async (t) => {
    const dir = await directory(t)
    const store = new CredentialStore(dir, testCrypto())
    for (const input of [null, {}, { username: 'a', password: '' }, { ...synthetic, unexpected: 'value' }]) {
      await assert.rejects(store.save(input), /有效的学校账号和密码/)
    }
    assert.deepEqual(await readdir(dir), [])
  })

  it('reports a corrupted record without echoing its contents', async (t) => {
    const dir = await directory(t)
    const store = new CredentialStore(dir, testCrypto())
    await writeFile(join(dir, 'ams-credentials.json'), `not-json-${synthetic.password}`)
    await assert.rejects(store.read(), { message: '无法解锁已保存的密码，请删除后重新保存。' })
    const status = await store.status()
    assert.equal(status.saved, true)
    assert.equal(status.username, null)
    assert.equal(JSON.stringify(status).includes(synthetic.password), false)
    await store.forget()
    assert.equal((await store.status()).saved, false)
  })

  it('does not restore a secret when deletion races with a pending save', async (t) => {
    const dir = await directory(t)
    const crypto = testCrypto()
    const encrypt = crypto.encrypt
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    crypto.encrypt = async (plaintext) => { entered(); await gate; return encrypt(plaintext) }
    const store = new CredentialStore(dir, crypto)
    const saving = store.save(synthetic)
    await started
    const deleting = store.forget()
    release()
    await Promise.all([saving, deleting])
    assert.equal(await store.read(), null)
    assert.deepEqual(await readdir(dir), [])
  })

  it('preserves password whitespace and permits deletion when encryption later becomes unavailable', async (t) => {
    const dir = await directory(t)
    const crypto = testCrypto()
    const store = new CredentialStore(dir, crypto)
    await store.save({ username: ' synthetic ', password: ' secret with spaces ' })
    assert.deepEqual(await store.read(), { username: 'synthetic', password: ' secret with spaces ' })
    crypto.available = async () => false
    await store.forget()
    await store.forget()
    assert.equal(await store.read(), null)
  })
})
