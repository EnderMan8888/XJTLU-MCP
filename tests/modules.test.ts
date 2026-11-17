import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { fetchModuleSnapshot, fetchTermOptions, parseModules, parseTermNames } from '../src/providers/ams-modules.ts'
import { AmsError, fetchAmsPayload } from '../src/providers/ams.ts'
import { AMS_MODULES, AMS_TERMS } from '../src/shared/ams.ts'

const term = { academicYear: '2026/27', semester: 'SEM1' }
const row = { moduleCode: 'DEMO101', moudleTitle: 'Synthetic module', courseAttendance: '87.5', classHour: '16', signClassHour: '14', absences: '2', leaveClassHour: 0 }
const payload = (rows: unknown[] = [row]) => ({ code: 0, data: { comprehensiveAttendance: '87.5', vos: rows } })

describe('AMS Module attendance data', () => {
  it('preserves the school’s percentage values, course names and term', () => {
    const snapshot = parseModules(payload(), term, '2026-11-03T02:00:00Z')
    assert.deepEqual(snapshot.term, term)
    assert.equal(snapshot.modules[0].code, 'DEMO101')
    assert.equal(snapshot.modules[0].title, 'Synthetic module')
    assert.equal(snapshot.modules[0].attendanceRate, 87.5)
    assert.equal(snapshot.overallAttendanceRate, 87.5)
    assert.equal(snapshot.modules[0].attendedHours, 14)
  })

  it('distinguishes unmeasured attendance from a true zero percent', () => {
    const snapshot = parseModules(payload([{ ...row, courseAttendance: 0, absences: 0 }, { ...row, moduleCode: 'DEMO102', courseAttendance: 0, absences: 2 }]), term)
    assert.equal(snapshot.modules[0].attendanceRate, null)
    assert.equal(snapshot.modules[0].sourceAttendanceRate, 0)
    assert.equal(snapshot.modules[1].attendanceRate, 0)
  })

  it('does not treat a fractional percentage as a ratio to multiply by 100', () => {
    assert.equal(parseModules(payload([{ ...row, courseAttendance: '0.5' }]), term).modules[0].attendanceRate, 0.5)
  })

  it('rejects changed structures and out-of-range percentages rather than showing an empty list', () => {
    for (const response of [{ code: 0, data: [] }, payload([{ ...row, courseAttendance: 101 }]), payload([{ ...row, moduleCode: '' }])]) assert.throws(() => parseModules(response, term), AmsError)
    assert.deepEqual(parseModules(payload([]), term).modules, [])
  })

  it('uses exactly the Module list endpoint and sends the selected term as encoded query parameters', async () => {
    const fetcher = mock.fn(async (_url: string, _init: RequestInit) => Response.json(payload()))
    await fetchModuleSnapshot('synthetic-token', term, fetcher)
    const [address, init] = fetcher.mock.calls[0].arguments
    const url = new URL(address)
    assert.equal(url.origin + url.pathname, AMS_MODULES)
    assert.equal(url.searchParams.get('academicYear'), '2026/27')
    assert.equal(url.searchParams.get('semester'), 'SEM1')
    assert.equal(url.searchParams.get('type'), '1')
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'error')
  })

  it('reads academic years and semesters from school-supplied names', async () => {
    const fetcher = async (url: string): Promise<Response> => Response.json({ code: 0, data: [{ name: new URL(url).searchParams.get('type') === '1' ? '2026/27' : 'SEM1' }] })
    assert.deepEqual(await fetchTermOptions('synthetic-token', fetcher), { academicYears: ['2026/27'], semesters: ['SEM1'] })
    assert.deepEqual(parseTermNames({ code: 0, data: [{ name: 'SEM1' }, { name: 'SEM1' }] }), ['SEM1'])
    assert.throws(() => parseTermNames({ code: 0, data: null }), AmsError)
  })

  it('does not send the authentication token to any other address', async () => {
    const fetcher = mock.fn(async () => Response.json(payload()))
    await assert.rejects(fetchAmsPayload('synthetic-token', 'https://evil.example/list', fetcher), AmsError)
    await assert.rejects(fetchAmsPayload('synthetic-token', `${new URL(AMS_TERMS).origin}/unexpected`, fetcher), AmsError)
    assert.equal(fetcher.mock.callCount(), 0)
  })
})
