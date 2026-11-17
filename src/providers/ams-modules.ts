import { z } from 'zod'
import { AMS_MODULES, AMS_MODULE_SOURCE, AMS_TERMS } from '../shared/ams.ts'
import type { AcademicTerm, ModuleSnapshot, TermOptions } from '../shared/modules.ts'
import { AmsError, fetchAmsPayload, unwrapAmsData, type AmsFetch } from './ams.ts'

export const academicTermSchema = z.object({ academicYear: z.string().trim().min(1).max(64), semester: z.string().trim().min(1).max(64) }).strict()
const nullableNumber = z.union([z.number(), z.string()]).nullish().transform((value, context) => {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0) { context.addIssue({ code: 'custom', message: 'Invalid source number' }); return z.NEVER }
  return number
})
const rate = nullableNumber.refine((value) => value === null || value <= 100)
const moduleSchema = z.object({
  moduleCode: z.string().min(1),
  // AMS's published frontend uses this misspelled source field.
  moudleTitle: z.string().min(1),
  courseAttendance: rate,
  classHour: nullableNumber,
  signClassHour: nullableNumber,
  absences: nullableNumber,
  leaveClassHour: nullableNumber
})
const dataSchema = z.object({ comprehensiveAttendance: rate, vos: z.array(moduleSchema).max(3000) })

export function parseModules(payload: unknown, term: AcademicTerm, fetchedAt = new Date().toISOString()): ModuleSnapshot {
  const parsed = dataSchema.safeParse(unwrapAmsData(payload))
  if (!parsed.success) throw new AmsError('schema', 'AMS Module 数据格式发生变化，未更新课程列表。')
  return {
    term,
    fetchedAt,
    sourceUrl: AMS_MODULE_SOURCE,
    overallAttendanceRate: parsed.data.comprehensiveAttendance,
    modules: parsed.data.vos.map((row) => ({
      code: row.moduleCode,
      title: row.moudleTitle,
      // Match the school page: zero attendance with zero absence is displayed
      // as "-", rather than claiming that an unmeasured course has a 0% rate.
      attendanceRate: row.courseAttendance === 0 && row.absences === 0 ? null : row.courseAttendance,
      sourceAttendanceRate: row.courseAttendance,
      classHours: row.classHour,
      attendedHours: row.signClassHour,
      absentHours: row.absences,
      authorizedAbsenceHours: row.leaveClassHour
    }))
  }
}

export function parseTermNames(payload: unknown): string[] {
  const parsed = z.array(z.object({ name: z.string().min(1).max(64) })).max(300).safeParse(unwrapAmsData(payload))
  if (!parsed.success) throw new AmsError('schema', 'AMS 学年或学期选项无法识别。')
  return [...new Set(parsed.data.map((row) => row.name))]
}

export async function fetchModuleSnapshot(token: string, input: unknown, fetcher: AmsFetch): Promise<ModuleSnapshot> {
  const parsed = academicTermSchema.safeParse(input)
  if (!parsed.success) throw new AmsError('schema', '请先选择有效的学年和学期。')
  const url = new URL(AMS_MODULES)
  url.search = new URLSearchParams({ type: '1', ...parsed.data }).toString()
  return parseModules(await fetchAmsPayload(token, url.href, fetcher), parsed.data)
}

export async function fetchTermOptions(token: string, fetcher: AmsFetch): Promise<TermOptions> {
  const [years, semesters] = await Promise.all([1, 2].map((type) => fetchAmsPayload(token, `${AMS_TERMS}?type=${type}`, fetcher)))
  return { academicYears: parseTermNames(years), semesters: parseTermNames(semesters) }
}
