import {it} from 'node:test'
import assert from 'node:assert/strict'
import {initialEbridgeState,type EbridgeSession} from '../src/shared/ebridge.ts'
import {ebridgeTimetableForDate} from '../src/shared/ebridge-timetable.ts'
import {matchModuleAttendance} from '../src/shared/module-attendance.ts'
import type {ModuleAttendanceRecord} from '../src/shared/modules.ts'

const course:EbridgeSession={id:'lecture',code:'DEMO101',title:'Timetable course title',date:'MON',time:'09:00 - 10:50',room:'SIP-DEMO101',type:'Lecture',staff:'',weeks:'1-3, 4-13',group:'D1/4'}
const source=()=>({...initialEbridgeState(),timetableAt:'2026-11-17T04:00:00Z',timetableTerm:{year:'2026/27',semester:1 as const},timetable:[course]})

it('preserves yesterday’s exact Timetable room while attaching the separate Module sign-in record',()=>{
  const yesterday=ebridgeTimetableForDate(source(),'2026-11-16')
  assert.equal(yesterday.week,10)
  assert.equal(yesterday.rows[0].room,'SIP-DEMO101')
  assert.equal(yesterday.rows[0].title,'Timetable course title')
  const record:ModuleAttendanceRecord={id:'attendance',moduleCode:'DEMO101',date:'2026-11-16',time:'09:00 - 11:00',teachingGroup:'Lecture D1/4',attendance:'present',statusName:'Present',signTime:'2026-11-16 09:01:00'}
  const [match]=matchModuleAttendance(yesterday.rows.map(row=>({moduleCode:row.code,date:yesterday.date,time:row.time,teachingGroup:`${row.type} ${row.group}`})),[record])
  assert.equal(match?.attendance,'present')
  assert.equal(yesterday.rows[0].room,'SIP-DEMO101')
})
it('keeps different session rooms for one course and respects teaching-week exclusions',()=>{
  const state=source()
  state.timetable.push({...course,id:'tutorial',time:'11:00 - 11:50',type:'Tutorial',room:'SIP-DEMO202'})
  state.timetable.push({...course,id:'other-week',weeks:'1-9, 11-13',room:'WRONG-ROOM'})
  state.timetable.push({...course,id:'other-day',date:'TUE',room:'TUESDAY-ROOM'})
  assert.deepEqual(ebridgeTimetableForDate(state,'2026-11-16').rows.map(row=>row.room),['SIP-DEMO101','SIP-DEMO202'])
  assert.deepEqual(ebridgeTimetableForDate(state,'2026-11-17').rows.map(row=>row.room),['TUESDAY-ROOM'])
})
it('does not invent classes or rooms when the timetable is unavailable or the date is outside term',()=>{
  assert.equal(ebridgeTimetableForDate(initialEbridgeState(),'2026-11-16').known,false)
  assert.deepEqual(ebridgeTimetableForDate(initialEbridgeState(),'2026-11-16').rows,[])
  assert.deepEqual(ebridgeTimetableForDate(source(),'2026-09-28').rows,[])
  assert.equal(ebridgeTimetableForDate(source(),'2027-09-01').known,false)
})
