import {it} from 'node:test'
import assert from 'node:assert/strict'
import {runInNewContext} from 'node:vm'
import {libraryNowWindow} from '../src/shared/library-time.ts'
import {libraryRequest,parseLibraryFloors,parseLibraryReservations,parseLibrarySeats,reservationQuery,resolveSeatTime} from '../src/providers/library.ts'
import {libraryFloorPageScript} from '../src/providers/library-floor-page.ts'
import {LIBRARY_ORIGIN} from '../src/shared/library.ts'

it('reads displayed floor counts and the corresponding seat-query IDs from the official homepage cards',()=>{
  const names=['3F-North','4F','5F','7F','8F','10F']
  const cards=names.map((name,index)=>({
    __vue__:{$props:{region:{id:index+1}}},
    querySelector:(selector:string)=>({textContent:({
      ':scope > .title':name, '.left .txt':String(index), '.right .txt':'56'
    } as Record<string,string>)[selector]})
  }))
  const campus={
    querySelector:()=>({firstChild:{textContent:' SIP Campus '}}),
    querySelectorAll:()=>cards
  }
  const document={querySelectorAll:()=>[campus]}
  const data=runInNewContext(libraryFloorPageScript,{document,location:{origin:LIBRARY_ORIGIN,hash:'#/ic/home'}})
  const floors=parseLibraryFloors(data)
  assert.equal(floors.length,names.length)
  assert.deepEqual(floors[0],{key:'SIP Campus/1/3F-North',optionKey:'SIP Campus/3F-North',campus:'SIP Campus',name:'3F-North',id:1,free:0,total:56})
  assert.equal(floors[5].free,5)
  assert.equal(runInNewContext(libraryFloorPageScript,{location:{origin:LIBRARY_ORIGIN,hash:'#/ic/userinfo'}}),null)
})

it('uses the official beginDate/pageNum names for personal reservation history',()=>{
  const params=reservationQuery('2026-11-17',2)
  assert.equal(params.get('beginDate'),'2026-11-17')
  assert.equal(params.get('endDate'),'2026-11-17')
  assert.equal(params.get('page'),'2')
  assert.equal(params.get('pageNum'),'100')
  assert.equal(params.has('startDate'),false)
  assert.equal(params.has('pageSize'),false)
})
it('defaults to the current Beijing day through 22:00, and stops offering that window after closing',()=>{
  const now=Date.parse('2026-11-17T03:35:28Z')
  const window=libraryNowWindow(now)!
  assert.equal(window.date,'2026-11-17')
  assert.equal(window.end,'22:00')
  assert.ok(Date.parse(`${window.date}T${window.start}:00+08:00`)>now)
  assert.ok(Date.parse(`${window.date}T${window.start}:00+08:00`)-now<=120_000)
  assert.equal(libraryNowWindow(Date.parse('2026-11-17T14:00:00Z')),null)
  assert.equal(libraryNowWindow(Date.parse('2026-11-17T15:59:40Z')),null)
})
it('updates a now booking at confirmation, keeps manual times, and rejects cross-day reuse',()=>{
  const now=Date.parse('2026-11-17T03:35:28Z')
  const query={floorId:1,date:'2026-11-17',start:'09:00',end:'10:00',startMode:'now' as const}
  const resolved=resolveSeatTime(query,true,now)
  assert.equal(resolved.end,'22:00')
  assert.notEqual(resolved.start,'09:00')
  const manual={floorId:1,date:'2026-11-17',start:'18:00',end:'19:00'}
  assert.deepEqual(resolveSeatTime(manual,true,now),manual)
  assert.throws(()=>resolveSeatTime({...query,date:'2026-11-16'},true,now))
})
it('reads seat names and times from the official record fields and strips personal information',()=>{
  const record={classKind:8,resvId:1,resvDevInfoList:[{devName:'DEMO-001'}],resvBeginTime:Date.parse('2026-11-17T09:00:00+08:00'),resvEndTime:'2026-11-17 22:00:00',resvStatus:4,trueName:'Synthetic private name'}
  const page=parseLibraryReservations({code:0,count:2,data:[record,{...record,classKind:1,resvId:2}]})
  assert.equal(page.records.length,1)
  assert.equal(page.rawCount,2)
  assert.equal(page.records[0].seat,'DEMO-001')
  assert.equal(page.records[0].begin,'2026-11-17 09:00')
  assert.equal(page.records[0].status,'已生效')
  assert.equal('trueName' in page.records[0],false)
})
it('identifies which read operation failed and never retries a reservation submission',async()=>{
  await assert.rejects(libraryRequest(async()=>new Response('',{status:500}),'reserve/resvInfo?beginDate=2026-11-17'),/预约记录.*HTTP 500/)
  let calls=0
  await assert.rejects(libraryRequest(async()=>{calls++;throw new Error('offline')},'reserve/seat','synthetic-token',{}),{kind:'uncertain'})
  assert.equal(calls,1)
})
it('keeps queries within one floor and ignores completed bookings when checking availability',()=>{
  const query={floorId:2,date:'2026-11-17',start:'12:00',end:'22:00'}
  const row={devId:1,roomId:2,devName:'DEMO-001',devProp:2,onlyView:false,openTimes:[{openStartTime:'08:00',openEndTime:'22:00'}],resvInfo:[{startTime:'12:00',endTime:'22:00',resvStatus:128}],resvRule:{ruleId:2,minResvTime:30,maxResvTime:840}}
  const payload={code:0,data:[row]}
  assert.equal(parseLibrarySeats(payload,query).seats[0].available,true)
  assert.equal(parseLibrarySeats(payload,query).seats[0].floorId,2)
  assert.throws(()=>parseLibrarySeats(payload,{...query,floorId:3}))
  assert.equal(parseLibrarySeats(payload,{...query,start:'21:50'}).seats[0].available,false)
})
