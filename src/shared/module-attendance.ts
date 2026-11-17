import type {TimetableDay} from './ams'
import type {ModuleAttendanceRecord,ModuleAttendanceStatus} from './modules'
import {beijingDate} from './academic-calendar.ts'

export const moduleAttendanceLabels:Record<ModuleAttendanceStatus|'unmatched'|'unavailable',string>={present:'已签到',absent:'缺勤','authorized-absence':'获批请假',excluded:'不计入考勤',unmarked:'待确认',unknown:'状态未知',unmatched:'未匹配到记录',unavailable:'等待读取 Module'}
export interface AttendanceSession {moduleCode:string;date:string;time:string;teachingGroup:string}
export function timeRange(text:string):{start:number;end:number}|null {
  const match=text.trim().match(/^(\d{1,2}):(\d{2})(?::00)?\s*[-–—~～]\s*(\d{1,2}):(\d{2})(?::00)?$/)
  if(!match)return null
  const [h,m,eh,em]=match.slice(1).map(Number)
  if(h>23||eh>23||m>59||em>59||eh*60+em<=h*60+m)return null
  return {start:h*60+m,end:eh*60+em}
}
const normalized=(text:string):string=>text.replace(/\s+/g,'').toUpperCase()
function kind(text:string):string {return text.toUpperCase().match(/LECTURE|TUTORIAL|LAB(?:ORATORY)?|SEMINAR|WORKSHOP/)?.[0].replace('LABORATORY','LAB')||''}

export function matchModuleAttendance(sessions:AttendanceSession[],records:ModuleAttendanceRecord[]):(ModuleAttendanceRecord|null)[] {
  const candidates=sessions.map(session=>{
    const time=timeRange(session.time)
    let matches=records.filter(record=>{
      const other=timeRange(record.time)
      return record.date===session.date&&normalized(record.moduleCode)===normalized(session.moduleCode)&&time&&other&&time.start===other.start&&[0,10].includes(Math.abs(time.end-other.end))
    })
    if(matches.length>1&&session.teachingGroup){const exact=matches.filter(r=>normalized(r.teachingGroup)===normalized(session.teachingGroup));if(exact.length)matches=exact}
    if(matches.length>1&&kind(session.teachingGroup)){const sameKind=matches.filter(r=>kind(r.teachingGroup)===kind(session.teachingGroup));if(sameKind.length)matches=sameKind}
    return matches
  })
  const uses=new Map<ModuleAttendanceRecord,number>()
  for(const matches of candidates)if(matches.length===1)uses.set(matches[0],(uses.get(matches[0])??0)+1)
  return candidates.map(matches=>matches.length===1&&uses.get(matches[0])===1?matches[0]:null)
}

export function timetableDayDate(day:TimetableDay|undefined,fetchedAt:string|null):string|null {
  if(!day)return null
  const fullDates=[...new Set(day.entries.map(e=>e.date.match(/^(20\d{2}-\d{2}-\d{2})(?:\b|T)/)?.[1]).filter((d):d is string=>!!d))]
  if(fullDates.length===1)return fullDates[0]
  if(fullDates.length>1)return null
  if(/^20\d{2}-\d{2}-\d{2}$/.test(day.date))return day.date
  if(!/^\d{2}-\d{2}$/.test(day.date)||!fetchedAt)return null
  const anchor=Date.parse(`${beijingDate(Date.parse(fetchedAt))}T00:00:00Z`)
  const year=new Date(anchor).getUTCFullYear()
  // AMS labels recent days without a year; use the closest year to the read
  // date so the Dec/Jan boundary does not map a recent class a year away.
  const dates=[year-1,year,year+1].map(y=>`${y}-${day.date}`).filter(d=>Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)
  return dates.sort((a,b)=>Math.abs(Date.parse(a)-anchor)-Math.abs(Date.parse(b)-anchor))[0]??null
}

export function amsRelativeDays(now=Date.now()):{label:string;offset:number;date:string}[] {
  const today=Date.parse(`${beijingDate(now)}T00:00:00Z`)
  return [{label:'今天',offset:0},{label:'昨天',offset:-1},{label:'明天',offset:1}].map(day=>({...day,date:new Date(today+day.offset*86_400_000).toISOString().slice(0,10)}))
}
