import { setTimeout as delay } from 'node:timers/promises'
import type { ConnectionPhase } from '../shared/ams.ts'
import type { SchoolService } from '../shared/auto-relogin.ts'

interface SchoolConnection {
  phase(): ConnectionPhase
  connect(): Promise<void>
}

export class AutoRelogin {
  private pending = new Map<SchoolService, Promise<boolean>>()
  private revision = 0
  private readonly connections: Record<SchoolService, SchoolConnection>
  private readonly enabled: (service: SchoolService) => boolean
  private readonly waitMs: number

  constructor(connections: Record<SchoolService, SchoolConnection>,
    enabled: (service: SchoolService) => boolean, waitMs = 10_000) {
    this.connections = connections
    this.enabled = enabled
    this.waitMs = waitMs
  }

  cancelPending(): void {
    this.revision++
    this.pending.clear()
  }

  async ensureConnected(service: SchoolService): Promise<boolean> {
    if (this.connections[service].phase() === 'connected') return true
    const revision = this.revision
    return await this.reconnect(service) && revision === this.revision
  }

  private async reconnect(service: SchoolService): Promise<boolean> {
    if (!this.enabled(service)) return false
    const pending = this.pending.get(service)
    if (pending) return pending
    const connection = this.connections[service]
    if (connection.phase() !== 'expired') return false
    const revision = this.revision
    const task = (async () => {
      await connection.connect()
      const deadline = Date.now() + this.waitMs
      while (revision === this.revision) {
        const phase = connection.phase()
        if (phase === 'connected') return this.enabled(service)
        if (!this.enabled(service) || (phase !== 'authenticating' && phase !== 'loading') || Date.now() >= deadline) break
        await delay(250)
      }
      return false
    })().catch(() => false).finally(() => {
      if (this.pending.get(service) === task) this.pending.delete(service)
    })
    this.pending.set(service, task)
    return task
  }

  async read<T>(service: SchoolService, read: () => Promise<T>, afterReconnect = read): Promise<T | undefined> {
    const connection = this.connections[service]
    const revision = this.revision
    if (connection.phase() !== 'connected') {
      if (await this.ensureConnected(service) && revision === this.revision) return afterReconnect()
      return
    }
    const recover = async (): Promise<boolean> => {
      return revision === this.revision && await this.reconnect(service) && revision === this.revision
    }
    let result: T
    try { result = await read() }
    catch (error) {
      if (await recover()) return afterReconnect()
      throw error
    }
    if (connection.phase() !== 'connected' && await recover()) return afterReconnect()
    return result
  }
}
