import { it } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CampusQueries, type CampusSources } from '../src/mcp/campus-queries.ts'
import { MCP_TOOL_NAMES, startCampusMcp } from '../src/mcp/server.ts'
import { initialState } from '../src/shared/ams.ts'
import { initialEbridgeState } from '../src/shared/ebridge.ts'
import { initialLibraryState } from '../src/shared/library.ts'
import { initialLmcState } from '../src/shared/lmc.ts'
import { McpService } from '../src/main/mcp-service.ts'
import { AgentBookings } from '../src/main/agent-bookings.ts'

const now = Date.parse('2026-11-17T02:00:00Z')
const stamp = new Date(now).toISOString()
function fixture() {
  const ams = initialState(), ebridge = initialEbridgeState(), library = initialLibraryState()
  const lmc = initialLmcState()
  ams.phase = 'connected'
  ams.moduleSnapshot = { term: { academicYear: '2026/27', semester: 'SEM1' }, fetchedAt: stamp, sourceUrl: 'https://school.invalid/?session=PRIVATE', overallAttendanceRate: 75, modules: [
    { code: 'DEMO101', title: 'Example', attendanceRate: 0, sourceAttendanceRate: 0, classHours: 4, attendedHours: 0, absentHours: 4, authorizedAbsenceHours: 0 },
    { code: 'DEMO102', title: 'No statistics', attendanceRate: null, sourceAttendanceRate: 0, classHours: null, attendedHours: null, absentHours: null, authorizedAbsenceHours: null }
  ] }
  ebridge.phase = 'connected'; ebridge.timetableAt = stamp; ebridge.examsAt = stamp
  ebridge.timetableTerm = { year: '2026/27', semester: 1 }
  ebridge.timetable = [
    { id: 'demo', code: 'DEMO101', title: 'Example', date: 'TUE', time: '09:00 - 10:50', room: 'DEMO-ROOM', type: 'Lecture', staff: '', weeks: '1-13', group: 'D1/1' },
    { id: 'demo-next', code: 'DEMO102', title: 'Next example', date: 'WED', time: '10:00 - 10:50', room: 'NEXT-ROOM', type: 'Tutorial', staff: '', weeks: '1-13', group: 'D2/1' }
  ]
  ebridge.exams = [{ id: 'exam', code: 'DEMO101', title: 'Example', date: '10/01/2027', dateKey: '2027-01-10', day: 'Sunday', admissionTime: '08:45', startTime: '09:00', duration: '2 hours', room: 'DEMO-HALL', seat: 'A01', area: 'A', entrance: 'East' }]
  let attendanceLoads = 0, amsRefreshes = 0, ebridgeRefreshes = 0
  const bookingDraftId = '59196f3a-5fd6-428d-8c6f-84f7dbbd0818'
  let submissions = 0
  const agentBookings = new AgentBookings({
    async prepareBooking(selection) {
      return { ...selection, id: bookingDraftId, seat: 'DEMO-01', floor: '3F', notice: '', requiresNotice: false, captchaMode: '0', expiresAt: stamp }
    },
    async submitBooking() { submissions++; return { ok: true, message: '预约成功。' } },
    discardBooking() {}
  }, request => { library.agentBooking = request })
  const folderId = 'activity:1:folder:2', fileId = 'file:demo'
  const downloadId = '1d78f884-2270-40da-9022-3370189bc82e'
  const sources: CampusSources = {
    ams: {
      getState: () => structuredClone(ams),
      refresh: async () => { amsRefreshes++ },
      async loadScheduleAttendance(date) {
        attendanceLoads++
        await new Promise(resolve => setTimeout(resolve, 5))
        ams.scheduleAttendance[date] = { date, term: { academicYear: '2026/27', semester: 'SEM1' }, moduleCodes: ['DEMO101', 'DEMO102'], records: [{ id: 'record', moduleCode: 'DEMO101', date, time: '09:00-11:00', teachingGroup: 'Lecture', attendance: 'present', statusName: 'Present', signTime: `${date} 08:55:00` }], fetchedAt: stamp, loading: false, issue: null }
      }
    },
    ebridge: { getState: () => structuredClone(ebridge), refresh: async () => { ebridgeRefreshes++ }, async loadGrades() {
      const current = { id: 'grade', code: 'DEMO101', title: 'Example', year: '2026/27', period: 'SEM1', credits: '5', moduleType: '', mark: '0', grade: 'F', attempt: '1', components: [{ title: 'Exam', type: 'Exam', weight: '100', mark: '0' }] }
      ebridge.grades.records = [current, { ...current, code: 'DEMO102', year: '2025/26' }]
      ebridge.grades.components = [{ ...current, period: '', mark: null, grade: null }]
      ebridge.grades.recordsAt = ebridge.grades.componentsAt = stamp
    } },
    library: {
      getState: () => structuredClone(library), agentBookings,
      async refresh() {
        library.phase = 'ready'; library.fetchedAt = stamp
        library.floors = [{ key: 'demo', optionKey: 'demo', campus: 'SIP Campus', name: '3F', id: 3, free: 1, total: 2 }]
      },
      async readSeats(query) {
        const seat = { id: 31, floorId: query.floorId, name: 'DEMO-01', available: true, onlyView: false, open: [], occupied: [], minMinutes: null, maxMinutes: null }
        return { query, fetchedAt: stamp, seats: [seat] }
      },
      async getReservations(date) {
        return [{ id: 'demo', seat: 'DEMO-01', begin: `${date} 15:00`, end: `${date} 16:00`, status: 'Confirmed' }]
      }
    },
    lmc: {
      getState: () => structuredClone(lmc),
      async refresh() { lmc.coursesAt = stamp; lmc.coursesComplete = true; lmc.courses = [{ id: '1', title: 'Demo', shortName: 'DEMO101' }] },
      async loadCourse(id) {
        lmc.modules[id] = { courseId: id, activities: [
          { id: folderId, title: 'Readings', section: 'Week 1', type: 'folder', fileType: '', downloadable: false },
          { id: 'activity:1:assign:3', title: 'Example assignment', section: 'Week 1', type: 'assign', fileType: '', downloadable: false, assignmentDates: { opens: null, due: '16 November 2026, 11:55 PM' } }
        ], folders: {}, fetchedAt: stamp, loading: false, issue: null }
      },
      async loadFolder(id) {
        lmc.modules['1'].folders[id] = { files: [{ id: fileId, name: 'Example.pdf', path: 'Reading/Example.pdf', extension: 'pdf' }], fetchedAt: stamp, loading: false, issue: null }
      },
      async readNotificationRange() {
        const notice = { id: '1', title: 'Notice', body: 'Course notice', createdAt: stamp, read: false, hasSource: true, source: 'mod_forum' }
        return { notifications: [notice, { ...notice, id: '2', title: 'New sign in to your Learning Mall Core account' }, { ...notice, id: '3', createdAt: '2026-11-16T15:59:00.000Z' }], fetchedAt: stamp, complete: true, issue: null }
      },
      async startDownload() {
        lmc.downloads = [{ id: downloadId, name: 'Example.pdf', phase: 'downloading', message: '请选择保存位置。', received: 0, total: 100 }]
        return downloadId
      }
    }
  }
  return { ams, ebridge, library, lmc, folderId, fileId, downloadId, sources, queries: new CampusQueries(sources, () => now), counts: () => ({ attendanceLoads, amsRefreshes, ebridgeRefreshes }), submissions: () => submissions }
}

it('MCP reports authenticated library status separately from public floor metadata, without account details', () => {
  const f = fixture(); f.library.phase = 'ready'; f.library.fetchedAt = stamp; f.ams.phase = 'verification-required'
  const status = f.queries.getConnectionStatus().data as any
  assert.equal(status.library.connected, false)
  assert.equal(status.library.needsLogin, true)
  assert.equal(status.ams.needsVerification, true)
  assert.equal(status.ams.needsLogin, true)
  f.ams.phase = 'error'
  assert.equal((f.queries.getConnectionStatus().data as any).ams.needsLogin, null)
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE|password|username|Token/)
})

it('MCP includes LMC connection freshness without exposing course or notification content', () => {
  const f = fixture(), lmc = initialLmcState()
  lmc.phase = 'connected'; lmc.coursesAt = stamp; lmc.notificationsAt = stamp
  lmc.courses = [{ id: '1', title: 'PRIVATE-COURSE', shortName: 'PRIVATE' }]
  f.sources.lmc = { ...f.sources.lmc!, getState: () => structuredClone(lmc) }
  const status = f.queries.getConnectionStatus().data as any
  assert.equal(status.lmc.connected, true)
  assert.equal(status.lmc.needsLogin, false)
  assert.equal(status.lmc.coursesAt, stamp)
  assert.equal(status.lmc.notificationsAt, stamp)
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE/)
  lmc.phase = 'expired'
  assert.equal((f.queries.getConnectionStatus().data as any).lmc.needsLogin, true)
})

it('MCP selects exact timetable dates and rooms, and rejects invalid or unconfigured dates', async () => {
  const f = fixture()
  const today = await f.queries.getTimetable({ date: '2026-11-17' })
  assert.equal(today.complete, true)
  assert.equal((today.data as any).courses[0].room, 'DEMO-ROOM')
  assert.equal((await f.queries.getTimetable({ date: 'tomorrow' })).data!.date, '2026-11-18')
  assert.equal((await f.queries.getTimetable({ date: '2026-02-30' })).code, 'invalid_date')
  assert.equal((await f.queries.getTimetable({ date: '' })).code, 'invalid_date')
  assert.equal((await f.queries.getTimetable({ date: '2027-11-17' })).code, 'calendar_unavailable')
})

it('MCP distinguishes an unread source, a valid empty result, and a failed refresh with cached data', async () => {
  const f = fixture()
  f.ebridge.examsAt = null
  assert.equal((await f.queries.getExams({})).ok, false)
  f.ebridge.examsAt = stamp; f.ebridge.exams = []
  const empty = await f.queries.getExams({})
  assert.equal(empty.ok, true); assert.equal(empty.complete, true); assert.deepEqual(empty.data!.exams, [])
  f.ebridge.issues.exams = '读取失败 https://school.invalid/?session=PRIVATE'
  const stale = await f.queries.getExams({})
  assert.equal(stale.stale, true); assert.equal(stale.complete, false); assert.doesNotMatch(JSON.stringify(stale), /PRIVATE/)
})

it('MCP preserves exam admission/start times, seats, and null versus zero attendance rates', async () => {
  const f = fixture()
  const exams = await f.queries.getExams({ date: '2027-01-10' })
  assert.deepEqual((exams.data as any).exams.map((exam: any) => [exam.admissionTime, exam.startTime, exam.room, exam.seat]), [['08:45', '09:00', 'DEMO-HALL', 'A01']])
  const summary = await f.queries.getAttendanceSummary({})
  assert.equal(summary.data!.overallAttendanceRate, 75)
  assert.deepEqual((summary.data as any).courses.map((course: any) => course.attendanceRate), [0, null])
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|sourceUrl/)
})

it('MCP preserves cached data if refreshing throws, and distinguishes a calendar closure from a read failure', async () => {
  const f = fixture()
  f.sources.ebridge.refresh = async () => { throw new Error('private transport details') }
  const failed = await f.queries.getTimetable({ refresh: true })
  assert.equal(failed.ok, true); assert.equal(failed.stale, true); assert.equal(failed.complete, false)
  assert.equal((failed.data as any).courses.length, 1)
  assert.doesNotMatch(JSON.stringify(failed), /private transport/)
  const closure = await f.queries.getTimetable({ date: '2026-09-25' })
  assert.equal(closure.ok, true); assert.equal(closure.complete, true)
  assert.deepEqual(closure.data!.courses, [])
})

it('MCP reads Module Detail once for concurrent requests and matches the ten-minute timetable difference', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([f.queries.getAttendanceRecords({}), f.queries.getAttendanceRecords({ date: 'today' })])
  assert.equal(f.counts().attendanceLoads, 1)
  assert.deepEqual(a, b)
  assert.equal(a.complete, true)
  assert.equal((a.data as any).records[0].attendance, 'present')
  assert.equal((a.data as any).records[0].signTime, '2026-11-17 08:55:00')
  assert.equal((a.data as any).records[0].room, 'DEMO-ROOM')
})

it('MCP restricts records to three Beijing dates and never treats an unmatched or missing record as absent', async () => {
  const f = fixture()
  assert.equal((await f.queries.getAttendanceRecords({ date: '2026-11-15' })).code, 'unsupported_date')
  assert.equal(f.counts().attendanceLoads, 0)
  const tomorrow = await f.queries.getAttendanceRecords({ date: 'tomorrow' })
  assert.equal((tomorrow.data as any).records[0].attendance, 'unmatched')
  assert.equal((tomorrow.data as any).records[0].signTime, null)
  assert.equal(tomorrow.complete, false)
  f.ams.phase = 'expired'; f.ams.scheduleAttendance = {}
  const missing = await f.queries.getAttendanceRecords({})
  assert.equal(missing.ok, false)
  assert.equal((missing.data as any).records[0].attendance, 'unavailable')
})

it('MCP keeps old records marked stale during source failures and does not start a new login on refresh', async () => {
  const f = fixture()
  await f.queries.getAttendanceRecords({})
  f.ams.phase = 'expired'
  const cached = await f.queries.getAttendanceRecords({ refresh: true })
  assert.equal(cached.stale, true); assert.equal(cached.complete, false)
  assert.equal((cached.data as any).records[0].attendance, 'present')
  assert.equal(f.counts().amsRefreshes, 0)
})

it('MCP discards in-flight and cached results after an account change', async () => {
  const f = fixture()
  const pending = f.queries.getAttendanceRecords({})
  f.queries.invalidate()
  assert.equal((await pending).code, 'account_changed')
  assert.equal((await f.queries.getAttendanceSummary({})).ok, false)
  const later = new CampusQueries(f.sources, () => now + 1)
  later.invalidate()
  assert.equal((await later.getAttendanceSummary({})).ok, false)
})

it('MCP credential edits cancel in-flight work while preserving the active account cache', async () => {
  const f = fixture()
  f.queries.cancelPending()
  assert.equal((await f.queries.getAttendanceSummary({})).ok, true)
})

it('MCP resolves today by Beijing time at a UTC day boundary', async () => {
  const f = fixture()
  const queries = new CampusQueries(f.sources, () => Date.parse('2026-11-16T17:00:00Z'))
  assert.equal((await queries.getTimetable({})).data!.date, '2026-11-17')
})

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'xjtlu-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}
function post(url: string, headers: Record<string, string>, body = '{}'): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk }); res.on('end', () => {
        const events = res.headers['content-type']?.startsWith('text/event-stream') ? text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim())) : null
        resolve({ status: res.statusCode!, body: events ? events.reverse().find(message => 'result' in message || 'error' in message) ?? null : text ? JSON.parse(text) : null })
      })
    })
    req.on('error', reject); req.end(body)
  })
}

it('authenticates and calls all sixteen workbook tools through the official client', async t => {
  const f = fixture(), token = 'a'.repeat(64)
  f.library.booking.phase = f.lmc.phase = 'connected'
  f.ebridge.coursesAt = stamp
  f.ebridge.courses = [
    { code: 'DEMO101', title: 'Current', year: '2026/27', semester: 'SEM1', credits: '5', status: '' },
    { code: 'DEMO102', title: 'Previous', year: '2025/26', semester: 'SEM1', credits: '5', status: '' }
  ]
  t.after(() => (f.sources.library.agentBookings as AgentBookings).reset())
  const server = await startCampusMcp(f.queries, token, '1.0.0', 0)
  t.after(() => server.close())
  const client = await connect(server.url, token)
  t.after(() => client.close())
  const tools = await client.listTools()
  assert.deepEqual(tools.tools.map(tool => tool.name), [...MCP_TOOL_NAMES])
  assert.equal(tools.tools.length, 16)
  assert.deepEqual(tools.tools.filter(tool => !tool.annotations?.readOnlyHint).map(tool => tool.name), ['reserve_library_seat', 'download_lmc_file'])
  async function call(name: typeof MCP_TOOL_NAMES[number], args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args })
    assert.equal(result.isError, false, name)
    assert.equal((result.structuredContent as Record<string, unknown>)?.ok, true)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|password|sourceUrl/)
    return result.structuredContent as { complete: boolean; data: Record<string, any> }
  }
  for (const name of ['get_connection_status', 'get_timetable', 'get_exams', 'get_attendance_summary', 'get_attendance_records'] as const) await call(name)
  assert.equal((await call('get_modules')).data.modules.length, 1)
  assert.equal((await call('get_grades')).data.componentMarks[0].components[0].mark, '0')
  assert.equal((await call('get_grades', { scope: 'all' })).data.records.length, 2)
  assert.equal((await call('refresh_source', { source: 'lmc' })).data.timestamps.courses, stamp)
  assert.equal((await call('get_library_overview')).data.floors[0].free, 1)
  const seats = await call('get_library_seats', { floorId: 3 })
  assert.equal(seats.data.seats[0].seatNumber, 'DEMO-01')
  assert.equal(f.library.search, null)
  const pending = await call('reserve_library_seat', { floorId: 3, seatNumber: 'DEMO-01' })
  assert.equal(pending.complete, false)
  assert.equal(pending.data.booked, null)
  assert.equal(f.submissions(), 0)
  const booking = f.sources.library.agentBookings as AgentBookings
  const draft = await booking.review(pending.data.requestId)
  assert.equal(f.submissions(), 0)
  await booking.submit(pending.data.requestId, draft.id, true, '')
  assert.equal((await call('reserve_library_seat', { requestId: pending.data.requestId })).data.booked, true)
  assert.equal(f.submissions(), 1)
  assert.equal((await call('get_library_reservations')).data.reservations[0].seat, 'DEMO-01')
  const notices = await call('get_lmc_notification', { from: '2026-11-17', to: '2026-11-17' })
  assert.equal(notices.data.hiddenSignInCount, 1)
  assert.equal(notices.data.notifications.length, 1)
  assert.equal((await call('list_lmc_modules')).data.courses[0].courseId, '1')
  const moduleContents = await call('get_module_contents', { courseId: '1' })
  assert.equal(moduleContents.data.activities[0].folderId, f.folderId)
  assert.deepEqual(moduleContents.data.activities[1].assignmentDates, { opens: null, due: '16 November 2026, 11:55 PM' })
  assert.equal((await call('get_module_contents', { courseId: '1', folderId: f.folderId })).data.files[0].fileId, f.fileId)
  const download = await call('download_lmc_file', { courseId: '1', folderId: f.folderId, fileName: 'Example.pdf', path: 'Reading/Example.pdf' })
  assert.equal(download.complete, false)
  assert.equal(download.data.downloaded, null)
  f.lmc.downloads[0].phase = 'completed'
  assert.equal((await call('download_lmc_file', { downloadId: f.downloadId })).data.downloaded, true)
  const invalid = await client.callTool({ name: 'get_attendance_records', arguments: { date: '2026-11-14' } })
  assert.equal(invalid.isError, true)
  assert.equal((invalid.structuredContent as Record<string, unknown>)?.code, 'unsupported_date')
  const unexpected = await client.callTool({ name: 'get_timetable', arguments: { date: 123 } })
  assert.equal(unexpected.isError, true)
  const bypass = await client.callTool({ name: 'reserve_library_seat', arguments: { floorId: 3, seatId: 31, acceptedNotice: true } })
  assert.equal(bypass.isError, true)
  const unlistedFile = await client.callTool({ name: 'download_lmc_file', arguments: { courseId: '1', fileId: 'https://example.invalid/file.pdf' } })
  assert.equal((unlistedFile.structuredContent as Record<string, unknown>)?.code, 'file_not_found')
})

it('MCP rejects unauthenticated, cross-origin, rebinding, oversized, and credential-in-URL requests', async t => {
  const token = 'b'.repeat(64), server = await startCampusMcp(fixture().queries, token, '1.0.0', 0)
  t.after(() => server.close())
  const auth = { Authorization: `Bearer ${token}` }
  assert.equal((await post(server.url, {})).status, 401)
  assert.equal((await post(server.url, { Authorization: `Bearer ${'c'.repeat(64)}` })).status, 401)
  assert.equal((await post(server.url, { ...auth, Origin: 'https://example.invalid' })).status, 403)
  assert.equal((await post(server.url, { ...auth, Origin: 'null' })).status, 403)
  assert.equal((await post(server.url, { ...auth, Host: 'example.invalid' })).status, 403)
  assert.equal((await post(`${server.url}?access_token=unused`, auth)).status, 404)
  assert.equal((await post(server.url, auth, JSON.stringify({ padding: 'x'.repeat(40_000) }))).status, 413)
})

it('MCP also serves a 2025-era initialize and tools/list on the same endpoint', async t => {
  const token = 'd'.repeat(64), server = await startCampusMcp(fixture().queries, token, '1.0.0', 0)
  t.after(() => server.close())
  const headers = { Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2025-11-25' }
  const initialized = await post(server.url, headers, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1' } } }))
  assert.equal(initialized.status, 200); assert.equal(initialized.body.result.protocolVersion, '2025-11-25')
  const listed = await post(server.url, headers, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }))
  assert.deepEqual(listed.body.result.tools.map((tool: any) => tool.name), [...MCP_TOOL_NAMES])
})

it('MCP service copies configuration through the main process and revokes old keys on rotation', async t => {
  let token = 'e'.repeat(64)
  const service = new McpService(fixture().queries, { readOrCreate: async () => token, rotate: async () => { token = 'f'.repeat(64); return token } }, '1.0.0', () => {}, 0)
  t.after(() => service.dispose())
  await service.setEnabled(true)
  assert.equal(service.getStatus().phase, 'ready')
  assert.doesNotMatch(JSON.stringify(service.getStatus()), new RegExp(token))
  let copied = ''
  service.copyConfig('json', text => { copied = text })
  assert.equal(JSON.parse(copied).mcpServers.xjtlu.headers.Authorization, `Bearer ${token}`)
  service.copyConfig('codex', text => { copied = text })
  assert.match(copied, /\[mcp_servers.xjtlu\]/)
  const address = service.getStatus().url
  assert.ok(address)
  service.copyConfig('deepseek', text => { copied = text })
  const harness = JSON.parse(copied).xjtlu
  assert.deepEqual(harness, {
    transport: 'streamable-http',
    url: address,
    headers: { Authorization: 'Bearer ${credential:XJTLU_MCP_TOKEN}' },
    enabled: true
  })
  assert.ok(!copied.includes(token))
  service.copyConfig('workbuddy', text => { copied = text })
  const workbuddy = JSON.parse(copied).mcpServers.xjtlu
  assert.deepEqual(workbuddy, {
    type: 'streamableHttp', url: address, headers: { Authorization: `Bearer ${token}` }, timeout: 30000
  })
  service.copyConfig('mimocode', text => { copied = text })
  const mimo = JSON.parse(copied).mcp.xjtlu
  assert.deepEqual(mimo, {
    type: 'remote', url: address, oauth: false, enabled: true, headers: { Authorization: `Bearer ${token}` }
  })
  service.copyConfig('kimi', text => { copied = text })
  const kimi = JSON.parse(copied).mcpServers.xjtlu
  assert.deepEqual(kimi, { url: address, bearerTokenEnvVar: 'XJTLU_MCP_TOKEN' })
  assert.ok(!copied.includes(token))
  const fixtureEnv = { XJTLU_MCP_TOKEN: token }
  const clientConfigs = [
    { url: harness.url, auth: harness.headers.Authorization.replace('${credential:XJTLU_MCP_TOKEN}', fixtureEnv.XJTLU_MCP_TOKEN) },
    { url: workbuddy.url, auth: workbuddy.headers.Authorization },
    { url: mimo.url, auth: mimo.headers.Authorization },
    { url: kimi.url, auth: `Bearer ${fixtureEnv[kimi.bearerTokenEnvVar as keyof typeof fixtureEnv]}` }
  ]
  for (const { url, auth } of clientConfigs) {
    const client = await connect(url, auth.slice('Bearer '.length))
    try {
      assert.equal((await client.listTools()).tools.length, 16)
      const status = await client.callTool({ name: 'get_connection_status', arguments: {} })
      assert.equal((status.structuredContent as { ok?: boolean } | undefined)?.ok, true)
    } finally {
      await client.close()
    }
  }
  service.copyConfig('url', text => { copied = text })
  const connectorUrl = copied
  assert.equal(connectorUrl, service.getStatus().url)
  service.copyConfig('bearer', text => { copied = text })
  assert.equal(copied, `Bearer ${token}`)
  const connector = await connect(connectorUrl, copied.slice('Bearer '.length))
  assert.equal((await connector.listTools()).tools.length, 16)
  const connectorStatus = await connector.callTool({ name: 'get_connection_status', arguments: {} })
  assert.equal((connectorStatus.structuredContent as { ok?: boolean } | undefined)?.ok, true)
  await connector.close()
  const old = token
  await service.rotateKey()
  const url = service.getStatus().url!
  assert.equal((await post(url, { Authorization: `Bearer ${old}` })).status, 401)
  const client = await connect(url, token)
  await client.close()
  await service.setEnabled(false)
  assert.equal(service.getStatus().phase, 'stopped')
  assert.throws(() => service.copyConfig('token', () => {}), /先开启/)
})
