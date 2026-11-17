import {session} from 'electron'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {AccountConsumer,AccountService} from '../services/account-service'
import type {CredentialStatus} from '../shared/credentials'
import {initialLibraryState,LIBRARY_API,type BookingDraft,type LibraryBookingResult,type LibraryFloor,type LibraryReservation,type LibraryState,type SeatSearch,type SeatSelection} from '../shared/library'
import {beijingToday,envelopeData,encryptedSeatPayload,LibraryError,libraryRequest,parseLibraryFloors,parseLibraryReservations,parseLibrarySeats,reservationQuery,resolveSeatTime,seatSearchSchema,seatSelectionSchema,validateSeatTime,type RawLibrarySeat} from '../providers/library'
import {LibraryLogin,type LibraryAuth} from './library-login'

interface Rules {notice:string;requiresNotice:boolean;captchaMode:'0'|'1'|'2';memoMax:number;memoRequired:boolean;titleRequired:boolean}
function plainText(html:string):string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g,m=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"}[m]||m)).replace(/&#(\d+);/g,(_m,n:string)=>{const x=Number(n);return x>0&&x<0x110000?String.fromCodePoint(x):''}).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim()
}
export class LibraryService implements AccountConsumer {
  private state=initialLibraryState()
  private login:LibraryLogin
  private querySession=session.fromPartition('xjtlu-library-public')
  private pending:Promise<void>|null=null
  private submission:Promise<LibraryBookingResult>|null=null
  private requestAt=0
  private retryNotBefore=0
  private generation=0
  private disposed=false
  private diagnosed=false
  private draft:{public:BookingDraft;selection:SeatSelection;rules:Rules;generation:number}|null=null
  constructor(private publish:(state:LibraryState)=>void,account:AccountService,private diagnostic=false){
    this.login=new LibraryLogin(account,(phase,message)=>{this.update({booking:{phase,message}});if(phase==='connected'&&process.argv.includes('--diagnose-library')&&!this.diagnosed){this.diagnosed=true;void this.diagnose().catch(()=>console.error('Library diagnosis could not complete.'))}})
  }
  getState():LibraryState{return structuredClone(this.state)}
  private update(value:Partial<LibraryState>):void{if(!this.disposed){this.state={...this.state,...value};this.publish(this.getState())}}
  private async request(path:string,token='',body?:unknown):Promise<unknown>{
    if(Date.now()<this.retryNotBefore)throw new LibraryError('rate-limit','学校要求稍后再访问，请等待页面显示的重试时间。',this.retryNotBefore-Date.now())
    try{return await libraryRequest((url,init)=>(token?this.login.school:this.querySession).fetch(url,init),path,token,body)}
    catch(error){if(error instanceof LibraryError){if(error.kind==='auth'&&token)this.login.invalidate();if(error.kind==='rate-limit'){this.retryNotBefore=Math.max(this.retryNotBefore,Date.now()+error.retryMs);this.update({retryAt:new Date(this.retryNotBefore).toISOString()})}}throw error}
  }
  refresh():Promise<void>{
    if(this.pending)return this.pending
    const wait=Math.max(this.requestAt+10_000,this.retryNotBefore)-Date.now()
    if(wait>0)return Promise.resolve()
    this.requestAt=Date.now()
    const task=(async()=>{
      this.update({phase:'loading',message:'正在读取可预约楼层…'})
      try{
        const floors=parseLibraryFloors(await this.request('seatMenu'))
        if(this.disposed)return
        this.update({phase:'ready',message:'楼层列表已更新，请选择日期、时段和座位。',floors,fetchedAt:new Date().toISOString(),retryAt:null})
        if(this.diagnostic)console.log('LIBRARY_FLOORS',JSON.stringify({floors:floors.length}))
      }catch(error){
        if(this.disposed)return
        this.update({phase:'error',message:error instanceof LibraryError?error.message:'楼层读取失败，请稍后重试。'})
      }
    })().finally(()=>{if(this.pending===task)this.pending=null})
    this.pending=task;return task
  }
  connect():Promise<void>{return this.login.connect()}
  showLogin():Promise<void>{return this.login.openSource()}
  openSource():Promise<void>{return this.login.openSource()}
  private auth():LibraryAuth{const auth=this.login.read();if(!auth)throw new LibraryError('auth','请先连接学校账号，再查询具体座位和预约。');return auth}
  private floor(id:number):LibraryFloor{const floor=this.state.floors.find(f=>f.id===id);if(!floor)throw new LibraryError('validation','请先更新楼层列表，再选择学校提供的楼层。');return floor}
  private async seats(query:SeatSearch,auth:LibraryAuth):Promise<ReturnType<typeof parseLibrarySeats>>{
    const params=new URLSearchParams({roomIds:String(query.floorId),resvDates:query.date.replaceAll('-',''),sysKind:'8'})
    return parseLibrarySeats(await this.request('reserve?'+params,auth.token),query)
  }
  private async diagnose():Promise<void>{
    try{const records=await this.getReservations();console.log('LIBRARY_RECORD_QUERY',JSON.stringify({rows:records.length}))}catch(error){console.log('LIBRARY_RECORD_QUERY',error instanceof Error?error.message:'failed')}
    await this.refresh()
    const floor=this.state.floors.find(f=>f.total>0)
    if(!floor)return
    await this.searchSeats({floorId:floor.id,date:beijingToday(),start:'00:00',end:'22:00',startMode:'now'})
  }
  async searchSeats(input:unknown):Promise<void>{
    const query=resolveSeatTime(seatSearchSchema.parse(input));validateSeatTime(query)
    this.floor(query.floorId)
    const auth=this.auth(),g=this.generation
    this.update({seatIssue:null})
    try{
      const data=await this.seats(query,auth)
      if(g!==this.generation||this.disposed)return
      this.draft=null
      this.update({search:query,seats:data.seats,seatsAt:new Date().toISOString(),seatIssue:null})
      if(this.diagnostic)console.log('LIBRARY_SEATS',JSON.stringify({seats:data.seats.length,available:data.seats.filter(s=>s.available).length}))
    }catch(error){if(g===this.generation)this.update({seatIssue:error instanceof Error?error.message:'座位查询失败，请重新查询。'});throw error}
  }
  private async rules(floorId:number,token:string):Promise<Rules>{
    const fields=z.array(z.object({sysKey:z.string(),sysValue:z.union([z.string(),z.number(),z.null()])})).parse(envelopeData(await this.request('sysConfig/public',token)))
    const config=Object.fromEntries(fields.map(f=>[f.sysKey,String(f.sysValue??'')]))
    if(!['0','1','2'].includes(config.resvCode))throw new LibraryError('schema','学校验证码要求有变化，请在官方页面预约。')
    const requirement=(config.needToKnow||'').split('-').map(s=>s.split(',')).find(([kind])=>kind==='8')
    let notice=''
    if(requirement){const scope=Number(requirement[1]);if(![1,2,4,8,16].includes(scope))throw new LibraryError('schema','预约须知的范围有变化，请打开学校原页。');const params=new URLSearchParams({sysType:String(scope===1||scope===2?32:scope===4?1:scope===8?2:4),sysValue:String(scope===1?0:scope===2?8:floorId)});const info=envelopeData(await this.request('sysInfo?'+params,token));if(info&&typeof info==='object'&&'content'in info&&typeof info.content==='string')notice=plainText(info.content);if(!notice)throw new LibraryError('schema','尚未读取到学校预约须知，请打开学校原页查看。')}
    return {notice,requiresNotice:!!requirement,captchaMode:config.resvCode as Rules['captchaMode'],memoMax:Math.max(1,Math.min(500,Number(config.resvmemolen)||50)),memoRequired:(Number(config.resvmemo)&8)>0,titleRequired:(Number(config.resvthememust)&8)>0}
  }
  private validateSeat(selection:SeatSelection,raw:RawLibrarySeat[],seats:ReturnType<typeof parseLibrarySeats>['seats']):RawLibrarySeat{
    const seat=raw.find(s=>s.devId===selection.seatId),view=seats.find(s=>s.id===selection.seatId)
    if(!seat||!view?.available)throw new LibraryError('validation','所选座位在该时段已不可预约，请重新查询。')
    const duration=(Date.parse(`${selection.date}T${selection.end}:00+08:00`)-Date.parse(`${selection.date}T${selection.start}:00+08:00`))/60_000
    if(view.minMinutes&&duration<view.minMinutes)throw new LibraryError('validation',`该座位至少预约 ${view.minMinutes} 分钟。`)
    if(view.maxMinutes&&duration>view.maxMinutes)throw new LibraryError('validation',`该座位每次最多预约 ${view.maxMinutes} 分钟。`)
    return seat
  }
  async prepareBooking(input:unknown):Promise<BookingDraft>{
    const selection=resolveSeatTime(seatSelectionSchema.parse(input),true);validateSeatTime(selection);const floor=this.floor(selection.floorId),auth=this.auth(),g=this.generation
    const data=await this.seats(selection,auth),seat=this.validateSeat(selection,data.raw,data.seats),rules=await this.rules(selection.floorId,auth.token)
    if(g!==this.generation||this.disposed)throw new LibraryError('auth','账号状态已改变，请重新选择预约。')
    if(rules.titleRequired&&!selection.title)throw new LibraryError('validation','学校要求填写预约主题。')
    if(rules.memoRequired&&!selection.memo)throw new LibraryError('validation','学校要求填写预约备注。')
    if(selection.memo.length>rules.memoMax)throw new LibraryError('validation',`预约备注最多 ${rules.memoMax} 个字符。`)
    const draft:BookingDraft={id:randomUUID(),floor:`${floor.campus==='SIP Campus'?'园区':'太仓'} ${floor.name}`,seat:seat.devName,date:selection.date,start:selection.start,end:selection.end,startMode:selection.startMode,title:selection.title,memo:selection.memo,notice:rules.notice,requiresNotice:rules.requiresNotice,captchaMode:rules.captchaMode,expiresAt:new Date(Date.now()+120_000).toISOString()}
    this.draft={public:draft,selection,rules,generation:g};return structuredClone(draft)
  }
  submitBooking(id:unknown,acceptedNotice:unknown,captcha:unknown):Promise<LibraryBookingResult>{
    if(this.submission)return Promise.resolve({ok:false,message:'已有预约正在提交，请等待学校返回结果。'})
    const draft=this.draft
    if(typeof id!=='string'||!draft||id!==draft.public.id||draft.generation!==this.generation||Date.parse(draft.public.expiresAt)<Date.now())return Promise.resolve({ok:false,message:'预约确认已过期，请重新选择并确认。'})
    if(draft.rules.requiresNotice&&acceptedNotice!==true)return Promise.resolve({ok:false,message:'请先阅读并确认学校预约须知。'})
    if(typeof captcha!=='string'||captcha.length>1000)return Promise.resolve({ok:false,message:'请输入有效的验证码。'})
    if(draft.rules.captchaMode==='1'&&!captcha.trim())return Promise.resolve({ok:false,message:'请输入学校图片验证码。'})
    if(draft.rules.captchaMode==='2')return this.openSource().then(()=>({ok:false,message:'学校当前要求滑块验证，请在打开的官方窗口完成本次预约。'}))
    this.draft=null
    const task=(async():Promise<LibraryBookingResult>=>{
      try{
        const auth=this.auth(),selection=resolveSeatTime(draft.selection,true);validateSeatTime(selection)
        const data=await this.seats(selection,auth),seat=this.validateSeat(selection,data.raw,data.seats)
        const eligibility=new URLSearchParams({devId:String(seat.devId),classKind:'8',resvRuleId:String(seat.resvRule.ruleId),chooseBeginTime:`${selection.date} ${selection.start}:00`,isConsole:'false'})
        await this.request('reserve/areaInfo?'+eligibility,auth.token)
        const key=z.object({publicKey:z.string().min(50).max(10_000)}).parse(envelopeData(await this.request('login/publicKey',auth.token)))
        if(draft.generation!==this.generation||this.disposed)throw new LibraryError('auth','学校账号状态已改变，预约未提交。')
        const body=encryptedSeatPayload(selection,auth.accNo,key.publicKey,captcha)
        // This is the only state-changing request. It is never retried.
        await this.request('reserve/seat',auth.token,body)
        this.update({seatIssue:'预约已提交成功；再次查询可查看最新座位状态。'})
        return {ok:true,message:`学校已确认预约成功：${draft.public.seat}，${selection.date} ${selection.start}–${selection.end}。`}
      }catch(error){return {ok:false,uncertain:error instanceof LibraryError&&error.kind==='uncertain',message:error instanceof LibraryError?error.message:'预约未能完成，请重新查询或打开学校页面核对。'}}
    })().finally(()=>{if(this.submission===task)this.submission=null})
    this.submission=task;return task
  }
  async getCaptcha():Promise<string>{
    const auth=this.auth();if(Date.now()<this.retryNotBefore)throw new LibraryError('rate-limit','请等待学校允许的重试时间。')
    const response=await this.login.school.fetch(`${LIBRARY_API}captcha?id=${Date.now()}`,{headers:{token:auth.token,lan:'2'},credentials:'include',redirect:'error',signal:AbortSignal.timeout(15_000)})
    const type=response.headers.get('Content-Type')||''
    if(!response.ok||!/^image\/(png|jpeg|gif|webp)(?:;|$)/i.test(type))throw new LibraryError('schema','验证码图片读取失败。')
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>500_000)throw new LibraryError('schema','验证码图片过大。')
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`
  }
  async getReservations():Promise<LibraryReservation[]>{
    const auth=this.auth(),date=beijingToday(),records:LibraryReservation[]=[]
    let read=0
    for(let page=1;page<=10;page++){
      const result=parseLibraryReservations(await this.request('reserve/resvInfo?'+reservationQuery(date,page),auth.token))
      read+=result.rawCount;records.push(...result.records)
      if(result.count!==null?read>=result.count:result.rawCount<100)return records
      if(!result.rawCount)throw new LibraryError('schema','预约记录分页不完整，请在学校原页核对。')
    }
    throw new LibraryError('schema','当天预约记录过多，请在学校原页查看。')
  }
  async cancelAccountAutomation():Promise<void>{this.generation++;this.draft=null;await this.login.cancel();await this.submission?.catch(()=>{})}
  accountChanged(previous:CredentialStatus,current:CredentialStatus):void{
    if(previous.username&&current.username&&previous.username!==current.username){this.update({search:null,seats:[],seatsAt:null,seatIssue:null});void this.login.reset().catch(()=>this.update({booking:{phase:'error',message:'请重新连接学校账号。'}}))}
    else if(current.saved&&this.state.booking.phase==='credentials-required')void this.connect().catch(()=>{})
  }
  dispose():void{this.disposed=true;this.generation++;this.draft=null;this.login.dispose()}
}
