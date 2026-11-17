import type {EbridgeSession,EbridgeState} from './ebridge'
import {scheduledInWeek,teachingDay} from './academic-calendar.ts'
import {timeRange} from './module-attendance.ts'

export interface DayTimetable {date:string;week:number|null;known:boolean;message:string|null;rows:EbridgeSession[]}

// A calendar date selects the matching weekday AND teaching week. Keep the
// room on that exact timetable entry, including separate lab/tutorial venues.
export function ebridgeTimetableForDate(state:EbridgeState,date:string):DayTimetable {
  if(!state.timetableAt)return {date,week:null,known:false,message:'尚未读取 eBridge Timetable。',rows:[]}
  const stamp=Date.parse(`${date}T00:00:00Z`)
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)return {date,week:null,known:false,message:'课表日期无效。',rows:[]}
  const weekday=['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(stamp).getUTCDay()]
  const calendar=teachingDay(date,state.timetableTerm)
  let unknownWeeks=false
  const rows=state.timetable.filter(session=>{
    if(session.date===date)return true
    if(session.date!==weekday||!calendar.known||!calendar.week||calendar.message)return false
    const scheduled=scheduledInWeek(session.weeks,calendar.week)
    if(scheduled===null)unknownWeeks=true
    return scheduled===true
  }).sort((a,b)=>(timeRange(a.time)?.start??1440)-(timeRange(b.time)?.start??1440))
  return {date,week:calendar.week,known:calendar.known||rows.some(s=>s.date===date),message:unknownWeeks?'部分课程的教学周无法识别，请查看 eBridge 原课表。':calendar.message,rows}
}
