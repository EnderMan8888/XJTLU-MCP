import type { AmsState } from './ams'
import type { ModuleAttendanceStatus } from './modules'
import type { EbridgeSession, EbridgeState } from './ebridge'
import { beijingDate } from './academic-calendar.ts'
import { ebridgeTimetableForDate } from './ebridge-timetable.ts'
import {matchModuleAttendance} from './module-attendance.ts'

export interface TodayCourse extends EbridgeSession {attendance:ModuleAttendanceStatus|'unmatched'|'unavailable';signTime:string;statusName:string}

export function todayCourses(ebridge:EbridgeState,ams:AmsState,now=Date.now()):{date:string;week:number|null;known:boolean;message:string|null;rows:TodayCourse[]} {
  const day=ebridgeTimetableForDate(ebridge,beijingDate(now))
  const {date,rows:sessions}=day
  const source=ams.moduleAttendance
  const matchesContext=source?.date===date&&source.term.academicYear===ebridge.timetableTerm?.year&&source.term.semester===`SEM${ebridge.timetableTerm?.semester}`
  // Only Module > the matching course > individual class records are valid.
  // The homepage timetable's status is intentionally never consulted here.
  const records=matchesContext?source.records.filter(record=>record.date===date):[]
  const matched=matchModuleAttendance(sessions.map(s=>({moduleCode:s.code,date,time:s.time,teachingGroup:`${s.type} ${s.group}`})),records)
  return {...day,rows:sessions.map((s,index)=>{
    const record=matched[index]
    return {...s,attendance:record?.attendance??(matchesContext&&source.fetchedAt?'unmatched':'unavailable'),signTime:record?.attendance==='present'?record.signTime:'',statusName:record?.statusName??''}
  })}
}
