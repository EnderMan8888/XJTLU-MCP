import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutoReloginStore } from '../src/infrastructure/auto-relogin-store.ts'
import { defaultAutoRelogin } from '../src/shared/auto-relogin.ts'

it('automatic re-login settings default off, save independently, and survive restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'xjtlu-relogin-'))
  const file = join(directory, 'auto-relogin.json')
  t.after(async () => {
    await rm(file, { force: true })
    await rmdir(directory)
  })
  const store = new AutoReloginStore(directory)
  await store.load()
  assert.deepEqual(store.get(), defaultAutoRelogin)
  await Promise.all([store.set('lmc', true), store.set('library', true), store.set('lmc', false)])

  const restored = new AutoReloginStore(directory)
  await restored.load()
  assert.deepEqual(restored.get(), { ...defaultAutoRelogin, library: true })

  await writeFile(file, '{"lmc":true,"library":"true"}')
  await restored.load()
  assert.deepEqual(restored.get(), { ...defaultAutoRelogin, lmc: true })
})
