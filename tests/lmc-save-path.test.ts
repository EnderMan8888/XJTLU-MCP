import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareLmcSavePath } from '../src/infrastructure/lmc-save-path.ts'

it('LMC saves to the exact requested path and rejects concurrent or existing files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'xjtlu-lmc-test-'))
  const target = join(directory, '公告.pdf')
  t.after(async () => {
    await rm(target, { force: true })
    await rmdir(directory)
  })
  const first = await prepareLmcSavePath(target, directory)
  const second = await prepareLmcSavePath(target, directory)
  try {
    await writeFile(first.stagingPath, 'first file')
    await writeFile(second.stagingPath, 'second file')
    await first.save()
    await assert.rejects(second.save(), { code: 'save_path_exists' })
    assert.equal(await readFile(target, 'utf8'), 'first file')
    await assert.rejects(prepareLmcSavePath(target, directory), { code: 'save_path_exists' })
    await assert.rejects(prepareLmcSavePath(join(directory, 'missing', 'file.pdf'), directory), { code: 'save_path_unavailable' })
  } finally {
    await first.cleanup()
    await second.cleanup()
  }
})

it('LMC rejects paths that do not identify a normal local file', async () => {
  const invalid = ['relative.pdf', './file.pdf', tmpdir() + (process.platform === 'win32' ? '\\' : '/')]
  if (process.platform === 'win32') invalid.push('C:relative.pdf', 'C:/A/../file.pdf', 'C:/Downloads/file.pdf:stream', 'C:/Downloads/NUL.pdf', '\\\\server\\share\\file.pdf', '\\\\?\\C:\\file.pdf')
  for (const path of invalid) await assert.rejects(prepareLmcSavePath(path, tmpdir()), { code: 'invalid_save_path' })
})
