import type { ConnectionPhase } from './ams'

export const EBRIDGE_ORIGIN = 'https://ebridge.xjtlu.edu.cn'
export const EBRIDGE_ENTRY = `${EBRIDGE_ORIGIN}/`
export type EbridgeCacheView = 'courses' | 'timetable' | 'exams'
export type EbridgeView = EbridgeCacheView | 'grades'
export type EbridgeGradeView = 'components' | 'records'
export interface EbridgeAssessmentMark { title: string; type: string; weight: string; mark: string | null }
export interface EbridgeGradeModule {
  id: string
  code: string
  title: string
  year: string
  period: string
  credits: string
  moduleType: string
  mark: string | null
  grade: string | null
  attempt: string
  components: EbridgeAssessmentMark[]
}
export interface EbridgeGrades {
  components: EbridgeGradeModule[]
  records: EbridgeGradeModule[]
  componentsAt: string | null
  recordsAt: string | null
  loading: boolean
  issues: Record<EbridgeGradeView, string | null>
}
export function initialEbridgeGrades(): EbridgeGrades { return { components: [], records: [], componentsAt: null, recordsAt: null, loading: false, issues: { components: null, records: null } } }
export interface EbridgeCourse { code: string; title: string; year: string; semester: string; credits: string; status: string }
export interface EbridgeSession { id: string; code: string; title: string; date: string; time: string; room: string; type: string; staff: string; weeks: string; group: string }
export interface EbridgeTerm { year:string; semester:1|2 }
export interface EbridgeExam {
  id: string
  code: string
  title: string
  date: string
  dateKey: string | null
  day: string
  admissionTime: string
  startTime: string
  duration: string
  room: string
  seat: string
  area: string
  entrance: string
}
export interface EbridgeState {
  phase: ConnectionPhase
  message: string
  courses: EbridgeCourse[]
  timetable: EbridgeSession[]
  timetableTerm: EbridgeTerm | null
  exams: EbridgeExam[]
  coursesAt: string | null
  timetableAt: string | null
  examsAt: string | null
  grades: EbridgeGrades
  issues: Record<EbridgeView, string | null>
  localCache: { enabled: boolean; restored: EbridgeCacheView[]; issue: string | null }
}
export type EbridgeOverview = Pick<EbridgeState, EbridgeCacheView | 'coursesAt' | 'timetableAt' | 'examsAt' | 'timetableTerm'>
export interface EbridgeBridge {
  getState(): Promise<EbridgeState>
  connect(): Promise<void>
  refresh(): Promise<void>
  setLocalCache(enabled: boolean): Promise<void>
  loadGrades(): Promise<void>
  openGradeSource(view: EbridgeGradeView): Promise<void>
  showLogin(): Promise<void>
  openSource(view: EbridgeView): Promise<void>
  disconnect(): Promise<void>
  onState(listener: (state: EbridgeState) => void): () => void
}
export function initialEbridgeState(): EbridgeState {
  return { phase: 'idle', message: '连接 eBridge，读取课程、课表、考试安排，并按需查询成绩。', courses: [], timetable: [], timetableTerm:null, exams: [], coursesAt: null, timetableAt: null, examsAt: null, grades: initialEbridgeGrades(), issues: { courses: null, timetable: null, exams: null, grades: null }, localCache: { enabled: false, restored: [], issue: null } }
}
