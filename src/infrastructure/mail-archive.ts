import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { mailDate, type MailFolder, type MailMessage, type MailSummary } from '../shared/mail.ts'
import type { CredentialCrypto } from './credential-store.ts'

const ownerKey = /^[a-f0-9]{64}$/
const maxFileSize = 32 * 1024 * 1024
const maxMessagesPerFolder = 5000
const maxDetails = 1000
const maxDetailBytes = 1024 * 1024
const maxDetailsBytes = 16 * 1024 * 1024
const text = z.string().max(8192).nullable()
const address = z.object({ name: text, address: text }).nullable()
const summary = z.object({
  id: z.string().min(1).max(4096), subject: z.string().max(8192), from: address, receivedAt: text,
  sentAt: text, isRead: z.boolean().nullable(), hasAttachments: z.boolean().nullable()
})
const detail = summary.extend({
  body: z.string().max(maxDetailBytes), bodyType: z.enum(['text', 'html']),
  to: z.array(address).max(500), cc: z.array(address).max(500), bcc: z.array(address).max(500)
})
const schema = z.object({
  version: z.literal(1),
  inbox: z.array(summary).max(maxMessagesPerFolder),
  sentitems: z.array(summary).max(maxMessagesPerFolder),
  details: z.array(detail).max(maxDetails)
})
type Archive = z.infer<typeof schema>

async function remove(file: string): Promise<void> {
  try { await unlink(file) }
  catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error }
}

export class MailArchive {
  enabled = false
  revision = 0
  private queue = Promise.resolve()
  private cached: { owner: string; data: Archive } | null = null
  private readonly directory: string
  private readonly crypto: CredentialCrypto

  constructor(directory: string, crypto: CredentialCrypto) {
    this.directory = directory
    this.crypto = crypto
  }

  private get flag(): string { return join(this.directory, 'mail-archive-enabled') }

  async load(): Promise<void> {
    this.enabled = await readFile(this.flag, 'utf8').then(value => value === '1', () => false)
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => {}, () => {})
    return result
  }

  setEnabled(enabled: boolean): Promise<void> {
    this.revision++
    return this.serial(async () => {
      if (enabled) {
        if (!await this.crypto.available()) throw new Error('Mail encryption unavailable')
        await mkdir(this.directory, { recursive: true })
        await writeFile(this.flag, '1', { mode: 0o600 })
      } else await remove(this.flag)
      this.enabled = enabled
      this.cached = null
    })
  }

  clear(): Promise<void> {
    this.revision++
    return this.serial(async () => {
      this.cached = null
      const files = await readdir(this.directory).catch(error => {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
        throw error
      })
      for (const name of files) {
        if (/^(?:mail-archive-[a-f0-9]{64}\.bin|\.mail-archive-[a-f0-9-]{36}\.tmp)$/.test(name)) {
          await remove(join(this.directory, name))
        }
      }
    })
  }

  private file(owner: string): string {
    if (!ownerKey.test(owner)) throw new Error('Invalid mailbox key')
    return join(this.directory, 'mail-archive-' + owner + '.bin')
  }

  private async read(owner: string): Promise<Archive> {
    if (this.cached?.owner === owner) return this.cached.data
    const file = this.file(owner)
    let data: Archive
    try {
      const metadata = await stat(file)
      if (!metadata.isFile() || metadata.size > maxFileSize) throw new Error('Invalid mail archive size')
      if (!await this.crypto.available()) throw new Error('Mail encryption unavailable')
      data = schema.parse(JSON.parse(await this.crypto.decrypt(await readFile(file))))
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      data = { version: 1, inbox: [], sentitems: [], details: [] }
    }
    this.cached = { owner, data }
    return data
  }

  private async write(owner: string, data: Archive): Promise<void> {
    if (!await this.crypto.available()) throw new Error('Mail encryption unavailable')
    const file = this.file(owner)
    const encrypted = await this.crypto.encrypt(JSON.stringify(data))
    if (!encrypted.length || encrypted.length > maxFileSize) throw new Error('Invalid mail archive size')
    const temporary = join(this.directory, '.mail-archive-' + randomUUID() + '.tmp')
    try {
      await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
      await rename(temporary, file)
      this.cached = { owner, data }
    } finally {
      await remove(temporary).catch(() => {})
    }
  }

  list(owner: string, revision: number, folder: MailFolder): Promise<MailSummary[]> {
    return this.serial(async () => this.enabled && this.revision === revision ? (await this.read(owner))[folder] : [])
  }

  get(owner: string, revision: number, id: string): Promise<MailMessage | undefined> {
    return this.serial(async () => {
      if (this.enabled && this.revision === revision) return (await this.read(owner)).details.find(item => item.id === id)
    })
  }

  saveList(owner: string, revision: number, folder: MailFolder, items: MailSummary[]): Promise<void> {
    return this.serial(async () => {
      if (!this.enabled || this.revision !== revision || !items.length) return
      const data = await this.read(owner)
      const previous = new Map(data[folder].map(item => [item.id, item]))
      let changed = false
      for (const item of items) {
        const parsed = summary.safeParse(item)
        if (!parsed.success || JSON.stringify(previous.get(item.id)) === JSON.stringify(parsed.data)) continue
        previous.set(item.id, parsed.data)
        changed = true
      }
      if (!changed) return
      const date = (item: MailSummary) => Date.parse(mailDate(item, folder) ?? '') || 0
      const messages = [...previous.values()].sort((a, b) => date(b) - date(a)).slice(0, maxMessagesPerFolder)
      await this.write(owner, { ...data, [folder]: messages })
    })
  }

  saveMessage(owner: string, revision: number, message: MailMessage): Promise<void> {
    return this.serial(async () => {
      if (!this.enabled || this.revision !== revision || Buffer.byteLength(message.body) > maxDetailBytes) return
      const parsed = detail.safeParse(message)
      if (!parsed.success) return
      const data = await this.read(owner)
      const recent = [parsed.data, ...data.details.filter(item => item.id !== message.id)]
      const details: MailMessage[] = []
      let bytes = 0
      for (const item of recent.slice(0, maxDetails)) {
        bytes += Buffer.byteLength(JSON.stringify(item))
        if (bytes > maxDetailsBytes) break
        details.push(item)
      }
      await this.write(owner, { ...data, details })
    })
  }
}
