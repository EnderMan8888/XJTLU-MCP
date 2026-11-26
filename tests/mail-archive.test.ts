import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { MailArchive } from '../src/infrastructure/mail-archive.ts'
import type { MailMessage } from '../src/shared/mail.ts'

it('opts in, restores mailbox histories separately and blocks older writes after clearing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xjtlu-mail-archive-'))
  const mask = (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 0x93))
  const crypto = {
    available: async () => true,
    encrypt: async (value: string) => mask(Buffer.from(value)),
    decrypt: async (bytes: Buffer) => mask(bytes).toString('utf8')
  }
  const owner = 'a'.repeat(64), another = 'b'.repeat(64)
  const detail: MailMessage = { id: 'sample-1', subject: 'Archived note', body: '<p>Private sample</p>', bodyType: 'html',
    receivedAt: '2026-01-01T12:00:00Z', sentAt: null, from: null, isRead: false, hasAttachments: false, to: [], cc: [], bcc: [] }
  try {
    const archive = new MailArchive(directory, crypto)
    await archive.load()
    await archive.saveList(owner, archive.revision, 'inbox', [detail])
    assert.deepEqual(await readdir(directory), [])
    await archive.setEnabled(true)
    await archive.saveList(owner, archive.revision, 'inbox', [detail])
    await archive.saveMessage(owner, archive.revision, detail)
    await archive.saveList(owner, archive.revision, 'inbox', [{ ...detail, id: 'sample-2', receivedAt: '2026-01-02T12:00:00Z' }])
    await archive.saveList(another, archive.revision, 'sentitems', [{ ...detail, id: 'separate' }])
    assert.doesNotMatch(await readFile(join(directory, `mail-archive-${owner}.bin`), 'utf8'), /Private sample|Archived note/)
    const restarted = new MailArchive(directory, crypto)
    await restarted.load()
    assert.equal(restarted.enabled, true)
    assert.deepEqual((await restarted.list(owner, restarted.revision, 'inbox')).map(item => item.id), ['sample-2', 'sample-1'])
    assert.equal((await restarted.get(owner, restarted.revision, 'sample-1'))?.body, detail.body)
    assert.deepEqual(await restarted.list(another, restarted.revision, 'inbox'), [])
    assert.equal(await restarted.get(another, restarted.revision, 'sample-1'), undefined)
    await restarted.setEnabled(false)
    assert.deepEqual(await restarted.list(owner, restarted.revision, 'inbox'), [])
    await restarted.setEnabled(true)
    assert.equal((await restarted.list(owner, restarted.revision, 'inbox')).length, 2)
    const previous = restarted.revision
    const clearing = restarted.clear()
    await restarted.saveList(owner, previous, 'inbox', [detail])
    await clearing
    assert.equal(restarted.enabled, true)
    assert.deepEqual(await readdir(directory), ['mail-archive-enabled'])
    assert.deepEqual(await restarted.list(owner, restarted.revision, 'inbox'), [])
  } finally {
    for (const file of await readdir(directory)) await unlink(join(directory, file))
    await rmdir(directory)
  }
})
