import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { EbridgeCache } from '../src/infrastructure/ebridge-cache.ts'
import { initialEbridgeState } from '../src/shared/ebridge.ts'

test('eBridge cache restores only the requested datasets across instances and can be disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xjtlu-ebridge-cache-'))
  const scramble = (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 0xa5))
  const crypto = {
    available: async () => true,
    encrypt: async (value: string) => scramble(Buffer.from(value)),
    decrypt: async (value: Buffer) => scramble(value).toString('utf8')
  }
  try {
    const cache = new EbridgeCache(directory, crypto)
    const state = initialEbridgeState()
    state.courses = [{ code: 'ABC123', title: 'Synthetic module', year: '2026/27', semester: 'SEM1', credits: '5', status: 'Core' }]
    state.timetable = [{ id: 'example', code: 'ABC123', title: 'Synthetic module', date: 'MON', time: '08:00-08:50', room: 'DEMO', type: 'Lecture', staff: '', weeks: '1-12', group: 'D1' }]
    state.exams = [{ id: 'exam-example', code: 'ABC123', title: 'Synthetic module', date: '05/01/2027', dateKey: '2027-01-05', day: 'Tuesday', admissionTime: '08:45', startTime: '09:00', duration: '2 hours', room: 'DEMO', seat: '001', area: '', entrance: '' }]
    state.timetableTerm = { year: '2026/27', semester: 1 }
    state.coursesAt = '2026-11-19T01:00:00.000Z'
    state.timetableAt = '2026-11-19T01:01:00.000Z'
    state.examsAt = '2026-11-19T01:02:00.000Z'
    assert.equal(await cache.read(), null)
    const withExtraFields = { ...state, grades: { ...state.grades, componentsAt: state.coursesAt }, sourceUrl: 'https://example.test/?token=fake' }
    await cache.write('synthetic-owner', withExtraFields)
    const path = join(directory, 'ebridge-cache.bin')
    const onDisk = await readFile(path)
    assert.doesNotMatch(onDisk.toString('utf8'), /synthetic-owner|Synthetic module/)
    assert.doesNotMatch(await crypto.decrypt(onDisk), /grades|sourceUrl|token=fake/)

    const restarted = new EbridgeCache(directory, crypto)
    const restored = await restarted.read()
    assert.ok(restored)
    assert.equal(restored.owner, 'synthetic-owner')
    assert.deepEqual(restored.data.courses, state.courses)
    assert.deepEqual(restored.data.timetable, state.timetable)
    assert.deepEqual(restored.data.timetableTerm, state.timetableTerm)
    assert.deepEqual(restored.data.exams, state.exams)
    assert.equal(restored.data.examsAt, state.examsAt)

    await assert.rejects(restarted.write('synthetic-owner', { ...state, timetableAt: 'invalid' }))
    assert.deepEqual(await restarted.read(), restored)
    await writeFile(path, 'unreadable cache')
    await assert.rejects(restarted.read())
    await restarted.clear()
    assert.equal(await new EbridgeCache(directory, crypto).read(), null)
  } finally {
    // The test owns this freshly-created directory and the single cache file.
    await rm(join(directory, 'ebridge-cache.bin'), { force: true })
    await rmdir(directory)
  }
})
