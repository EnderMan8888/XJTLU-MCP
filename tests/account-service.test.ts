import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { CredentialStore } from '../src/infrastructure/credential-store.ts'
import { AccountService, type AccountConsumer } from '../src/services/account-service.ts'
import type { CredentialStatus } from '../src/shared/credentials.ts'

const saved = { username: 'synthetic-campus-account', password: 'synthetic-campus-password' }

it('shares one campus account with consumers and publishes metadata without a password', async (t) => {
  const base = join(process.cwd(), '.scratch', 'account-service-tests')
  await mkdir(base, { recursive: true })
  const dir = await mkdtemp(join(base, 'case-'))
  t.after(async () => { const path = await realpath(dir); assert.ok(path.startsWith((await realpath(base)) + sep)); await rm(path, { recursive: true, force: true }) })
  const events: string[] = [], published: CredentialStatus[] = []
  // Reversible synthetic provider for coordination tests only. Real encryption
  // is covered separately by storage tests and the Windows safeStorage check.
  const store = new CredentialStore(dir, { available: async () => true, encrypt: async (value) => { events.push('encrypt'); return Buffer.from(value).reverse() }, decrypt: async (value) => Buffer.from(value).reverse().toString('utf8') })
  const account = new AccountService(store, (status) => { events.push('published'); published.push(status) })
  const consumer: AccountConsumer = { cancelAccountAutomation: async () => { events.push('cancel') }, accountChanged: () => { events.push('changed') } }
  account.subscribe(consumer)
  await account.save(saved)
  assert.deepEqual(events, ['cancel', 'encrypt', 'published', 'changed'])
  assert.deepEqual(await account.read(), saved)
  assert.equal(published[0].username, saved.username)
  assert.equal(JSON.stringify(published).includes(saved.password), false)
  assert.equal('password' in published[0], false)

  await assert.rejects(account.save({ username: '', password: '' }))
  assert.deepEqual(await account.read(), saved)
  assert.equal(published.length, 1)

  const stop = account.subscribe({ cancelAccountAutomation: async () => { throw new Error('Consumer could not stop') }, accountChanged: () => {} })
  await assert.rejects(account.forget(), /Consumer could not stop/)
  assert.deepEqual(await account.read(), saved)
  stop()
  await account.forget()
  assert.equal(await account.read(), null)
  assert.equal(published.at(-1)?.saved, false)
})
