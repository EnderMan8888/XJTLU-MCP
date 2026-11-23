import type { AmsState, ConnectionPhase } from '../shared/ams.ts'
import type { EbridgeState } from '../shared/ebridge.ts'
import type { AgentBooking, LibraryReservation, LibrarySeat, LibraryState, SeatSearch, SeatSelection } from '../shared/library.ts'
import type { ModuleAttendanceSnapshot } from '../shared/modules.ts'
import { isSignInNotice, type LmcNotificationRange, type LmcState } from '../shared/lmc.ts'
import { academicTermOn, beijingDate } from '../shared/academic-calendar.ts'
import { libraryNowWindow } from '../shared/library-time.ts'
import { LibraryError } from '../providers/library.ts'
import { ebridgeTimetableForDate } from '../shared/ebridge-timetable.ts'
import { amsRelativeDays, matchModuleAttendance, moduleAttendanceLabels } from '../shared/module-attendance.ts'

export interface CampusSources {
  ams: { getState(): AmsState; refresh(): Promise<void>; loadScheduleAttendance(date: string, ebridge: EbridgeState): Promise<void> }
  ebridge: { getState(): EbridgeState; refresh(): Promise<void>; loadGrades(): Promise<void> }
  library: {
    getState(): LibraryState
    refresh(): Promise<void>
    readSeats(query: SeatSearch): Promise<{ query: SeatSearch; seats: LibrarySeat[]; fetchedAt: string }>
    getReservations(date: string): Promise<LibraryReservation[]>
    agentBookings: { get(id: string): AgentBooking | undefined; request(selection: SeatSelection, seat: string): AgentBooking | null }
  }
  lmc?: {
    getState(): LmcState
    refresh(): Promise<void>
    loadCourse(id: string): Promise<void>
    loadFolder(id: string): Promise<void>
    readNotificationRange(since: number): Promise<LmcNotificationRange>
    startDownload(id: string): Promise<string | null>
  }
}
export type CampusSource = keyof CampusSources
export interface SeatWindowInput { floorId: number; date?: string; start?: string; end?: string }
export type ReserveSeatInput = { requestId: string } | (SeatWindowInput & ({ seatId: number } | { seatNumber: string }) & { title?: string; memo?: string })
export type LmcDownloadInput = { downloadId: string } | { courseId: string; fileId: string } | { courseId: string; fileName: string; folderId?: string; path?: string }
export interface QueryResult {
  ok: boolean
  code: string | null
  message: string | null
  source: string
  timezone: 'Asia/Shanghai'
  fetchedAt: string | null
  stale: boolean
  complete: boolean
  data: Record<string, unknown> | null
}
export const MCP_CACHE_MAX_AGE = 5 * 60_000

function validDate(date: string): boolean {
  const time = Date.parse(`${date}T00:00:00Z`)
  return /^20\d{2}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date
}
// Error descriptions can contain upstream URLs. Never forward session links.
const safeMessage = (message: string | null): string | null => message?.replace(/https?:\/\/[^\s<>]+/gi, '[学校链接]') ?? null
const calendarIssue = (message: string | null): string | null => message === '所选日期不在校历教学日内。' ? null : message
const semesterNumber = (period: string): number | null => Number(period.trim().match(/^(?:SEM(?:ESTER)?\s*)?([12])$/i)?.[1]) || null
const yearKey = (year: string): string => year.trim().replace(/^(20\d{2})\/20(\d{2})$/, '$1/$2')

function subtractMonths(date: string, months: number): string {
  const time = new Date(`${date}T00:00:00Z`)
  const day = time.getUTCDate()
  time.setUTCDate(1)
  time.setUTCMonth(time.getUTCMonth() - months + 1, 0)
  time.setUTCDate(Math.min(day, time.getUTCDate()))
  return time.toISOString().slice(0, 10)
}

export class CampusQueries {
  private sources: CampusSources
  private now: () => number
  private pending = new Map<string, Promise<void>>()
  private revision = 0
  private notBefore = 0
  constructor(sources: CampusSources, now: () => number = Date.now) { this.sources = sources; this.now = now }

  cancelPending(): void { this.revision++; this.pending.clear() }
  invalidate(): void { this.cancelPending(); this.notBefore = this.now() }

  private usable(stamp: string | null): boolean {
    return !!stamp && Number.isFinite(Date.parse(stamp)) && Date.parse(stamp) > this.notBefore
  }
  private result(source: string, phase: ConnectionPhase, stamp: string | null, issue: string | null, data: Record<string, unknown> | null, code: string | null = null): QueryResult {
    return {
      ok: code === null, code, message: safeMessage(issue), source, timezone: 'Asia/Shanghai', fetchedAt: stamp,
      stale: !this.usable(stamp) || this.now() - Date.parse(stamp!) > MCP_CACHE_MAX_AGE || phase !== 'connected' || !!issue,
      complete: code === null && !issue && phase === 'connected', data
    }
  }
  private unavailable(source: string, phase: ConnectionPhase, message: string, code = 'data_unavailable'): QueryResult {
    return this.result(source, phase, null, message, null, code)
  }
  private async once(key: string, operation: () => Promise<void>): Promise<void> {
    let task = this.pending.get(key)
    if (!task) {
      task = operation().finally(() => { if (this.pending.get(key) === task) this.pending.delete(key) })
      this.pending.set(key, task)
    }
    await task
  }
  private async guarded(operation: () => Promise<QueryResult>): Promise<QueryResult> {
    const revision = this.revision
    try {
      const result = await operation()
      return revision === this.revision ? result : this.unavailable('campus', 'idle', '学校账号已变化，请等待应用重新读取数据。', 'account_changed')
    } catch {
      return revision === this.revision
        ? this.unavailable('campus', 'error', '查询未能完成，请在桌面应用查看连接状态后重试。', 'query_failed')
        : this.unavailable('campus', 'idle', '学校账号已变化，请等待应用重新读取数据。', 'account_changed')
    }
  }
  private date(value?: string): string | null {
    if (value === undefined || value === 'today') return beijingDate(this.now())
    if (value === 'yesterday' || value === 'tomorrow') return amsRelativeDays(this.now()).find(day => day.offset === (value === 'yesterday' ? -1 : 1))!.date
    return validDate(value) ? value : null
  }
  private async refresh(source: 'ams' | 'ebridge', enabled: boolean): Promise<string | null> {
    // Leave disconnected sources under the desktop application's login controls.
    if (enabled && this.sources[source].getState().phase === 'connected') {
      try { await this.once(source, () => this.sources[source].refresh()) }
      catch { return `${source === 'ams' ? 'AMS' : 'eBridge'} 刷新未完成，保留先前可用结果。` }
    }
    return null
  }

  getConnectionStatus(): QueryResult {
    const ams = this.sources.ams.getState(), ebridge = this.sources.ebridge.getState(), library = this.sources.library.getState()
    const status = (phase: ConnectionPhase) => ({
      phase, connected: phase === 'connected',
      needsLogin: ['credentials-required', 'expired', 'verification-required', 'manual-login-required', 'idle'].includes(phase) ? true : phase === 'connected' ? false : null,
      needsVerification: phase === 'verification-required',
      action: phase === 'connected' ? null : phase === 'verification-required' ? '在桌面应用的学校窗口完成验证。' : phase === 'manual-login-required' ? '在桌面应用点击“手动登录”，并在学校窗口完成登录。' : phase === 'credentials-required' ? '在桌面应用首页设置学校账号。' : '在桌面应用检查或连接此服务。'
    })
    return this.result('campus', 'connected', new Date(this.now()).toISOString(), null, {
      checkedAt: new Date(this.now()).toISOString(),
      ams: { ...status(ams.phase), timetableAt: ams.fetchedAt, attendanceSummaryAt: ams.moduleSnapshot?.fetchedAt ?? null },
      ebridge: { ...status(ebridge.phase), coursesAt: ebridge.coursesAt, timetableAt: ebridge.timetableAt, examsAt: ebridge.examsAt },
      // Public floor metadata being ready does not imply an authenticated session.
      library: { ...status(library.booking.phase), floorsAt: library.fetchedAt },
      ...(this.sources.lmc ? { lmc: (() => { const state = this.sources.lmc!.getState(); return { ...status(state.phase), coursesAt: state.coursesAt, notificationsAt: state.notificationsAt } })() } : {})
    })
  }

  refreshSource(source: CampusSource): Promise<QueryResult> {
    return this.guarded(async () => {
      const service = this.sources[source]
      if (!service) return this.unavailable(source, 'idle', '数据来源尚未启用。')
      if (source === 'library') return this.getLibraryOverview({ refresh: true })
      const before = this.getConnectionStatus().data?.[source] as { phase: ConnectionPhase; connected: boolean }
      if (!before.connected) return this.unavailable(source, before.phase, '请先在桌面应用连接此服务。', 'not_connected')
      let issue: string | null = null
      try { await this.once(source, () => service.refresh()) }
      catch { issue = '刷新未完成。' }
      const state = service.getState()
      let timestamps: Record<string, string | null>
      if ('coursesComplete' in state) {
        timestamps = { courses: state.coursesAt, notifications: state.notificationsAt }
        issue ??= state.issues.courses || state.issues.notifications || (!state.coursesComplete ? '课程列表尚未读取完整。' : null)
      } else if ('examsAt' in state) {
        timestamps = { courses: state.coursesAt, timetable: state.timetableAt, exams: state.examsAt }
        issue ??= state.issues.courses || state.issues.timetable || state.issues.exams
      } else if ('moduleSnapshot' in state) {
        timestamps = { timetable: state.fetchedAt, attendanceSummary: state.moduleSnapshot?.fetchedAt ?? null }
        issue ??= state.issues.modules || (!state.moduleSnapshot ? '签到率尚未读取。' : null)
      } else return this.unavailable(source, 'error', '未知数据来源。')
      const latest = Object.values(timestamps).filter((stamp): stamp is string => this.usable(stamp)).sort().at(-1) ?? null
      if (state.phase !== 'connected' || !latest) issue ??= '来源尚未返回可用数据，请在桌面应用检查连接。'
      return this.result(source, state.phase, latest, issue, { timestamps }, state.phase !== 'connected' || !latest ? 'refresh_failed' : null)
    })
  }

  getModules(input: { refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const issue = await this.refresh('ebridge', !!input.refresh)
      const state = this.sources.ebridge.getState()
      if (!this.usable(state.coursesAt)) return this.unavailable('eBridge Modules', state.phase, '尚未读取课程列表，请先在桌面应用连接 eBridge。')
      const term = academicTermOn(beijingDate(this.now()))
      const year = term?.year ?? state.timetableTerm?.year ?? state.courses.map(course => yearKey(course.year)).filter(year => /^20\d{2}\/\d{2}$/.test(year)).sort().at(-1) ?? null
      const modules = state.courses.filter(course => !year || !course.year || yearKey(course.year) === year).map(course => ({
        moduleCode: course.code, title: course.title, year: course.year, semester: course.semester, credits: course.credits, status: course.status
      }))
      return this.result('eBridge Modules', state.phase, state.coursesAt, state.issues.courses || issue, { year, modules })
    })
  }

  getGrades(input: { scope?: 'current' | 'all'; refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const source = 'eBridge Academic Records'
      const service = this.sources.ebridge
      let state = service.getState()
      const scope = input.scope ?? 'current'
      let issue: string | null = null
      if (state.phase === 'connected' && (input.refresh || !this.usable(state.grades.recordsAt) || !this.usable(state.grades.componentsAt))) {
        try { await this.once('ebridge:grades', () => service.loadGrades()) }
        catch { issue = '成绩未能更新，保留先前可用结果。' }
        state = service.getState()
      }
      const { grades } = state
      const recordsAt = this.usable(grades.recordsAt) ? grades.recordsAt : null
      const componentsAt = this.usable(grades.componentsAt) ? grades.componentsAt : null
      if (!recordsAt && !componentsAt) return this.unavailable(source, state.phase, issue || state.issues.grades || '尚未读取成绩，请先连接 eBridge。')
      const term = scope === 'current' ? academicTermOn(beijingDate(this.now())) ?? state.timetableTerm : null
      if (scope === 'current' && !term) return this.unavailable(source, state.phase, '无法确认当前学期，请刷新 eBridge 或查询所有成绩。', 'term_unavailable')
      const records = (recordsAt ? grades.records : []).filter(row => !term || yearKey(row.year) === term.year && semesterNumber(row.period) === term.semester)
      const recentComponents = componentsAt ? grades.components : []
      const registered = this.usable(state.coursesAt) ? state.courses : []
      const periods = new Map<string, Set<number>>()
      if (term) {
        for (const row of [...registered.map(course => ({ ...course, period: course.semester })), ...(recordsAt ? grades.records : [])]) {
          if (yearKey(row.year) !== term.year) continue
          const semester = semesterNumber(row.period)
          if (!semester) continue
          const key = row.code.toUpperCase().replace(/\s+/g, '')
          const existing = periods.get(key) ?? new Set<number>()
          existing.add(semester)
          periods.set(key, existing)
        }
      }
      let unmatchedModules = 0
      const componentMarks = recentComponents.filter(row => {
        if (!term) return true
        if (row.year && yearKey(row.year) !== term.year) return false
        const termNumbers = periods.get(row.code.toUpperCase().replace(/\s+/g, ''))
        const period = semesterNumber(row.period)
        if (period) return period === term.semester && yearKey(row.year) === term.year
        if (!row.year || termNumbers?.size !== 1) { unmatchedModules++; return false }
        return termNumbers.has(term.semester)
      })
      const issues = [issue, grades.issues.records, grades.issues.components,
        !recordsAt || !componentsAt ? '分项成绩或完整记录尚未读齐。' : null,
        unmatchedModules ? `${unmatchedModules} 门课的分项成绩尚无法确认学期，可在所有成绩中查看。` : null].filter(Boolean).join(' ') || null
      return this.result(source, state.phase, [recordsAt, componentsAt].filter((stamp): stamp is string => !!stamp).sort()[0], issues,
        { scope, term, recordsAt, componentsAt, records, componentMarks })
    })
  }

  getTimetable(input: { date?: string; refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const date = this.date(input.date)
      if (!date) return this.unavailable('eBridge Timetable', 'error', '日期应为有效的 YYYY-MM-DD，或 today、yesterday、tomorrow。', 'invalid_date')
      const refreshIssue = await this.refresh('ebridge', !!input.refresh)
      const state = this.sources.ebridge.getState()
      if (!this.usable(state.timetableAt)) return this.unavailable('eBridge Timetable', state.phase, '尚无可用课表，请先在桌面应用连接或刷新 eBridge。')
      const day = ebridgeTimetableForDate(state, date)
      if (!day.known) return this.unavailable('eBridge Timetable', state.phase, day.message ?? '无法确认该日期的课表。', 'calendar_unavailable')
      return this.result('eBridge Timetable', state.phase, state.timetableAt, state.issues.timetable || refreshIssue || calendarIssue(day.message), {
        date, teachingWeek: day.week, term: state.timetableTerm, calendarNote: day.message,
        courses: day.rows.map(row => ({ moduleCode: row.code, title: row.title, date, time: row.time, room: row.room, teachingGroup: row.group, type: row.type }))
      })
    })
  }

  getExams(input: { date?: string; refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const date = input.date === undefined ? undefined : this.date(input.date)
      if (date === null) return this.unavailable('eBridge Examinations', 'error', '考试日期无效。', 'invalid_date')
      const refreshIssue = await this.refresh('ebridge', !!input.refresh)
      const state = this.sources.ebridge.getState()
      if (!this.usable(state.examsAt)) return this.unavailable('eBridge Examinations', state.phase, '尚未读取考试表，请先在桌面应用连接或刷新 eBridge。')
      const unknown = state.exams.some(exam => !exam.dateKey)
      return this.result('eBridge Examinations', state.phase, state.examsAt, state.issues.exams || refreshIssue || (unknown ? '部分考试日期无法识别，请在桌面应用核对原表。' : null), {
        date: date ?? null,
        exams: state.exams.filter(exam => !date || exam.dateKey === date).sort((a, b) => (a.dateKey ?? '9999').localeCompare(b.dateKey ?? '9999') || a.startTime.localeCompare(b.startTime)).map(exam => ({
          moduleCode: exam.code, title: exam.title, date: exam.dateKey, sourceDate: exam.date, day: exam.day,
          admissionTime: exam.admissionTime, startTime: exam.startTime, duration: exam.duration, room: exam.room, seat: exam.seat, area: exam.area, entrance: exam.entrance
        }))
      })
    })
  }

  getAttendanceSummary(input: { refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const refreshIssue = await this.refresh('ams', !!input.refresh)
      const state = this.sources.ams.getState(), snapshot = state.moduleSnapshot
      if (!snapshot || !this.usable(snapshot.fetchedAt)) return this.unavailable('AMS Module', state.phase, '尚无签到率数据，请先在桌面应用连接或刷新 AMS。')
      return this.result('AMS Module', state.phase, snapshot.fetchedAt, state.issues.modules || refreshIssue, {
        term: snapshot.term, overallAttendanceRate: snapshot.overallAttendanceRate, rateUnit: 'percent',
        courses: snapshot.modules.map(module => ({ moduleCode: module.code, title: module.title, attendanceRate: module.attendanceRate, classHours: module.classHours, attendedHours: module.attendedHours, absentHours: module.absentHours, authorizedAbsenceHours: module.authorizedAbsenceHours }))
      })
    })
  }

  getAttendanceRecords(input: { date?: string; refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const date = this.date(input.date)
      if (!date) return this.unavailable('AMS Module Detail', 'error', '考勤日期无效。', 'invalid_date')
      const supportedDates = amsRelativeDays(this.now()).map(day => day.date)
      if (!supportedDates.includes(date)) return this.unavailable('AMS Module Detail', 'error', `单节考勤目前仅支持北京时间今天、昨天、明天：${supportedDates.join('、')}。`, 'unsupported_date')
      const refreshIssues = await Promise.all([this.refresh('ams', !!input.refresh), this.refresh('ebridge', !!input.refresh)])
      const ebridge = this.sources.ebridge.getState()
      if (!this.usable(ebridge.timetableAt)) return this.unavailable('AMS Module Detail', ebridge.phase, '需要先读取 eBridge Timetable，以确认当天课程、教室和教学组。')
      const day = ebridgeTimetableForDate(ebridge, date)
      if (!day.known || !ebridge.timetableTerm) return this.unavailable('AMS Module Detail', ebridge.phase, day.message ?? '无法确认当天课程。', 'calendar_unavailable')
      const term = { academicYear: ebridge.timetableTerm.year, semester: `SEM${ebridge.timetableTerm.semester}` }
      const matchesTerm = (snapshot: ModuleAttendanceSnapshot | null | undefined): snapshot is ModuleAttendanceSnapshot => !!snapshot && snapshot.date === date && snapshot.term.academicYear === term.academicYear && snapshot.term.semester === term.semester && this.usable(snapshot.fetchedAt) && day.rows.every(row => snapshot.moduleCodes.includes(row.code))
      let state = this.sources.ams.getState()
      const cached = state.scheduleAttendance[date]
      let recordIssue: string | null = null
      if (state.phase === 'connected' && day.rows.length && (input.refresh || (!matchesTerm(cached) && !matchesTerm(state.moduleAttendance)))) {
        try { await this.once(`records:${date}:${ebridge.timetableAt}`, () => this.sources.ams.loadScheduleAttendance(date, ebridge)) }
        catch { recordIssue = '单节考勤未能更新，保留先前可用结果。' }
        state = this.sources.ams.getState()
      }
      const current = state.scheduleAttendance[date]
      const snapshot = matchesTerm(current) ? current : matchesTerm(state.moduleAttendance) ? state.moduleAttendance : null
      const matches = matchModuleAttendance(day.rows.map(row => ({ moduleCode: row.code, date, time: row.time, teachingGroup: `${row.type} ${row.group}` })), snapshot?.records ?? [])
      const issue = [...refreshIssues, recordIssue, ebridge.issues.timetable, calendarIssue(day.message), snapshot?.issue, snapshot?.loading ? '单节考勤仍在读取。' : null, !snapshot && day.rows.length ? '尚未取得该日期的 AMS Module 考勤记录，不推断出勤状态。' : null].filter(Boolean).join(' ') || null
      const result = this.result('AMS Module Detail + eBridge Timetable', state.phase, snapshot?.fetchedAt ?? null, issue, {
        date, term, timetableAt: ebridge.timetableAt, supportedDates, calendarNote: day.message,
        records: day.rows.map((row, index) => {
          const record = matches[index], attendance = record?.attendance ?? (snapshot ? 'unmatched' : 'unavailable')
          return { moduleCode: row.code, title: row.title, date, time: row.time, room: row.room, teachingGroup: row.group, attendance, attendanceLabel: moduleAttendanceLabels[attendance], signTime: record?.attendance === 'present' ? record.signTime || null : null }
        })
      }, !snapshot && day.rows.length ? 'data_unavailable' : null)
      result.complete &&= ebridge.phase === 'connected' && matches.every(Boolean)
      if (!day.rows.length) { result.fetchedAt = ebridge.timetableAt; result.stale = this.now() - Date.parse(ebridge.timetableAt!) > MCP_CACHE_MAX_AGE || !!issue || ebridge.phase !== 'connected'; result.complete = !issue && ebridge.phase === 'connected' }
      return result
    })
  }

  getLibraryOverview(input: { refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const service = this.sources.library
      const before = service.getState()
      if (input.refresh || !before.fetchedAt || this.now() - Date.parse(before.fetchedAt) > MCP_CACHE_MAX_AGE) {
        await this.once('library', () => service.refresh())
      }
      const state = service.getState()
      if (!state.fetchedAt) return this.unavailable('Seatbookings', 'error', state.message)
      return this.result('Seatbookings', 'connected', state.fetchedAt, state.phase === 'error' ? state.message : null, {
        floors: state.floors.map(({ id, campus, name, free, total }) => ({ floorId: id, campus, name, free, total })),
        updated: state.fetchedAt !== before.fetchedAt, retryAt: state.retryAt
      })
    })
  }

  private seatWindow(input: SeatWindowInput): SeatSearch | null {
    const date = this.date(input.date)
    if (!date) return null
    if (input.start !== undefined && input.end !== undefined) {
      if (input.end <= input.start || Date.parse(`${date}T${input.start}:00+08:00`) <= this.now()) return null
      return { floorId: input.floorId, date, start: input.start, end: input.end }
    }
    if (input.start !== undefined || input.end !== undefined || date !== beijingDate(this.now())) return null
    const window = libraryNowWindow(this.now())
    return window ? { floorId: input.floorId, ...window, startMode: 'now' } : null
  }
  private libraryFailure(error: unknown): QueryResult {
    const phase = this.sources.library.getState().booking.phase
    if (!(error instanceof LibraryError)) return this.unavailable('Seatbookings', phase, '图书馆查询未能完成，请在桌面应用检查连接。')
    const code = error.kind === 'auth' ? 'not_connected' : error.kind === 'validation' ? 'invalid_request' : error.kind === 'rate-limit' ? 'rate_limited' : 'data_unavailable'
    return this.unavailable('Seatbookings', phase, error.message, code)
  }

  getLibrarySeats(input: SeatWindowInput): Promise<QueryResult> {
    return this.guarded(async () => {
      const service = this.sources.library, state = service.getState()
      if (state.booking.phase !== 'connected') return this.unavailable('Seatbookings', state.booking.phase, '请先在桌面应用连接图书馆账号。', 'not_connected')
      const query = this.seatWindow(input)
      if (!query) return this.unavailable('Seatbookings', 'connected', '请输入有效的未来起止时间，或省略时间查询今天现在至 22:00。', 'invalid_time')
      try {
        if (!state.fetchedAt) await this.once('library', () => service.refresh())
        const { query: used, seats, fetchedAt } = await service.readSeats(query)
        return this.result('Seatbookings', service.getState().booking.phase, fetchedAt, null, {
          ...used, availableCount: seats.filter(seat => seat.available).length,
          seats: seats.map(({ id, name, ...seat }) => ({ seatId: id, seatNumber: name, ...seat }))
        })
      } catch (error) { return this.libraryFailure(error) }
    })
  }

  getLibraryReservations(input: { date?: string }): Promise<QueryResult> {
    return this.guarded(async () => {
      const service = this.sources.library, phase = service.getState().booking.phase
      if (phase !== 'connected') return this.unavailable('Seatbookings', phase, '请先在桌面应用连接图书馆账号。', 'not_connected')
      const date = this.date(input.date)
      if (!date) return this.unavailable('Seatbookings', phase, '预约查询日期无效。', 'invalid_date')
      try {
        const reservations = await service.getReservations(date)
        return this.result('Seatbookings', service.getState().booking.phase, new Date(this.now()).toISOString(), null, { date, reservations })
      } catch (error) { return this.libraryFailure(error) }
    })
  }

  reserveLibrarySeat(input: ReserveSeatInput): Promise<QueryResult> {
    const revision = this.revision
    return this.guarded(async () => {
      const service = this.sources.library, state = service.getState(), phase = state.booking.phase
      let request: AgentBooking | null | undefined
      if ('requestId' in input) {
        request = service.agentBookings.get(input.requestId)
        if (!request) return this.unavailable('Seatbookings', phase, '未找到该预约请求。', 'request_not_found')
      } else {
        if (phase !== 'connected') return this.unavailable('Seatbookings', phase, '请先在桌面应用连接图书馆账号。', 'not_connected')
        const query = this.seatWindow(input)
        if (!query) return this.unavailable('Seatbookings', phase, '请输入有效的未来起止时间，或省略时间预约今天现在至 22:00。', 'invalid_time')
        try {
          if (!state.fetchedAt) await this.once('library', () => service.refresh())
          const { query: used, seats } = await service.readSeats(query)
          const matches = seats.filter(seat => 'seatId' in input ? seat.id === input.seatId : seat.name.trim().toLowerCase() === input.seatNumber.toLowerCase())
          if (matches.length !== 1) return this.unavailable('Seatbookings', phase, '未能唯一匹配楼层和座位，请先查询座位并使用对应的 seatId。', 'seat_not_found')
          const [seat] = matches
          if (!seat.available) return this.unavailable('Seatbookings', phase, '该座位在所选时段不可预约。', 'seat_unavailable')
          if (revision !== this.revision) return this.unavailable('Seatbookings', 'idle', '学校账号已变化。', 'account_changed')
          request = service.agentBookings.request({ ...used, seatId: seat.id, title: input.title ?? '', memo: input.memo ?? '' }, seat.name)
          if (!request) return this.unavailable('Seatbookings', phase, '桌面应用已有预约请求等待处理。', 'booking_busy')
        } catch (error) { return this.libraryFailure(error) }
      }
      const { id, seat, phase: status, expiresAt, selection, message } = request
      const pending = status === 'pending' || status === 'submitting' || status === 'verification-required'
      return {
        ...this.result('Seatbookings', 'connected', new Date(this.now()).toISOString(), status === 'completed' ? null : message,
          { requestId: id, status, seat, floorId: selection.floorId, date: selection.date, start: selection.start, end: selection.end, expiresAt,
            booked: status === 'completed' ? true : pending || status === 'uncertain' ? null : false },
          pending || status === 'completed' ? null : status),
        complete: !pending && status !== 'uncertain', stale: false
      }
    })
  }

  getLmcNotification(input: { from?: string; to?: string; includeSignIn?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const source = 'Learning Mall Core Notifications', service = this.sources.lmc
      const today = beijingDate(this.now()), oldest = subtractMonths(today, 4)
      const from = input.from ?? oldest, to = input.to ?? today
      if (!validDate(from) || !validDate(to) || from < oldest || from > to || to > today) {
        return this.unavailable(source, 'error', `请指定北京时间 ${oldest} 至 ${today} 内的有效日期范围。`, 'invalid_date_range')
      }
      const state = service?.getState()
      if (!service || state?.phase !== 'connected') return this.unavailable(source, state?.phase ?? 'idle', '请先在桌面应用连接 Learning Mall Core。', 'not_connected')
      const range = await service.readNotificationRange(Date.parse(`${from}T00:00:00+08:00`))
      const phase = service.getState().phase
      if (!this.usable(range.fetchedAt)) return this.unavailable(source, phase, range.issue || '尚未读取通知。')
      let undatedCount = 0, hiddenSignInCount = 0
      const notifications = range.notifications.filter(item => {
        const time = item.createdAt ? Date.parse(item.createdAt) : NaN
        if (!Number.isFinite(time)) { undatedCount++; return false }
        const day = beijingDate(time)
        if (day < from || day > to) return false
        if (!input.includeSignIn && isSignInNotice(item.title)) { hiddenSignInCount++; return false }
        return true
      }).sort((a, b) => b.createdAt!.localeCompare(a.createdAt!))
      const issue = range.issue || (!range.complete ? '通知未全部读取。' : undatedCount ? '部分通知未提供可识别的时间。' : null)
      return this.result(source, phase, range.fetchedAt, issue, { from, to, hiddenSignInCount, notifications })
    })
  }

  listLmcModules(input: { refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const source = 'Learning Mall Core Courses', service = this.sources.lmc
      if (!service) return this.unavailable(source, 'idle', 'Learning Mall Core 尚未启用。')
      let state = service.getState()
      let issue: string | null = null
      if (state.phase === 'connected' && (input.refresh || !this.usable(state.coursesAt))) {
        try { await this.once('lmc', () => service.refresh()) }
        catch { issue = 'LMC 课程列表未能更新，保留先前可用结果。' }
        state = service.getState()
      }
      if (!this.usable(state.coursesAt)) return this.unavailable(source, state.phase, state.issues.courses || issue || '请先在桌面应用连接 Learning Mall Core。')
      return this.result(source, state.phase, state.coursesAt, state.issues.courses || issue || (!state.coursesComplete ? '学校课程列表尚未全部读取。' : null),
        { courses: state.courses.map(({ id, title, shortName }) => ({ courseId: id, title, shortName })) })
    })
  }

  getModuleContents(input: { courseId: string; folderId?: string; refresh?: boolean }): Promise<QueryResult> {
    return this.guarded(async () => {
      const source = 'Learning Mall Core Module', service = this.sources.lmc
      if (!service) return this.unavailable(source, 'idle', 'Learning Mall Core 尚未启用。')
      let state = service.getState()
      const course = state.courses.find(item => item.id === input.courseId)
      if (!course || !this.usable(state.coursesAt)) return this.unavailable(source, state.phase, '请先读取 LMC 课程列表并选择返回的 courseId。', 'course_not_found')
      let issue: string | null = null
      if (state.phase === 'connected' && (!this.usable(state.modules[course.id]?.fetchedAt) || input.refresh && !input.folderId)) {
        try { await this.once(`lmc:course:${course.id}`, () => service.loadCourse(course.id)) }
        catch { issue = '课程目录未能更新，保留先前可用结果。' }
        state = service.getState()
      }
      const module = state.modules[course.id]
      if (!this.usable(module?.fetchedAt)) return this.unavailable(source, state.phase, issue || module?.issue || '课程目录尚未读取，请确认 LMC 已连接。')
      if (!input.folderId) {
        return this.result(source, state.phase, module.fetchedAt, module.issue || issue, {
          courseId: course.id, title: course.title,
          activities: module.activities.map(({ id, ...activity }) => ({ ...activity, activityId: id, fileId: activity.downloadable ? id : null, folderId: activity.type === 'folder' ? id : null }))
        })
      }
      const folderId = input.folderId
      if (!module.activities.some(row => row.id === folderId && row.type === 'folder')) return this.unavailable(source, state.phase, '未找到该课程的文件夹。', 'folder_not_found')
      if (state.phase === 'connected' && (input.refresh || !this.usable(module.folders[folderId]?.fetchedAt))) {
        try { await this.once(`lmc:folder:${folderId}`, () => service.loadFolder(folderId)) }
        catch { issue = '文件夹未能更新，保留先前可用结果。' }
        state = service.getState()
      }
      const folder = state.modules[course.id]?.folders[folderId]
      if (!this.usable(folder?.fetchedAt)) return this.unavailable(source, state.phase, issue || folder?.issue || '文件夹尚未读取。')
      return this.result(source, state.phase, folder.fetchedAt, folder.issue || issue, {
        courseId: course.id, folderId, files: folder.files.map(({ id, ...file }) => ({ fileId: id, ...file }))
      })
    })
  }

  downloadLmcFile(input: LmcDownloadInput): Promise<QueryResult> {
    return this.guarded(async () => {
      const source = 'Learning Mall Core Files', service = this.sources.lmc
      if (!service) return this.unavailable(source, 'idle', 'Learning Mall Core 尚未启用。')
      const state = service.getState()
      let downloadId: string | null
      if ('downloadId' in input) downloadId = input.downloadId
      else {
        if (state.phase !== 'connected') return this.unavailable(source, state.phase, '请先在桌面应用连接 Learning Mall Core。', 'not_connected')
        const module = state.modules[input.courseId]
        if (!this.usable(state.coursesAt) || !state.courses.some(course => course.id === input.courseId) || !this.usable(module?.fetchedAt)) {
          return this.unavailable(source, state.phase, '请先读取该课程目录。', 'course_not_found')
        }
        const resources = module.activities.filter(item => item.downloadable)
        const folders = Object.values(module.folders).filter(folder => this.usable(folder.fetchedAt))
        let matches: string[]
        if ('fileId' in input) {
          matches = [...resources, ...folders.flatMap(folder => folder.files)].filter(item => item.id === input.fileId).map(item => item.id)
        } else if (input.folderId) {
          const folder = module.folders[input.folderId]
          const { fileName, path } = input
          matches = this.usable(folder?.fetchedAt)
            ? folder.files.filter(file => file.name === fileName && (!path || file.path === path)).map(file => file.id)
            : []
        } else {
          matches = resources.filter(item => item.title === input.fileName && (!input.path || item.section === input.path)).map(item => item.id)
        }
        if (matches.length !== 1) return this.unavailable(source, state.phase, '请打开课程目录或文件夹，使用返回的 fileId 唯一定位文件。', matches.length ? 'ambiguous_file' : 'file_not_found')
        try { downloadId = await service.startDownload(matches[0]) }
        catch { return this.unavailable(source, service.getState().phase, '未能开始下载，请检查 LMC 连接和桌面应用的下载状态。', 'download_failed') }
        if (!downloadId) return this.unavailable(source, service.getState().phase, '下载在开始前已取消。', 'cancelled')
      }
      const download = service.getState().downloads.find(item => item.id === downloadId)
      if (!download) return this.unavailable(source, state.phase, '未找到该下载记录。', 'download_not_found')
      const pending = download.phase === 'preparing' || download.phase === 'downloading'
      return {
        ...this.result(source, 'connected', new Date(this.now()).toISOString(), download.phase === 'completed' ? null : download.message,
          { downloadId, name: download.name, status: download.phase, received: download.received, total: download.total,
            downloaded: pending ? null : download.phase === 'completed' },
          pending || download.phase === 'completed' ? null : download.phase),
        complete: !pending, stale: false
      }
    })
  }
}
