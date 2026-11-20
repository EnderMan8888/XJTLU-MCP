import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { EbridgeOverview } from '../shared/ebridge.ts'
import type { CredentialCrypto } from './credential-store.ts'

const maxBytes = 4 * 1024 * 1024
const text = z.string().max(10_000).transform(value => value.replace(/https?:\/\/[^\s<>]+/gi, '[学校链接]'))
const timestamp = z.iso.datetime().nullable()
const overview = z.object({
  courses: z.array(z.object({ code: text, title: text, year: text, semester: text, credits: text, status: text })).max(5000),
  timetable: z.array(z.object({ id: text, code: text, title: text, date: text, time: text, room: text, type: text, staff: text, weeks: text, group: text })).max(5000),
  exams: z.array(z.object({ id: text, code: text, title: text, date: text, dateKey: z.iso.date().nullable(), day: text, admissionTime: text, startTime: text, duration: text, room: text, seat: text, area: text, entrance: text })).max(5000),
  coursesAt: timestamp, timetableAt: timestamp, examsAt: timestamp,
  timetableTerm: z.object({ year: z.string().regex(/^20\d{2}\/\d{2}$/), semester: z.union([z.literal(1), z.literal(2)]) }).nullable()
})
const record = z.object({ version: z.literal(1), owner: z.string().min(1).max(256), data: overview })

function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export class EbridgeCache {
  private readonly file: string
  private readonly directory: string
  private readonly crypto: CredentialCrypto

  constructor(directory: string, crypto: CredentialCrypto) {
    this.directory = directory
    this.crypto = crypto
    this.file = join(directory, 'ebridge-cache.bin')
  }

  async read(): Promise<{ owner: string; data: EbridgeOverview } | null> {
    try {
      if ((await stat(this.file)).size > maxBytes) throw new Error('Cache file too large')
      if (!await this.crypto.available()) throw new Error('Local encryption unavailable')
      const contents = await this.crypto.decrypt(await readFile(this.file))
      return record.parse(JSON.parse(contents))
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }

  async write(owner: string, data: EbridgeOverview): Promise<void> {
    if (!await this.crypto.available()) throw new Error('Local encryption unavailable')
    // The schema keeps only the three overview datasets and their timestamps.
    const payload = record.parse({ version: 1, owner, data })
    const ciphertext = await this.crypto.encrypt(JSON.stringify(payload))
    if (!ciphertext.length || ciphertext.length > maxBytes) throw new Error('Invalid cache size')
    const temporary = join(this.directory, `.ebridge-cache-${randomUUID()}.tmp`)
    try {
      await mkdir(this.directory, { recursive: true })
      await writeFile(temporary, ciphertext, { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.file)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }

  async clear(): Promise<void> {
    try { await unlink(this.file) } catch (error) { if (!missing(error)) throw error }
  }
}
