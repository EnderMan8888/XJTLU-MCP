import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CredentialStatus, SavedCredentials } from '../shared/credentials.ts'

export interface CredentialCrypto {
  available(): Promise<boolean>
  encrypt(plaintext: string): Promise<Buffer>
  decrypt(ciphertext: Buffer): Promise<string>
}

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(1024)
}).strict()
const storedSchema = z.object({
  version: z.literal(1),
  encrypted: z.string().min(4).max(30_000).regex(/^[A-Za-z0-9+/]+={0,2}$/)
}).strict()

function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export class CredentialStore {
  private readonly file: string
  private readonly directory: string
  private readonly crypto: CredentialCrypto
  private tail: Promise<unknown> = Promise.resolve()

  constructor(directory: string, crypto: CredentialCrypto) {
    this.directory = directory
    this.crypto = crypto
    this.file = join(directory, 'ams-credentials.json')
  }

  // Serialize saves and deletion: a slow encryption must not restore a password
  // after the user has requested its deletion.
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.catch(() => {})
    return result
  }

  private async encryptionAvailable(): Promise<boolean> {
    try { return await this.crypto.available() } catch { return false }
  }

  private async exists(): Promise<boolean> {
    try { await stat(this.file); return true } catch (error) { if (missing(error)) return false; throw error }
  }

  private async readUnlocked(): Promise<SavedCredentials | null> {
    if (!(await this.exists())) return null
    if (!(await this.encryptionAvailable())) throw new Error('本机加密暂不可用，无法读取已保存的密码。')
    try {
      if ((await stat(this.file)).size > 32_000) throw new Error('Oversized credential file')
      const stored = storedSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))
      const plaintext = await this.crypto.decrypt(Buffer.from(stored.encrypted, 'base64'))
      return credentialsSchema.parse(JSON.parse(plaintext))
    } catch { throw new Error('无法解锁已保存的密码，请删除后重新保存。') }
  }

  read(): Promise<SavedCredentials | null> { return this.run(() => this.readUnlocked()) }

  status(): Promise<CredentialStatus> {
    return this.run(async () => {
      const available = await this.encryptionAvailable()
      let saved = false
      try {
        saved = await this.exists()
        if (!saved) return { available, saved: false, username: null, message: available ? '尚未保存账号密码。' : '本机加密不可用，暂不能保存密码。' }
        const credentials = await this.readUnlocked()
        return { available, saved, username: credentials?.username ?? null, message: '学校账号已加密保存在本机，供已接入的服务自动登录。' }
      } catch {
        return { available, saved, username: null, message: '已保存的信息暂时无法解锁，可删除后重新保存。' }
      }
    })
  }

  save(input: unknown): Promise<void> {
    return this.run(async () => {
      const parsed = credentialsSchema.safeParse(input)
      if (!parsed.success) throw new Error('请输入有效的学校账号和密码。')
      if (!(await this.encryptionAvailable())) throw new Error('本机加密不可用，未保存密码。')
      const temporary = join(this.directory, `.ams-credentials-${randomUUID()}.tmp`)
      try {
        // Encrypt the entire record, including the username, before any disk write.
        const encrypted = await this.crypto.encrypt(JSON.stringify(parsed.data))
        if (!encrypted.length) throw new Error('Empty encryption result')
        await mkdir(this.directory, { recursive: true })
        await writeFile(temporary, JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }), { mode: 0o600, flag: 'wx' })
        await rename(temporary, this.file)
      } catch {
        await unlink(temporary).catch(() => {})
        throw new Error('加密保存失败，未更新已保存的密码。')
      }
    })
  }

  forget(): Promise<void> {
    return this.run(async () => {
      try { await unlink(this.file) } catch (error) { if (!missing(error)) throw new Error('无法删除已保存的密码，请重试。') }
    })
  }
}
