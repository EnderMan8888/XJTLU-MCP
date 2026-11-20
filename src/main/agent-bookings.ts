import { randomUUID } from 'node:crypto'
import type { AgentBooking, BookingDraft, LibraryBookingResult, SeatSelection } from '../shared/library.ts'

interface BookingService {
  prepareBooking(selection: SeatSelection): Promise<BookingDraft>
  submitBooking(id: string, accepted: boolean, captcha: string): Promise<LibraryBookingResult>
  discardBooking(id: string): void
}

export class AgentBookings {
  private requests = new Map<string, AgentBooking>()
  private active: AgentBooking | null = null
  private draftId: string | null = null
  private expiry: ReturnType<typeof setTimeout> | null = null
  private reviewing = false

  private service: BookingService
  private publish: (request: AgentBooking | null) => void
  constructor(service: BookingService, publish: (request: AgentBooking | null) => void) {
    this.service = service
    this.publish = publish
  }

  request(selection: SeatSelection, seat: string): AgentBooking | null {
    if (this.active) {
      const previous = this.active.selection
      const same = previous.startMode === selection.startMode && (Object.keys(selection) as (keyof SeatSelection)[]).every(key =>
        key === 'start' && selection.startMode === 'now' || selection[key] === previous[key])
      return same ? this.active : null
    }
    const request: AgentBooking = {
      id: randomUUID(), selection, seat, phase: 'pending',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      message: '请在桌面应用的图书馆页面核对并确认本次预约。'
    }
    this.active = request
    this.requests.set(request.id, request)
    if (this.requests.size > 20) this.requests.delete(this.requests.keys().next().value!)
    this.expiry = setTimeout(() => this.finish(request, 'expired', '预约请求已过期，请发起新请求。'), 5 * 60_000)
    this.expiry.unref()
    this.publish(request)
    return request
  }

  get(id: string): AgentBooking | undefined { return this.requests.get(id) }

  async review(id: string): Promise<BookingDraft> {
    const request = this.active
    if (request?.id !== id || request.phase !== 'pending' || this.reviewing) throw new Error('该预约请求目前无法核对。')
    this.reviewing = true
    try {
      const draft = await this.service.prepareBooking(request.selection)
      if (this.active !== request || request.phase !== 'pending') {
        this.service.discardBooking(draft.id)
        throw new Error('预约请求已失效。')
      }
      this.draftId = draft.id
      return draft
    } finally { this.reviewing = false }
  }

  async submit(id: string, draftId: string, accepted: boolean, captcha: string): Promise<LibraryBookingResult> {
    const request = this.active
    if (request?.id !== id || request.phase !== 'pending' || draftId !== this.draftId) throw new Error('预约请求已失效，请重新核对。')
    if (this.expiry) clearTimeout(this.expiry)
    request.phase = 'submitting'
    request.message = '正在等待学校确认预约。'
    this.publish(request)
    let result: LibraryBookingResult
    try { result = await this.service.submitBooking(draftId, accepted, captcha) }
    catch { result = { ok: false, uncertain: true, message: '预约结果未能确认，请在我的预约中核对。' } }
    const phase = result.ok ? 'completed' : result.uncertain ? 'uncertain' : result.requiresVerification ? 'verification-required' : 'failed'
    this.finish(request, phase, result.message)
    return result
  }

  cancel(id: string): void {
    if (this.active?.id === id && this.active.phase === 'pending') this.finish(this.active, 'cancelled', '用户已取消预约请求。')
  }

  reset(): void {
    if (this.expiry) clearTimeout(this.expiry)
    if (this.draftId) this.service.discardBooking(this.draftId)
    this.expiry = null
    this.draftId = null
    this.active = null
    this.requests.clear()
    this.publish(null)
  }

  private finish(request: AgentBooking, phase: AgentBooking['phase'], message: string): void {
    if (this.active !== request) return
    if (this.expiry) clearTimeout(this.expiry)
    if (this.draftId) this.service.discardBooking(this.draftId)
    this.expiry = null
    this.draftId = null
    this.active = null
    request.phase = phase
    request.message = message
    this.publish(null)
  }
}
