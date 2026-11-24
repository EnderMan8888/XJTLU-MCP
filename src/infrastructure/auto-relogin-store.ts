import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultAutoRelogin, SCHOOL_SERVICES, type AutoReloginSettings, type SchoolService } from '../shared/auto-relogin.ts'

export class AutoReloginStore {
  private settings = { ...defaultAutoRelogin }
  private writes = Promise.resolve()
  private readonly directory: string
  private readonly file: string

  constructor(directory: string) {
    this.directory = directory
    this.file = join(directory, 'auto-relogin.json')
  }

  async load(): Promise<void> {
    try {
      const stored: Partial<AutoReloginSettings> | null = JSON.parse(await readFile(this.file, 'utf8'))
      for (const service of SCHOOL_SERVICES) this.settings[service] = stored?.[service] === true
    } catch {
      // Missing or unreadable settings leave automatic re-login off.
    }
  }

  get(): AutoReloginSettings { return { ...this.settings } }
  enabled(service: SchoolService): boolean { return this.settings[service] }

  set(service: SchoolService, enabled: boolean): Promise<AutoReloginSettings> {
    const write = this.writes.then(async () => {
      const next = { ...this.settings, [service]: enabled }
      const temporary = join(this.directory, `auto-relogin-${randomUUID()}.tmp`)
      await mkdir(this.directory, { recursive: true })
      try {
        await writeFile(temporary, JSON.stringify(next), { flag: 'wx' })
        await rename(temporary, this.file)
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
      this.settings = next
      return this.get()
    })
    this.writes = write.then(() => {}, () => {})
    return write
  }
}
