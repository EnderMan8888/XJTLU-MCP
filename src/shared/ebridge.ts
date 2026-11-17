import type { ConnectionPhase } from './ams'

export const EBRIDGE_ORIGIN = 'https://ebridge.xjtlu.edu.cn'
export const EBRIDGE_ENTRY = `${EBRIDGE_ORIGIN}/`
export type EbridgeView = 'courses' | 'timetable' | 'exams'
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
  issues: Record<EbridgeView, string | null>
}
export interface EbridgeBridge {
  getState(): Promise<EbridgeState>
  connect(): Promise<void>
  refresh(): Promise<void>
  showLogin(): Promise<void>
  openSource(view: EbridgeView): Promise<void>
  disconnect(): Promise<void>
  onState(listener: (state: EbridgeState) => void): () => void
}
export function initialEbridgeState(): EbridgeState {
  return { phase: 'idle', message: '连接 eBridge，读取课程、课表与个人考试安排。', courses: [], timetable: [], timetableTerm:null, exams: [], coursesAt: null, timetableAt: null, examsAt: null, issues: { courses: null, timetable: null, exams: null } }
}
