import {beijingDate} from './academic-calendar.ts'

export interface LibraryTimeWindow {date:string;start:string;end:string}
export function libraryNowWindow(now=Date.now()):LibraryTimeWindow|null {
  const date=beijingDate(now)
  // Minute precision with a small allowance for the school request to finish.
  const begin=Math.ceil((now+60_000)/60_000)*60_000
  const end=Date.parse(`${date}T22:00:00+08:00`)
  if(begin>=end)return null
  return {date,start:new Date(begin+8*3_600_000).toISOString().slice(11,16),end:'22:00'}
}
