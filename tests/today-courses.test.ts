import {it} from 'node:test'
import assert from 'node:assert/strict'
import {initialState} from '../src/shared/ams.ts'
import type {ModuleAttendanceRecord} from '../src/shared/modules.ts'
import {initialEbridgeState,type EbridgeSession} from '../src/shared/ebridge.ts'
import {beijingDate,teachingDay} from '../src/shared/academic-calendar.ts'
import {todayCourses} from '../src/shared/today-courses.ts'

const now=Date.parse('2026-11-17T02:00:00Z')
const term={year:'2026/27',semester:1 as const}
const course:EbridgeSession={id:'demo',code:'DEMO101',title:'eBridge title',date:'TUE',time:'09:00 - 10:50',room:'SIP-DEMO1',type:'Lecture',staff:'',weeks:'1-3, 4-13',group:'D1/1'}
const record:ModuleAttendanceRecord={id:'ams-demo',moduleCode:'DEMO101',date:'2026-11-17',time:'09:00-11:00',teachingGroup:'Lecture',attendance:'present',statusName:'Present',signTime:'2026-11-17 08:55:00'}
const ebridge=()=>({...initialEbridgeState(),timetableTerm:term,timetableAt:new Date(now).toISOString(),timetable:[course]})
const ams=()=>({...initialState(),moduleAttendance:{date:'2026-11-17',term:{academicYear:'2026/27',semester:'SEM1'},moduleCodes:['DEMO101'],records:[record],fetchedAt:new Date(now).toISOString(),loading:false,issue:null}})

it('shows eBridge courses and joins AMS attendance despite the school calendar’s ten-minute break',()=>{
  const today=todayCourses(ebridge(),ams(),now)
  assert.equal(today.week,10)
  assert.equal(today.rows[0].title,'eBridge title')
  assert.equal(today.rows[0].time,'09:00 - 10:50')
  assert.equal(today.rows[0].attendance,'present')
  assert.equal(today.rows[0].signTime,'2026-11-17 08:55:00')
})
it('filters weekday and teaching weeks without using the AMS course list as the schedule',()=>{
  const state=ebridge();state.timetable=[course,{...course,id:'other-week',weeks:'1-9, 11-13'},{...course,id:'other-day',date:'MON'}]
  assert.equal(todayCourses(state,initialState(),now).rows.length,1)
  assert.equal(todayCourses(state,initialState(),now).rows[0].attendance,'unavailable')
})
it('does not attach an ambiguous, wrong-day or wrong-time attendance record',()=>{
  for(const entries of [[record,{...record,id:'duplicate'}],[{...record,date:'2026-11-16'}],[{...record,time:'11:00-13:00'}]]){
    const state=ams();state.moduleAttendance.records=entries
    assert.equal(todayCourses(ebridge(),state,now).rows[0].attendance,'unmatched')
  }
  const state=ebridge();state.timetable.push({...course,id:'parallel'})
  assert.ok(todayCourses(state,ams(),now).rows.every(r=>r.attendance==='unmatched'))
})
it('uses Module records even when the homepage status disagrees, and never falls back to it',()=>{
  const state=ams()
  state.days=[{date:'11-17',entries:[{id:'homepage',moduleCode:'DEMO101',moduleTitle:'homepage title',date:record.date,time:record.time,room:'DEMO1',teachingGroup:'Lecture',attendance:'unmarked'}]}]
  assert.equal(todayCourses(ebridge(),state,now).rows[0].attendance,'present')
  const withoutModule={...state,moduleAttendance:null,fetchedAt:new Date(now).toISOString()}
  assert.equal(todayCourses(ebridge(),withoutModule,now).rows[0].attendance,'unavailable')
})
it('uses Beijing dates, skips closure weeks, and refuses an unsupported academic year',()=>{
  assert.equal(beijingDate(Date.parse('2026-11-16T17:00:00Z')),'2026-11-17')
  assert.equal(teachingDay('2026-10-01',term).week,null)
  assert.equal(teachingDay('2026-10-05',term).week,4)
  assert.ok(teachingDay('2026-09-25',term).message)
  assert.equal(teachingDay('2027-09-01',{year:'2027/28',semester:1}).known,false)
})
