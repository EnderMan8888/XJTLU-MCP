import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { LIBRARY_API, type LibraryFloor, type LibrarySeat, type LibraryReservation, type SeatSearch, type SeatSelection, type SeatInterval } from '../shared/library.ts'
import {libraryNowWindow} from '../shared/library-time.ts'

export class LibraryError extends Error {
  readonly kind:'network'|'auth'|'rate-limit'|'schema'|'server'|'validation'|'uncertain'
  readonly retryMs:number
  constructor(kind:LibraryError['kind'],message:string,retryMs=300_000){super(message);this.kind=kind;this.retryMs=retryMs}
}
export type LibraryFetcher = (url:string,init:RequestInit)=>Promise<Response>
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const regionSchema = z.object({id:count.positive(),name:z.string().trim().min(1).max(80),remainCount:count,totalCount:count})
const campusSchema = z.object({name:z.enum(['SIP Campus','Taicang Campus']),children:z.array(z.unknown()).max(200)})
export function parseLibraryFloors(payload:unknown):LibraryFloor[] {
  const parsed=z.object({code:z.literal(0),data:z.array(campusSchema).min(1).max(20)}).safeParse(payload)
  if(!parsed.success) throw new LibraryError('schema','没有读到完整的楼层数据，保留上次结果。')
  const rows:LibraryFloor[]=[]
  for(const campus of parsed.data.data) for(const parent of campus.children){
    if(!parent || typeof parent!=='object') throw new LibraryError('schema','楼层分区数据不完整。')
    const children='children' in parent ? parent.children : [parent]
    if(!Array.isArray(children)) throw new LibraryError('schema','楼层分区数据不完整。')
    for(const value of children){const region=regionSchema.safeParse(value);if(!region.success||region.data.remainCount>region.data.totalCount)throw new LibraryError('schema','座位计数缺失或异常，未更新楼层数据。')
      const r=region.data; rows.push({key:`${campus.name}/${r.id}/${r.name}`,optionKey:`${campus.name}/${r.name}`,campus:campus.name,name:r.name,id:r.id,free:r.remainCount,total:r.totalCount})
    }
  }
  if(new Set(rows.map(r=>r.key)).size!==rows.length || !['3F-North','4F','5F','7F','8F','10F'].every(f=>rows.some(r=>r.campus==='SIP Campus'&&r.name===f)))throw new LibraryError('schema','部分楼层数据缺失或重复，未更新楼层列表。')
  return rows
}

export function retryAfter(value:string|null):number {
  if(!value)return 300_000
  const seconds=Number(value), date=Date.parse(value)
  return Math.max(60_000,Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-Date.now():300_000)
}
export async function libraryRequest(fetcher:LibraryFetcher,path:string,token='',body?:unknown):Promise<unknown> {
  // Only these read endpoints and the explicit single-seat submission are exposed.
  const allowed=['seatMenu','sysConfig/public','reserve','reserve/areaInfo','sysInfo','login/publicKey','reserve/seat','reserve/resvInfo']
  if(!allowed.includes(path.split('?')[0]) || (body!==undefined && path!=='reserve/seat'))throw new LibraryError('validation','不支持的图书馆操作。')
  let response:Response
  try {response=await fetcher(LIBRARY_API+path,{method:body===undefined?'GET':'POST',headers:{Accept:'application/json',lan:'2','Cache-Control':'no-cache',...(token?{token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},credentials:token?'include':'omit',redirect:'manual',signal:AbortSignal.timeout(20_000),...(body!==undefined?{body:JSON.stringify(body)}:{})})}
  catch{throw new LibraryError(body===undefined?'network':'uncertain',body===undefined?'无法连接图书馆，请检查网络。':'提交结果暂未确认，请先查看“我的预约”，确认后再决定是否重新操作。')}
  if(process.argv.includes('--inspect-library'))console.log('LIBRARY_HTTP',JSON.stringify({endpoint:path.split('?')[0],queryKeys:[...new URLSearchParams(path.split('?')[1]||'').keys()],method:body===undefined?'GET':'POST',status:response.status}))
  if(response.status===429)throw new LibraryError('rate-limit','学校要求放慢查询，正在等待后重试。',retryAfter(response.headers.get('Retry-After')))
  if([401,403].includes(response.status)||response.status>=300&&response.status<400)throw new LibraryError('auth','学校要求重新登录，预约连接已暂停。')
  if(!response.ok){const action=path.startsWith('reserve/resvInfo')?'预约记录':path.startsWith('reserve?')?'座位':path.startsWith('seatMenu')?'楼层':'图书馆';throw new LibraryError(body===undefined?'server':'uncertain',body===undefined?`${action}查询未成功（HTTP ${response.status}），请稍后再查或打开学校原页。`:'服务器暂未确认提交结果，请先查看“我的预约”。')}
  const reader=response.body?.getReader(); if(!reader)throw new LibraryError('schema','学校响应为空。')
  const chunks:Uint8Array[]=[];let length=0
  try {
    const limit=4_000_000
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error('size')};chunks.push(value)}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    const value:unknown=JSON.parse(new TextDecoder().decode(bytes))
    const envelope=z.object({code:z.number().int(),message:z.string().max(1000).optional(),data:z.unknown().optional()}).safeParse(value)
    if(!envelope.success)throw new Error('schema')
    if(process.argv.includes('--inspect-library'))console.log('LIBRARY_RESPONSE',JSON.stringify({endpoint:path.split('?')[0],code:envelope.data.code,dataKind:Array.isArray(envelope.data.data)?'array':typeof envelope.data.data,rows:Array.isArray(envelope.data.data)?envelope.data.data.length:undefined}))
    if([300,401,403].includes(envelope.data.code))throw new LibraryError('auth','学校登录已过期，请重新连接后再操作。')
    if(envelope.data.code===429)throw new LibraryError('rate-limit','学校要求稍后再查询。')
    if(envelope.data.code!==0)throw new LibraryError('validation',envelope.data.message||'学校未接受这次操作，请检查预约条件。')
    return value
  } catch(error){if(error instanceof LibraryError)throw error;throw new LibraryError(body===undefined?'schema':'uncertain',body===undefined?'学校返回格式有变化，保留上次数据。':'提交结果无法确认，请先查看“我的预约”，避免重复提交。')}
  finally{reader.releaseLock()}
}
export const envelopeData=(payload:unknown):unknown=>(payload as {data?:unknown}).data
export function reservationQuery(date:string,page=1):URLSearchParams {
  z.iso.date().parse(date)
  return new URLSearchParams({beginDate:date,endDate:date,page:String(page),pageNum:'100',needStatus:'0',orderKey:'gmt_create',orderModel:'desc'})
}
export function parseLibraryReservations(payload:unknown):{records:LibraryReservation[];rawCount:number;count:number|null} {
  const parsed=z.object({code:z.literal(0),data:z.array(z.record(z.string(),z.unknown())).max(1000),count:z.number().int().nonnegative().optional()}).safeParse(payload)
  if(!parsed.success)throw new LibraryError('schema','预约记录格式有变化，请在学校原页核对。')
  const text=(value:unknown):string=>typeof value==='string'||typeof value==='number'?String(value).slice(0,300):''
  const formatTime=(value:unknown):string=>{
    if(typeof value!=='string'&&typeof value!=='number')return ''
    const stamp=epoch(value)
    return Number.isFinite(stamp)?new Date(stamp+8*3_600_000).toISOString().slice(0,16).replace('T',' '):text(value)
  }
  const status=(value:unknown):string=>{
    const mask=Number(value)
    if(!Number.isSafeInteger(mask)||mask<0)return text(value)
    const labels:[number,string][]=[[1,'预约成功'],[2,'未生效'],[4,'已生效'],[8,'待支付'],[16,'违约'],[32,'已支付'],[64,'已签到'],[128,'已结束'],[256,'审核中'],[512,'审核未通过'],[1024,'审核通过']]
    return labels.filter(([bit])=>(mask&bit)>0).map(([,label])=>label).join('、')||`学校状态 ${mask}`
  }
  const records=parsed.data.data.filter(r=>Number(r.classKind)===8).map((r,index)=>({
    id:text(r.resvId??r.uuid??r.id)||String(index),
    seat:text(r.devName)||(Array.isArray(r.resvDevInfoList)?r.resvDevInfoList.map(d=>d&&typeof d==='object'&&'devName'in d?text(d.devName):'').filter(Boolean).join('、'):''),
    begin:formatTime(r.resvBeginTime),end:formatTime(r.resvEndTime),status:text(r.statusName)||status(r.resvStatus)
  }))
  return {records,rawCount:parsed.data.data.length,count:parsed.data.count??null}
}
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
export const seatSearchSchema=z.object({floorId:z.number().int().positive(),date:z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),start:time,end:time,startMode:z.literal('now').optional()}).strict()
export const seatSelectionSchema=seatSearchSchema.extend({seatId:z.number().int().positive(),title:z.string().trim().max(100),memo:z.string().trim().max(500)}).strict()
export function resolveSeatTime<T extends SeatSearch>(query:T,sameDate=false,now=Date.now()):T {
  if(query.startMode!=='now')return query
  const window=libraryNowWindow(now)
  if(!window)throw new LibraryError('validation','今天已无可预约到 22:00 的时段，请修改日期或时间。')
  if(sameDate&&query.date!==window.date)throw new LibraryError('validation','日期已变化，请重新查询座位后预约。')
  return {...query,...window}
}
export function beijingToday():string {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
export function validateSeatTime(query:SeatSearch):void {
  const begin=Date.parse(`${query.date}T${query.start}:00+08:00`),end=Date.parse(`${query.date}T${query.end}:00+08:00`)
  if(!Number.isFinite(begin)||!Number.isFinite(end)||new Date(`${query.date}T12:00:00+08:00`).toISOString().slice(0,10)!==query.date||end<=begin)throw new LibraryError('validation','请选择有效的日期和起止时间。')
  if(begin<Date.now())throw new LibraryError('validation','开始时间已经过去，请选择之后的时段。')
}
export interface RawLibrarySeat {devId:number;roomId:number;devName:string;devProp:number;onlyView:boolean;openTimes:{openStartTime:string;openEndTime:string}[];resvInfo:{startTime:string|number;endTime:string|number;resvStatus?:number}[];resvRule:{ruleId:number;minResvTime?:number;maxResvTime?:number;limit?:number}}
const rawSeatSchema=z.object({devId:z.number().int().positive(),roomId:z.number().int().positive(),devName:z.string().min(1).max(120),devProp:z.number().int(),onlyView:z.boolean().default(false),openTimes:z.array(z.object({openStartTime:z.string(),openEndTime:z.string()})),resvInfo:z.array(z.object({startTime:z.union([z.string(),z.number()]),endTime:z.union([z.string(),z.number()]),resvStatus:z.number().int().optional()})),resvRule:z.object({ruleId:z.number().int(),minResvTime:z.number().optional(),maxResvTime:z.number().optional(),limit:z.number().optional()})})
function epoch(value:string|number,date?:string):number {
  if(typeof value==='number')return value
  if(/^\d{2}:\d{2}(?::\d{2})?$/.test(value)&&date)return Date.parse(`${date}T${value.length===5?value+':00':value}+08:00`)
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)?value:value.replace(' ','T')+'+08:00')
}
function asTime(value:string|number,date:string):string {
  const stamp=epoch(value,date)
  if(!Number.isFinite(stamp))throw new LibraryError('schema','座位时间数据不完整。')
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(stamp)
}
export function parseLibrarySeats(payload:unknown,query:SeatSearch):{seats:LibrarySeat[];raw:RawLibrarySeat[]} {
  const parsed=z.array(rawSeatSchema).max(5000).safeParse(envelopeData(payload))
  if(!parsed.success)throw new LibraryError('schema','座位明细格式有变化，请打开学校页面核对。')
  const begin=epoch(query.start,query.date),end=epoch(query.end,query.date)
  const raw=parsed.data.filter(s=>(s.devProp&2)>0||s.onlyView)
  if(raw.some(s=>s.roomId!==query.floorId))throw new LibraryError('schema','座位所属楼层与请求不一致，未更新数据。')
  if(new Set(raw.map(s=>s.devId)).size!==raw.length)throw new LibraryError('schema','学校返回了重复座位，停止选座。')
  const seats=raw.map(s=>{
    const open:SeatInterval[]=s.openTimes.map(t=>({start:asTime(t.openStartTime,query.date),end:asTime(t.openEndTime,query.date)}))
    const active=s.resvInfo.filter(t=>((t.resvStatus??0)&128)===0)
    const occupied:SeatInterval[]=active.map(t=>({start:asTime(t.startTime,query.date),end:asTime(t.endTime,query.date)}))
    const inOpen=s.openTimes.some(t=>begin>=epoch(t.openStartTime,query.date)&&end<=epoch(t.openEndTime,query.date))
    const conflicts=active.some(t=>{const a=epoch(t.startTime,query.date),b=epoch(t.endTime,query.date);if(!Number.isFinite(a)||!Number.isFinite(b))throw new LibraryError('schema','座位占用时段不完整。');return begin<b&&end>a})
    const duration=(end-begin)/60_000,min=s.resvRule.minResvTime,max=s.resvRule.maxResvTime
    return {id:s.devId,floorId:s.roomId,name:s.devName,available:!s.onlyView&&inOpen&&!conflicts&&(!min||duration>=min)&&(!max||duration<=max),onlyView:s.onlyView,open,occupied,minMinutes:min??null,maxMinutes:max??null}
  })
  return {raw,seats:seats.sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}))}
}
export function encryptedSeatPayload(selection:SeatSelection,accNo:number,publicKey:string,captcha:string):Record<string,unknown> {
  const key=randomBytes(8).toString('hex')
  const plain=Buffer.from(String(selection.seatId),'utf8'),padded=Buffer.alloc(Math.ceil(plain.length/16)*16);plain.copy(padded)
  const cipher=createCipheriv('aes-128-cbc',Buffer.from(key,'utf8'),Buffer.from('ABCDEF1234123412','utf8'));cipher.setAutoPadding(false)
  const encrypted=Buffer.concat([cipher.update(padded),cipher.final()]).toString('hex').toUpperCase()
  const pem=publicKey.includes('BEGIN PUBLIC KEY')?publicKey:`-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`
  return {sysKind:8,appAccNo:accNo,memberKind:1,resvMember:[accNo],resvBeginTime:`${selection.date} ${selection.start}:00`,resvEndTime:`${selection.date} ${selection.end}:00`,testName:selection.title,captcha,resvProperty:0,resvDev:[0],encryptVlaue:publicEncrypt({key:pem,padding:constants.RSA_PKCS1_PADDING},Buffer.from(key)).toString('base64'),resvDevEncrypts:[encrypted],memo:selection.memo}
}
