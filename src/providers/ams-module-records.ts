import {z} from 'zod'
import {AMS_MODULE_RECORDS} from '../shared/ams.ts'
import type {ModuleAttendanceQuery,ModuleAttendanceRecord,ModuleAttendanceStatus} from '../shared/modules.ts'
import {academicTermSchema} from './ams-modules.ts'
import {AmsError,fetchAmsPayload,unwrapAmsData,type AmsFetch} from './ams.ts'

export const moduleAttendanceQuerySchema=z.object({date:z.iso.date(),term:academicTermSchema,moduleCodes:z.array(z.string().trim().min(1).max(40)).max(40)}).strict()
const text=z.union([z.string(),z.number()]).nullish().transform(value=>String(value??''))
const recordSchema=z.object({date:z.string().min(1),moduleTypeGroup:text,status:z.union([z.number(),z.string()]).nullish(),statusName:text,signTime:text})
const pageSchema=z.object({list:z.array(recordSchema).max(1000).nullish(),total:z.coerce.number().int().min(0).max(100_000)}).refine(page=>page.list!=null||page.total===0).transform(page=>({...page,list:page.list??[]}))

function attendance(value:unknown):ModuleAttendanceStatus {
  return ({'0':'unmarked','1':'present','2':'absent','3':'authorized-absence','4':'excluded'} as const)[String(value) as '0']??'unknown'
}

export function parseModuleRecordPage(payload:unknown,moduleCode:string):{records:ModuleAttendanceRecord[];total:number} {
  const data=unwrapAmsData(payload)
  const parsed=pageSchema.safeParse(data)
  if(!parsed.success)throw new AmsError('schema','AMS Module 单节考勤记录格式有变化，未更新签到状态。')
  const records=parsed.data.list.map((row,index)=>{
    const date=row.date.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]||''
    const time=row.date.match(/\b\d{1,2}:\d{2}(?::00)?\s*[-–—~～]\s*\d{1,2}:\d{2}(?::00)?\b/)?.[0]||''
    if(!date||!time){
      if(process.argv.includes('--inspect-home'))console.log('AMS_MODULE_SESSION_FORMAT',JSON.stringify({dateShape:row.date.replace(/\d/g,'0')}))
      throw new AmsError('schema','AMS Module 课堂日期或时间无法识别，未更新签到状态。')
    }
    return {id:[moduleCode,row.date,row.moduleTypeGroup,index].join(':'),moduleCode,date,time,teachingGroup:row.moduleTypeGroup,attendance:attendance(row.status),statusName:row.statusName,signTime:row.signTime}
  })
  return {records,total:parsed.data.total}
}

export async function fetchModuleRecords(token:string,query:ModuleAttendanceQuery,moduleCode:string,fetcher:AmsFetch):Promise<ModuleAttendanceRecord[]> {
  const records:ModuleAttendanceRecord[]=[]
  // Same date/module filters and pagination as Module > My Module > Detail.
  for(let pageNum=1;pageNum<=20;pageNum++){
    const url=new URL(AMS_MODULE_RECORDS)
    url.search=new URLSearchParams({moduleCode,...query.term,date:query.date,moduleTypeGroup:'',status:'',pageNum:String(pageNum),pageSize:'10',sortField:'',sortOrder:''}).toString()
    const page=parseModuleRecordPage(await fetchAmsPayload(token,url.href,fetcher),moduleCode)
    if(page.records.some(record=>record.date!==query.date))throw new AmsError('schema','AMS Module 返回了其他日期的记录，未更新签到状态。')
    records.push(...page.records.map((r,index)=>({...r,id:`${moduleCode}:${pageNum}:${index}:${r.id}`})))
    if(records.length>=page.total)return records
    if(!page.records.length)throw new AmsError('schema','AMS Module 考勤分页不完整，请稍后重试。')
  }
  throw new AmsError('schema','当天的 Module 考勤记录过多，已停止读取。')
}
