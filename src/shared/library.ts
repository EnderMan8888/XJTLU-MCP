import type { ConnectionPhase } from './ams'

export const LIBRARY_ORIGIN = 'https://seatbookings.xjtlu.edu.cn'
export const LIBRARY_HOME = `${LIBRARY_ORIGIN}/#/ic/home`
export const LIBRARY_API = `${LIBRARY_ORIGIN}/ic-web/`
export interface LibraryFloor { key:string; optionKey:string; campus:string; name:string; id:number; free:number; total:number }
export interface SeatInterval { start:string; end:string }
export interface LibrarySeat { id:number; floorId:number; name:string; available:boolean; onlyView:boolean; open:SeatInterval[]; occupied:SeatInterval[]; minMinutes:number|null; maxMinutes:number|null }
export interface SeatSearch { floorId:number; date:string; start:string; end:string; startMode?:'now' }
export interface SeatSelection extends SeatSearch { seatId:number; title:string; memo:string }
export interface BookingDraft { id:string; floor:string; seat:string; date:string; start:string; end:string; startMode?:'now'; title:string; memo:string; notice:string; requiresNotice:boolean; captchaMode:'0'|'1'|'2'; expiresAt:string }
export interface LibraryBookingResult { ok:boolean; uncertain?:boolean; requiresVerification?:boolean; message:string }
export interface AgentBooking {
  id:string
  selection:SeatSelection
  seat:string
  phase:'pending'|'submitting'|'completed'|'failed'|'uncertain'|'cancelled'|'expired'|'verification-required'
  expiresAt:string
  message:string
}
export interface LibraryReservation { id:string; seat:string; begin:string; end:string; status:string }
export interface LibraryState {
  phase:'idle'|'loading'|'ready'|'error'
  message:string
  floors:LibraryFloor[]
  fetchedAt:string|null
  retryAt:string|null
  booking:{phase:ConnectionPhase;message:string}
  search:SeatSearch|null
  seats:LibrarySeat[]
  seatsAt:string|null
  seatIssue:string|null
  agentBooking?:AgentBooking|null
}
export interface LibraryBridge {
  getState():Promise<LibraryState>
  refresh():Promise<void>
  connect():Promise<void>
  showLogin():Promise<void>
  searchSeats(query:SeatSearch):Promise<void>
  prepareBooking(selection:SeatSelection):Promise<BookingDraft>
  submitBooking(id:string, acceptedNotice:boolean, captcha:string):Promise<LibraryBookingResult>
  reviewAgentBooking(id:string):Promise<BookingDraft>
  submitAgentBooking(requestId:string, draftId:string, acceptedNotice:boolean, captcha:string):Promise<LibraryBookingResult>
  cancelAgentBooking(id:string):Promise<void>
  getCaptcha():Promise<string>
  getReservations():Promise<LibraryReservation[]>
  openSource():Promise<void>
  onState(listener:(state:LibraryState)=>void):()=>void
}
export function initialLibraryState():LibraryState {
  return {phase:'idle',message:'选择楼层，查询座位后预约。',floors:[],fetchedAt:null,retryAt:null,booking:{phase:'idle',message:'连接学校账号后，选择具体座位和时段预约。'},search:null,seats:[],seatsAt:null,seatIssue:null}
}
