import type { EbridgeTerm } from './ebridge'

// XJTLU-authored 2026/27 STUDENT calendar, checked against the coloured PDF.
// Source: https://www.rf.unibl.org/wp-content/uploads/2026/10/ACADEMIC-CALENDAR-2026-27-FOR-STUDENT-1-1.pdf
// Version by academic year: never reuse these dates for an unknown future year.
const calendar = {
  '2026/27': {
    1:{from:'2026-08-31',until:'2027-02-21',weeks:['2026-09-07','2026-09-14','2026-09-21','2026-10-05','2026-10-12','2026-10-19','2026-10-26','2026-11-02','2026-11-09','2026-11-16','2026-11-23','2026-11-30','2026-12-07'],closed:['2026-09-25']},
    2:{from:'2027-02-22',until:'2027-08-29',weeks:['2027-02-22','2027-03-01','2027-03-08','2027-03-15','2027-03-22','2027-03-29','2027-04-05','2027-04-12','2027-04-19','2027-04-26','2027-05-03','2027-05-10','2027-05-17'],closed:['2027-04-05','2027-05-03','2027-05-04']}
  }
}

export function beijingDate(now=Date.now()):string { return new Date(now+8*3_600_000).toISOString().slice(0,10) }

export function academicTermOn(date:string):EbridgeTerm|null {
  for(const [year,terms] of Object.entries(calendar)) {
    for(const semester of [1,2] as const) {
      if(date>=terms[semester].from&&date<=terms[semester].until)return {year,semester}
    }
  }
  return null
}

export function teachingDay(date:string,term:EbridgeTerm|null):{known:boolean;week:number|null;message:string|null} {
  if(!term)return {known:false,week:null,message:'等待确认 eBridge 课表所属学期。'}
  const year=calendar[term.year as keyof typeof calendar]
  if(!year)return {known:false,week:null,message:`尚未配置 ${term.year} 学年校历，暂时无法确认该日期的课程。`}
  const semester=year[term.semester]
  if(date<semester.from||date>semester.until)return {known:false,week:null,message:'当前 eBridge 课表不属于所选日期所在的学期，请刷新教务信息。'}
  const monday=new Date(`${date}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7)
  const week=semester.weeks.indexOf(monday.toISOString().slice(0,10))+1
  if(!week||semester.closed.includes(date))return {known:true,week:week||null,message:'所选日期不在校历教学日内。'}
  return {known:true,week,message:null}
}

export function scheduledInWeek(pattern:string,week:number):boolean|null {
  const text=pattern.replace(/^Week:\s*/i,'').replace(/\s/g,'').replace(/[–—]/g,'-')
  if(!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(text))return null
  let found=false
  for(const range of text.split(',')){
    const [start,end=start]=range.split('-').map(Number)
    if(start<1||end<start||end>60)return null
    if(week>=start&&week<=end)found=true
  }
  return found
}
