import {it} from 'node:test'
import assert from 'node:assert/strict'
import {amsRelativeDays,matchModuleAttendance,timetableDayDate} from '../src/shared/module-attendance.ts'
import type {ModuleAttendanceRecord} from '../src/shared/modules.ts'

it('matches only the selected date and teaching group, preserving the correct sign-in time',()=>{
  const session={moduleCode:'DEMO101',date:'2026-11-17',time:'09:00-11:00',teachingGroup:'Lecture D1/4'}
  const record:ModuleAttendanceRecord={id:'correct',...session,attendance:'present',statusName:'Present',signTime:'2026-11-17 10:06:58'}
  const rows=[{...record,id:'other-date',date:'2026-11-18',attendance:'unmarked' as const},{...record,id:'other-group',teachingGroup:'Lecture D1/1',attendance:'absent' as const},record]
  const [match]=matchModuleAttendance([session],rows)
  assert.equal(match?.id,'correct')
  assert.equal(match?.signTime,record.signTime)
  assert.equal(matchModuleAttendance([{...session,date:'2026-11-19'}],rows)[0],null)
})
it('resolves yearless recent dates across New Year and rejects invalid labels',()=>{
  assert.equal(timetableDayDate({date:'01-01',entries:[]},'2026-12-31T10:00:00Z'),'2027-01-01')
  assert.equal(timetableDayDate({date:'12-31',entries:[]},'2027-01-01T10:00:00Z'),'2026-12-31')
  assert.equal(timetableDayDate({date:'02-30',entries:[]},'2026-02-01T00:00:00Z'),null)
  assert.equal(timetableDayDate({date:'-',entries:[]},'2026-11-17T00:00:00Z'),null)
})
it('always offers today, yesterday and tomorrow in Beijing time across New Year',()=>{
  const days=amsRelativeDays(Date.parse('2026-12-31T17:00:00Z'))
  assert.deepEqual(days.map(d=>d.label),['今天','昨天','明天'])
  assert.deepEqual(days.map(d=>d.date),['2027-01-01','2026-12-31','2027-01-02'])
})
