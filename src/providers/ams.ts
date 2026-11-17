import { z } from 'zod'
import { AMS_MODULES, AMS_MODULE_RECORDS, AMS_ORIGIN, AMS_TERMS, AMS_TIMETABLE, type AttendanceStatus, type TimetableDay } from '../shared/ams.ts'

export class AmsError extends Error {
  readonly kind: 'auth' | 'network' | 'schema' | 'server'
  constructor(kind: AmsError['kind'], message: string) {
    super(message)
    this.name = 'AmsError'
    this.kind = kind
  }
}

const text = z.union([z.string(), z.number()]).nullish().transform((value) => String(value ?? ''))
const entrySchema = z.object({
  moduleCode: text,
  moduleTitle: z.string().min(1),
  moduleDate: text,
  moduleTime: text,
  room: text,
  moduleTypeGroup: text,
  status: z.union([z.number(), z.string()]).nullish()
})
const dataSchema = z.array(z.object({
  date: z.string(),
  timetableVoList: z.array(entrySchema)
}))

// Field names and status meanings were observed in AMS's public studentpc frontend.
// Unknown values remain unknown; a parsing failure must not become an empty timetable.
function attendance(value: unknown): AttendanceStatus {
  if (value === 0 || value === '0') return 'unmarked'
  if (value === 1 || value === '1') return 'present'
  if (value === 2 || value === '2') return 'absent'
  if (value === 3 || value === '3') return 'authorized-absence'
  return 'unknown'
}

export function unwrapAmsData(payload: unknown): unknown {
  const envelope = z.object({ code: z.union([z.number(), z.string()]), data: z.unknown().optional() }).safeParse(payload)
  if (!envelope.success) throw new AmsError('schema', 'AMS 返回了无法识别的响应，未更新课表。')
  if (String(envelope.data.code) === '401' || String(envelope.data.code) === '403') {
    throw new AmsError('auth', 'AMS 登录已过期，请重新登录。')
  }
  if (String(envelope.data.code) !== '0') throw new AmsError('server', 'AMS 暂时无法完成查询，请稍后重试。')
  return envelope.data.data
}

export function parseTimetable(payload: unknown): TimetableDay[] {
  const parsed = dataSchema.safeParse(unwrapAmsData(payload))
  if (!parsed.success) throw new AmsError('schema', 'AMS 课表格式发生变化，未更新课表。')
  return parsed.data.filter((day) => day.date !== '-' || day.timetableVoList.length > 0).map((day) => ({
    date: day.date,
    entries: day.timetableVoList.map((entry, index) => ({
      id: [day.date, entry.moduleCode, entry.moduleTime, entry.moduleTypeGroup, index].join(':'),
      moduleCode: entry.moduleCode,
      moduleTitle: entry.moduleTitle,
      date: entry.moduleDate || day.date,
      time: entry.moduleTime,
      room: entry.room,
      teachingGroup: entry.moduleTypeGroup,
      attendance: attendance(entry.status)
    }))
  }))
}

export type AmsFetch = (url: string, init: RequestInit) => Promise<Response>

export async function fetchTimetable(token: string, fetcher: AmsFetch): Promise<TimetableDay[]> {
  return parseTimetable(await fetchAmsPayload(token, AMS_TIMETABLE, fetcher))
}

export async function fetchAmsPayload(token: string, url: string, fetcher: AmsFetch): Promise<unknown> {
  if (!token) throw new AmsError('auth', '请先在 AMS 官方窗口完成登录。')
  const target = new URL(url)
  const allowedPaths = [AMS_TIMETABLE, AMS_MODULES, AMS_MODULE_RECORDS, AMS_TERMS].map((value) => new URL(value).pathname)
  if (target.origin !== AMS_ORIGIN || target.username || target.password || !allowedPaths.includes(target.pathname)) {
    throw new AmsError('server', '查询地址不受支持。')
  }
  let response: Response
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Token': token },
      credentials: 'include',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    throw new AmsError('network', '无法连接 AMS，请检查网络后重试。')
  }
  if (response.status === 401 || response.status === 403) throw new AmsError('auth', 'AMS 登录已过期，请重新登录。')
  if (!response.ok) throw new AmsError('server', 'AMS 服务暂时不可用，请稍后重试。')
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('json')) throw new AmsError('schema', 'AMS 返回了网页而非课表数据，请检查登录状态。')
  // Bound the response before JSON parsing, including chunked responses.
  const reader = response.body?.getReader()
  if (!reader) throw new AmsError('schema', 'AMS 响应为空。')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2_000_000) {
        await reader.cancel()
        throw new AmsError('schema', 'AMS 响应过大，已停止读取。')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    if (error instanceof AmsError) throw error
    throw new AmsError('schema', 'AMS 响应读取失败，未更新课表。')
  } finally {
    reader.releaseLock()
  }
}
