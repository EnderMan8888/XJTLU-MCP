import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { examDateKey, parseCourses, parseExams, parseTimetable, selectPortalLink, type PortalDocument } from '../src/providers/ebridge.ts'

// Field order observed on the official Timetables overview; values are synthetic.
const headers = ['Module Code','Module Title','Date','Day','Admission Time (UTC+8)','Exam Start Time (UTC+8)','Exam Duration','Exam Room/Campus','Seat No.','Area','Entrance']
const row = ['DEMO101','Synthetic module','05/Jan/2027','Tuesday','08:30','09:00','2 hours','SIP-DEMO101','012','A','North']
const document = (rows: string[][] = [row], columns = headers): PortalDocument => ({title:'Timetables',academicYear:'2026/27',links:[],tables:[{headers:columns,rows,caption:''}],events:[],calendar:false,frames:[],login:false,sso:false,empty:false})

describe('eBridge personal exam timetable', () => {
  it('opens the exams overview even when the personal class calendar appears first in the menu',()=>{
    const calendar={text:'My Personal Class Timetable - 2026/27 S1 New!',href:'https://ebridge.xjtlu.edu.cn/personal'}
    const overview={text:'Timetables',href:'https://ebridge.xjtlu.edu.cn/overview'}
    assert.deepEqual(selectPortalLink([calendar,overview],'timetable'),overview)
    assert.deepEqual(selectPortalLink([calendar,overview],'calendar'),calendar)
    assert.equal(selectPortalLink([calendar],'timetable'),undefined)
  })
  it('keeps admission and start times separate and preserves the school room, duration and seat', () => {
    const [exam] = parseExams([document()])!
    assert.equal(exam.code,'DEMO101')
    assert.equal(exam.date,'05/Jan/2027')
    assert.equal(exam.dateKey,'2027-01-05')
    assert.equal(exam.admissionTime,'08:30')
    assert.equal(exam.startTime,'09:00')
    assert.equal(exam.duration,'2 hours')
    assert.equal(exam.room,'SIP-DEMO101')
    assert.equal(exam.seat,'012')
    assert.equal(exam.area,'A')
    assert.equal(exam.entrance,'North')
  })

  it('sorts real calendar dates across years and keeps separate sittings for one module', () => {
    const earlier = [...row]; earlier[2] = '20/Dec/2026'
    const anotherSeat = [...row]; anotherSeat[8] = '013'
    const exams = parseExams([document([row,earlier,anotherSeat,row])])!
    assert.equal(exams.length,3)
    assert.equal(exams[0].dateKey,'2026-12-20')
    assert.notEqual(exams[1].id,exams[2].id)
  })

  it('distinguishes a recognized empty timetable from a missing or changed page', () => {
    assert.deepEqual(parseExams([document([])]),[])
    assert.deepEqual(parseExams([document([['No records found.']])]),[])
    assert.equal(parseExams([]),null)
    assert.equal(parseExams([document([row],headers.map(h => h === 'Date' ? 'Changed date column' : h))]),null)
    assert.equal(parseExams([document([['unexpected format']])]),null)
  })

  it('keeps unpublished fields visible without inventing dates or seats', () => {
    const pending = [...row]; pending[2] = 'To be confirmed'; pending[5] = ''; pending[8] = ''
    const [exam] = parseExams([document([pending])])!
    assert.equal(exam.date,'To be confirmed')
    assert.equal(exam.dateKey,null)
    assert.equal(exam.startTime,'')
    assert.equal(exam.seat,'')
  })

  it('does not mix exam sittings into enrolled courses or repeating class sessions', () => {
    assert.equal(parseCourses([document()]),null)
    assert.equal(parseTimetable([document()]),null)
  })

  it('parses school dates without timezone or locale-dependent day/month changes', () => {
    for (const value of ['05/01/2027','Tue, 05/Jan/2027','5 January 2027','January 5, 2027','2027-01-05']) assert.equal(examDateKey(value),'2027-01-05')
    for (const value of ['31/02/2027','2027-13-01','TBC']) assert.equal(examDateKey(value),null)
  })
})
