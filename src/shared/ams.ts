import type { AcademicTerm, ModuleAttendanceSnapshot, ModuleSnapshot, TermOptions } from './modules'

export const AMS_ORIGIN = 'https://ams.xjtlu.edu.cn'
export const AMS_ENTRY = `${AMS_ORIGIN}/`
export const AMS_SOURCE = `${AMS_ORIGIN}/studentpc/checkIn`
export const AMS_TIMETABLE = `${AMS_ORIGIN}/xjtlu/xjtlu-base-student-timetables/getStudentTimetable`
export const AMS_MODULE_SOURCE = `${AMS_ORIGIN}/studentpc/myClass`
export const AMS_MODULES = `${AMS_ORIGIN}/xjtlu/stuapi/my-module/list`
export const AMS_MODULE_RECORDS = `${AMS_ORIGIN}/xjtlu/stuapi/my-module/recordList`
export const AMS_TERMS = `${AMS_ORIGIN}/xjtlu/xjtlu-base-academic-year-semester/getList`

export type ConnectionPhase = 'idle' | 'authenticating' | 'loading' | 'connected' | 'verification-required' | 'credentials-required' | 'expired' | 'error'
export type AttendanceStatus = 'unmarked' | 'present' | 'absent' | 'authorized-absence' | 'unknown'

export interface TimetableEntry {
  id: string
  moduleCode: string
  moduleTitle: string
  date: string
  time: string
  room: string
  teachingGroup: string
  attendance: AttendanceStatus
}

export interface TimetableDay { date: string; entries: TimetableEntry[] }

export interface AmsState {
  phase: ConnectionPhase
  message: string
  days: TimetableDay[]
  fetchedAt: string | null
  sourceUrl: string
  moduleSnapshot: ModuleSnapshot | null
  moduleAttendance: ModuleAttendanceSnapshot | null
  scheduleAttendance: Record<string,ModuleAttendanceSnapshot>
  timetableTerm: AcademicTerm | null
  termOptions: TermOptions
  issues: { timetable: string | null; modules: string | null }
}

export interface AmsBridge {
  getState(): Promise<AmsState>
  openLogin(): Promise<void>
  refresh(): Promise<void>
  clearSession(): Promise<void>
  openSource(): Promise<void>
  openModuleSource(): Promise<void>
  reconnect(): Promise<void>
  showLogin(): Promise<void>
  setTerm(term: AcademicTerm): Promise<void>
  loadScheduleAttendance(date:string):Promise<void>
  onState(listener: (state: AmsState) => void): () => void
}

export function initialState(): AmsState {
  return {
    phase: 'idle',
    message: '连接 AMS 后自动恢复会话、读取课程列表与签到率。',
    days: [],
    fetchedAt: null,
    sourceUrl: AMS_SOURCE,
    moduleSnapshot: null,
    moduleAttendance: null,
    scheduleAttendance: {},
    timetableTerm: null,
    termOptions: { academicYears: [], semesters: [] },
    issues: { timetable: null, modules: null }
  }
}

