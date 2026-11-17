import {it} from 'node:test'
import assert from 'node:assert/strict'
import {fetchModuleRecords,parseModuleRecordPage} from '../src/providers/ams-module-records.ts'
import {AMS_MODULE_RECORDS} from '../src/shared/ams.ts'

const row={date:'2026-11-17 09:00 - 11:00',moduleTypeGroup:'Lecture D1/1',status:1,statusName:'Present',signTime:'2026-11-17 08:55:00'}
const payload=(list:unknown[]=[row],total=list.length)=>({code:0,data:{list,total}})
const query={date:'2026-11-17',term:{academicYear:'2026/27',semester:'SEM1'},moduleCodes:['DEMO101']}

it('reads individual class status and sign-in time, including Pending and Excluded',()=>{
  const page=parseModuleRecordPage(payload([0,1,2,3,4,99].map(status=>({...row,status}))),'DEMO101')
  assert.deepEqual(page.records.map(r=>r.attendance),['unmarked','present','absent','authorized-absence','excluded','unknown'])
  assert.equal(page.records[1].date,'2026-11-17')
  assert.equal(page.records[1].time,'09:00 - 11:00')
  assert.equal(page.records[1].signTime,row.signTime)
})
it('uses the Module recordList with exact term/date/course filters and reads subsequent pages',async()=>{
  const calls:URL[]=[]
  const records=await fetchModuleRecords('synthetic-token',query,'DEMO101',async(url,init)=>{
    const request=new URL(url);calls.push(request)
    assert.equal(request.origin+request.pathname,AMS_MODULE_RECORDS)
    assert.equal(request.searchParams.get('moduleCode'),'DEMO101')
    assert.equal(request.searchParams.get('date'),query.date)
    assert.equal(request.searchParams.get('academicYear'),'2026/27')
    assert.equal(request.searchParams.get('semester'),'SEM1')
    assert.equal(init.method,'GET')
    return Response.json(payload([{...row,date:calls.length===1?row.date:'2026-11-17 11:00 - 13:00'}],2))
  })
  assert.equal(calls.length,2)
  assert.equal(calls[1].searchParams.get('pageNum'),'2')
  assert.equal(records.length,2)
})
it('keeps a real empty response distinct from malformed or wrong-day records',async()=>{
  assert.deepEqual(parseModuleRecordPage(payload([]),'DEMO101').records,[])
  assert.deepEqual(parseModuleRecordPage({code:0,data:{list:null,total:0}},'DEMO101').records,[])
  assert.throws(()=>parseModuleRecordPage({code:0,data:{list:null,total:1}},'DEMO101'))
  assert.throws(()=>parseModuleRecordPage({code:0,data:{}},'DEMO101'))
  assert.throws(()=>parseModuleRecordPage(payload([{...row,date:'2026-11-17'}]),'DEMO101'))
  await assert.rejects(fetchModuleRecords('synthetic-token',query,'DEMO101',async()=>Response.json(payload([{...row,date:'2026-11-16 09:00 - 11:00'}]))))
})
