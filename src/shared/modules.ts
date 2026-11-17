export interface AcademicTerm { academicYear: string; semester: string }
export interface TermOptions { academicYears: string[]; semesters: string[] }

export type ModuleAttendanceStatus = 'unmarked'|'present'|'absent'|'authorized-absence'|'excluded'|'unknown'
export interface ModuleAttendanceRecord {
  id:string
  moduleCode:string
  date:string
  time:string
  teachingGroup:string
  attendance:ModuleAttendanceStatus
  statusName:string
  signTime:string
}
export interface ModuleAttendanceQuery {date:string;term:AcademicTerm;moduleCodes:string[]}
export interface ModuleAttendanceSnapshot extends ModuleAttendanceQuery {
  records:ModuleAttendanceRecord[]
  fetchedAt:string|null
  loading:boolean
  issue:string|null
}

export interface AmsModule {
  code: string
  title: string
  attendanceRate: number | null
  sourceAttendanceRate: number | null
  classHours: number | null
  attendedHours: number | null
  absentHours: number | null
  authorizedAbsenceHours: number | null
}

export interface ModuleSnapshot {
  term: AcademicTerm
  modules: AmsModule[]
  overallAttendanceRate: number | null
  fetchedAt: string
  sourceUrl: string
}
