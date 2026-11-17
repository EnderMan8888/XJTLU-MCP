import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { AmsError, fetchTimetable, parseTimetable } from '../src/providers/ams.ts'
import { AMS_TIMETABLE } from '../src/shared/ams.ts'

// Synthetic fixtures, not student records.
const entry = { moduleCode: 'DEMO101', moduleTitle: 'Synthetic course', moduleDate: '2026-11-02', moduleTime: '09:00-10:00', room: 'DEMO ROOM', moduleTypeGroup: 'LECTURE', status: 1 }
const payload = (rows: unknown[] = [entry]): unknown => ({ code: 0, data: [{ date: '11-02', timetableVoList: rows }] })

describe('AMS response normalization', () => {
  it('preserves source dates and maps all observed statuses without guessing unknown values', () => {
    const days = parseTimetable(payload([0, 1, 2, 3, 99, null].map((status) => ({ ...entry, status }))))
    assert.deepEqual(days[0].entries.map((row) => row.attendance), ['unmarked', 'present', 'absent', 'authorized-absence', 'unknown', 'unknown'])
    assert.equal(days[0].entries[0].date, '2026-11-02')
    assert.equal(days[0].entries[0].time, '09:00-10:00')
    assert.equal(days[0].entries[0].teachingGroup, 'LECTURE')
    assert.equal(new Set(days[0].entries.map((row) => row.id)).size, 6)
  })
  it('keeps legitimate empty days while removing empty placeholder dates', () => {
    assert.deepEqual(parseTimetable({ code: 0, data: [{ date: '-', timetableVoList: [] }, { date: '11-02', timetableVoList: [] }] }), [{ date: '11-02', entries: [] }])
    assert.deepEqual(parseTimetable({ code: 0, data: [] }), [])
  })
  it('does not turn malformed data or a failed response into no courses', () => {
    for (const body of [null, { code: 0 }, { code: 0, data: null }, payload([{}]), { code: 500, data: [] }]) {
      assert.throws(() => parseTimetable(body), AmsError)
    }
  })
  it('recognizes expiry inside an HTTP-success envelope', () => {
    assert.throws(() => parseTimetable({ code: '401', data: null }), /登录已过期/)
  })
})

describe('read-only AMS requests', () => {
  it('sends the token only to the fixed HTTPS endpoint and rejects redirects', async () => {
    const fetcher = mock.fn(async (_url: string, _init: RequestInit) => Response.json(payload()))
    await fetchTimetable('test-only-token', fetcher)
    const [url, options] = fetcher.mock.calls[0].arguments
    assert.equal(url, AMS_TIMETABLE)
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    assert.deepEqual(options.headers, { Accept: 'application/json', 'X-Token': 'test-only-token' })
  })
  it('does not make a network call before login', async () => {
    const fetcher = mock.fn(async () => Response.json(payload()))
    await assert.rejects(fetchTimetable('', fetcher), { kind: 'auth' })
    assert.equal(fetcher.mock.callCount(), 0)
  })
  it('distinguishes authentication errors, HTML login pages, and network failures', async () => {
    await assert.rejects(fetchTimetable('test', async () => new Response(null, { status: 401 })), { kind: 'auth' })
    await assert.rejects(fetchTimetable('test', async () => new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } })), { kind: 'schema' })
    await assert.rejects(fetchTimetable('test', async () => { throw new Error('private request details') }), { kind: 'network', message: '无法连接 AMS，请检查网络后重试。' })
  })
  it('rejects oversized response bodies', async () => {
    await assert.rejects(fetchTimetable('test', async () => new Response(' '.repeat(2_000_001), { headers: { 'content-type': 'application/json' } })), { kind: 'schema', message: 'AMS 响应过大，已停止读取。' })
  })
})
