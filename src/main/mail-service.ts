import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { session, type BrowserWindow } from 'electron'
import { createCampusMailWindow } from './campus-mail-window'
import { SCHOOL_MANUAL_LOGIN_MESSAGE, showSchoolLoginWindow } from './school-login-window'
import { CAMPUS_MAIL_URL, mailOrigins } from '../security/mail-navigation'
import { buildCampusMailLoginScript, buildMicrosoftMailAccountScript, isCampusMailLoginPage, isMicrosoftMailLoginPage, microsoftMailAddress } from '../security/mail-login'
import { buildAutomaticLoginScript, buildLoginInspectionScript, isAuthenticationOrigin, isCredentialPage, SCHOOL_VERIFICATION_MESSAGE } from '../security/login-policy'
import { initialMailState, type MailFolder, type MailHistory, type MailLogin, type MailListInput, type MailLookup, type MailMessage, type MailState, type OutgoingMail } from '../shared/mail'
import type { AccountService } from '../services/account-service'
import type { MailArchive } from '../infrastructure/mail-archive'
import { MailError, OutlookMail, type MailAction } from '../providers/outlook-mail'

const canaryName = 'X-OWA-CANARY'
const maxResponseBytes = 4 * 1024 * 1024
const loginNeeded = () => new MailError('not_connected', '请先从桌面应用登录邮箱，再调用邮件工具。')
const sendingDisabled = () => new MailError('send_disabled', '请在「账号与设置 → 西浦邮箱」开启 Agent 发送邮件。')
const archiveUnavailable = '本机邮件存储暂不可用，请检查西浦邮箱设置。'
type MailboxSession = { origin: string; canary: string; cookieHeader: string }

async function readJson(response: Response): Promise<unknown> {
  if (!response.body || !/\bjson\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {})
    throw new MailError('mail_invalid_response', '网页登录尚未建立可读取的邮箱会话。')
  }
  const stream = response.body.getReader()
  const text = new TextDecoder()
  let bytes = 0
  let decoded = ''
  try {
    for (;;) {
      const chunk = await stream.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxResponseBytes) throw new MailError('mail_response_too_large', '该邮件结果太大，请缩小列表页大小或在 Outlook 阅读。')
      decoded += text.decode(chunk.value, { stream: true })
    }
    return JSON.parse(decoded + text.decode())
  } finally {
    await stream.cancel().catch(() => {})
  }
}

export class MailService {
  private readonly school = session.fromPartition('persist:xjtlu-mail')
  private readonly outlook = new OutlookMail((action, payload) => this.request(action, payload))
  private state = { ...initialMailState }
  private window: BrowserWindow | null = null
  private activeOrigin: string | null = null
  private sessionScope = new AbortController()
  private reset: Promise<void> = Promise.resolve()
  private checkPending: Promise<MailState> | null = null
  private sending = false
  private checkedOnEntry = false
  private automatic = false
  private loginTimeout: ReturnType<typeof setTimeout> | null = null
  private loginAttempt = ''
  private submitted = false
  private archiveOwner: { sessionKey: string; result: Promise<string> } | null = null

  constructor(private account: AccountService, private publish: (state: MailState) => void, private archive: MailArchive) {
    this.state.archive = { enabled: archive.enabled, revision: archive.revision, issue: null }
    this.school.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.school.setPermissionCheckHandler(() => false)
    this.school.cookies.on('changed', (_event, cookie, cause, removed) => {
      if (cookie.name !== canaryName || removed && cause === 'overwrite') return
      if (this.activeOrigin && cookie.domain && new URL(this.activeOrigin).hostname !== cookie.domain.replace(/^\./, '')) return
      if (removed) {
        this.cancelRequests()
        this.update({ sendEnabled: false })
      }
      void this.check()
    })
  }

  getState(): MailState { return { ...this.state } }

  private update(patch: Partial<MailState>): void {
    this.state = { ...this.state, ...patch }
    this.publish(this.getState())
  }

  setSendEnabled(enabled: boolean): MailState {
    if (enabled && this.state.phase !== 'connected') throw loginNeeded()
    this.update({ sendEnabled: enabled })
    return this.getState()
  }

  private updateArchive(issue: string | null): void {
    const { enabled, revision } = this.archive
    const previous = this.state.archive
    if (enabled !== previous.enabled || revision !== previous.revision || issue !== previous.issue) this.update({ archive: { enabled, revision, issue } })
  }

  async setArchiveEnabled(enabled: boolean): Promise<MailState> {
    try {
      await this.archive.setEnabled(enabled)
      this.updateArchive(null)
      return this.getState()
    } catch {
      this.updateArchive(archiveUnavailable)
      throw new Error(archiveUnavailable)
    }
  }

  async clearArchive(): Promise<MailState> {
    try {
      await this.archive.clear()
      this.updateArchive(null)
      return this.getState()
    } catch {
      this.updateArchive('清空本机存储失败，请重试。')
      throw new Error('Mail archive could not be cleared')
    }
  }

  async restore(parent: BrowserWindow): Promise<void> {
    if (this.checkedOnEntry || this.state.phase !== 'idle') return
    this.checkedOnEntry = true
    const scope = this.sessionScope
    const state = await this.check()
    if (state.phase !== 'manual-login-required' || scope.signal.aborted) return
    const account = await this.account.status()
    if (account.saved && !scope.signal.aborted) await this.open(parent, 'campus')
  }

  async open(parent: BrowserWindow, mode: MailLogin): Promise<void> {
    await this.reset
    if (parent.isDestroyed()) return
    if (this.window && !this.window.isDestroyed()) {
      if (mode === 'manual' && !this.automatic) { showSchoolLoginWindow(this.window); return }
      if (mode === 'campus' && this.automatic) return
      this.window.destroy()
    }
    this.cancelRequests()
    this.activeOrigin = new URL(CAMPUS_MAIL_URL).origin
    this.loginAttempt = randomUUID()
    this.submitted = false
    this.automatic = mode === 'campus'
    this.update({ phase: 'authenticating', message: this.automatic ? '正在连接西浦邮箱并尝试自动登录。' : '正在打开官方邮箱登录窗口。' })
    const window = createCampusMailWindow(parent, this.school, CAMPUS_MAIL_URL, page => void this.pageLoaded(page), message => {
      this.stopAutomaticLogin()
      this.update({ phase: 'error', message })
    }, this.automatic)
    this.window = window
    if (this.automatic) this.loginTimeout = setTimeout(() => {
      if (this.window === window) this.requireManualLogin(window, '自动登录等待超时。')
    }, 45_000)
    window.once('closed', () => {
      if (this.window !== window) return
      this.window = null
      this.stopAutomaticLogin()
      if (this.state.phase === 'authenticating') this.update({ phase: 'manual-login-required', message: loginNeeded().message })
    })
  }

  private stopAutomaticLogin(): void {
    if (this.loginTimeout) clearTimeout(this.loginTimeout)
    this.loginTimeout = null
    this.automatic = false
  }

  private requireManualLogin(window: BrowserWindow, message = SCHOOL_MANUAL_LOGIN_MESSAGE, verification = false): void {
    this.stopAutomaticLogin()
    this.update({ phase: verification ? 'verification-required' : 'manual-login-required', message })
    if (verification) showSchoolLoginWindow(window)
  }

  private async pageLoaded(window: BrowserWindow): Promise<void> {
    if (window !== this.window || window.isDestroyed()) return
    const contents = window.webContents
    const url = URL.parse(contents.getURL())
    if (!url) return
    const valid = () => this.window === window && !window.isDestroyed() && contents.getURL() === url.href
    if (isMicrosoftMailLoginPage(url)) {
      let message = '学校邮箱跳转到了 Microsoft。请在官方窗口继续。'
      try {
        const { username } = await this.account.status()
        const address = username ? microsoftMailAddress(username) : null
        if (address) {
          const code = buildMicrosoftMailAccountScript(address)
          for (let attempt = 0; valid() && attempt < 20; attempt++) {
            const result = await contents.executeJavaScriptInIsolatedWorld(1004, [{ code }])
            if (!valid()) return
            if (result === 'verification-required') { this.requireManualLogin(window, SCHOOL_VERIFICATION_MESSAGE, true); return }
            if (result === 'filled') message = '已填入保存的学校邮箱地址。请在登录窗口继续。'
            if (result === 'submitted' || result === 'already-submitted') message = '已提交学校邮箱地址。请在官方窗口完成后续登录。'
            if (result !== 'waiting' && result !== 'filled' && result !== 'submitted' && result !== 'already-submitted') break
            await delay(250)
          }
        }
      } catch { /* The manual login remains available if the form changes. */ }
      if (valid() && this.state.phase !== 'connected') this.requireManualLogin(window, message)
      return
    }
    const campusForm = isCampusMailLoginPage(url.href)
    if (campusForm || isAuthenticationOrigin(url.href)) {
      try {
        const execute = (code: string) => contents.executeJavaScriptInIsolatedWorld(1004, [{ code }])
        const inspect = () => execute(campusForm ? buildCampusMailLoginScript() : buildLoginInspectionScript())
        let phase = await inspect()
        for (let retry = 0; !campusForm && phase === 'waiting' && valid() && this.automatic && retry < 6; retry++) {
          await delay(250)
          if (!valid() || !this.automatic) return
          phase = await inspect()
        }
        if (!valid()) return
        if (phase === 'verification-required') { this.requireManualLogin(window, SCHOOL_VERIFICATION_MESSAGE, true); return }
        if (!campusForm && phase === 'waiting' && this.automatic) return
        if (this.automatic && !this.submitted && phase === 'credentials' && (campusForm || isCredentialPage(url.href))) {
          const credentials = await this.account.read()
          if (!valid()) return
          if (this.automatic && !this.submitted && credentials) {
            this.submitted = true
            const result = await execute(campusForm ? buildCampusMailLoginScript(credentials) : buildAutomaticLoginScript(credentials, this.loginAttempt))
            if (!valid() || result === 'submitted' || result === 'already-submitted') return
            if (result === 'verification-required') { this.requireManualLogin(window, SCHOOL_VERIFICATION_MESSAGE, true); return }
          }
        }
        this.requireManualLogin(window, phase === 'login-error' ? '学校登录未通过。请核对账号或密码。' : undefined)
      } catch { if (valid()) this.requireManualLogin(window) }
      return
    }
    if (mailOrigins.includes(url.origin) && !/^\/owa\/auth\//i.test(url.pathname)) {
      if (this.activeOrigin !== url.origin) {
        this.cancelRequests()
        this.activeOrigin = url.origin
      }
      const scope = this.sessionScope
      try {
        if (!await this.findSession(scope.signal)) {
          if (valid() && !this.automatic) this.requireManualLogin(window)
          return
        }
      } catch { return }
      if (valid()) void this.check()
    } else if (valid() && this.state.phase !== 'connected') {
      if (/\.microsoft(?:online)?\.com$/.test(url.hostname)) {
        this.requireManualLogin(window, '学校邮箱跳转到了 Microsoft。请手动完成登录和验证。')
      } else if (!this.automatic) {
        this.requireManualLogin(window)
      }
    }
  }

  private async findSession(signal: AbortSignal): Promise<MailboxSession | null> {
    // When the user is signing into a provider, do not fall back to a second mailbox.
    const origins = this.activeOrigin ? [this.activeOrigin] : mailOrigins
    for (const origin of origins) {
      const cookies = await this.school.cookies.get({ url: `${origin}/owa/service.svc` })
      signal.throwIfAborted()
      cookies.sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0))
      const canary = cookies.find(cookie => cookie.name === canaryName)?.value
      if (canary) return { origin, canary, cookieHeader: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') }
    }
    return null
  }

  private async request(action: MailAction, payload: object): Promise<unknown> {
    const scope = this.sessionScope
    await this.reset
    const current = await this.findSession(scope.signal)
    if (!current) throw loginNeeded()
    return this.requestFrom(current, scope, action, payload)
  }

  private async requestFrom(current: MailboxSession, scope: AbortController, action: MailAction, payload: object): Promise<unknown> {
    scope.signal.throwIfAborted()
    if (action === 'CreateItem' && !this.state.sendEnabled) throw sendingDisabled()
    const { origin, canary, cookieHeader } = current
    const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(12_000)])
    const response = await this.school.fetch(`${origin}/owa/service.svc?action=${action}`, {
      method: 'POST', credentials: 'include', redirect: 'manual', signal,
      // The main-process request has no first-party page context. Forward only
      // cookies scoped to this exact OWA endpoint and never follow redirects.
      headers: { Action: action, Origin: origin, Referer: `${origin}/owa/`, 'Content-Type': 'application/json; charset=utf-8', [canaryName]: canary, Cookie: cookieHeader },
      body: JSON.stringify(payload)
    }).catch(() => { throw new MailError('mail_network_error', '无法连接邮箱服务器，请检查网络后重试。') })
    if (response.status === 401 || response.status === 440 || response.status === 0 || response.status >= 300 && response.status < 400) throw loginNeeded()
    if (response.status === 403) throw new MailError('mail_access_denied', 'Exchange 拒绝了该邮箱操作，请重新登录后检查。')
    if (!response.ok) throw new MailError('mail_http_error', `邮箱服务器返回 HTTP ${response.status}。`)
    const result = await readJson(response)
    scope.signal.throwIfAborted()
    this.activeOrigin = origin
    return result
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    const scope = this.sessionScope
    try {
      const result = await operation()
      scope.signal.throwIfAborted()
      if (this.state.phase !== 'connected') this.update({ phase: 'connected', message: '已连接 Outlook。' })
      if (this.automatic) {
        this.stopAutomaticLogin()
        if (this.window && !this.window.isVisible()) this.window.destroy()
      }
      return result
    } catch (error) {
      if (scope.signal.aborted) throw new MailError('mail_session_changed', '邮箱会话已更改。')
      const failure = error instanceof MailError ? error : new MailError('mail_read_failed', '未能完成邮箱操作。')
      if (failure.code === 'not_connected') {
        if (this.automatic || this.state.phase === 'verification-required') throw failure
        if (this.state.phase === 'connected' || this.state.phase === 'error') this.cancelRequests()
        this.update({ phase: 'manual-login-required', message: failure.message, sendEnabled: false })
      }
      else if (['mail_network_error', 'mail_http_error', 'mail_invalid_response', 'mail_access_denied'].includes(failure.code)) this.update({ phase: 'error', message: failure.message })
      throw failure
    }
  }

  check(): Promise<MailState> {
    if (!this.checkPending) {
      const pending = this.list({ limit: 1 }).then(() => this.getState(), () => this.getState()).finally(() => {
        if (this.checkPending === pending) this.checkPending = null
      })
      this.checkPending = pending
    }
    return this.checkPending
  }

  list({ folder = 'inbox', offset = 0, limit = 20 }: MailListInput) {
    return this.read(() => this.outlook.list(folder, offset, limit))
  }

  private ownerFor(current: MailboxSession, scope: AbortController): Promise<string> {
    const sessionKey = createHash('sha256').update(current.origin).update('\0').update(current.cookieHeader).digest('hex')
    if (this.archiveOwner?.sessionKey === sessionKey) return this.archiveOwner.result
    const outlook = new OutlookMail((action, payload) => this.requestFrom(current, scope, action, payload))
    const result = outlook.inboxId().then(id => createHash('sha256').update(current.origin).update('\0').update(id).digest('hex'))
      .catch(error => {
        if (this.archiveOwner?.result === result) this.archiveOwner = null
        throw error
      })
    this.archiveOwner = { sessionKey, result }
    return result
  }

  private async withDisplayRead<T>(read: (outlook: OutlookMail) => Promise<T>, save: (owner: string, revision: number, data: T) => Promise<void>): Promise<T> {
    if (!this.archive.enabled) return this.read(() => read(this.outlook))
    const scope = this.sessionScope, revision = this.archive.revision
    return this.read(async () => {
      await this.reset
      const current = await this.findSession(scope.signal)
      if (!current) throw loginNeeded()
      const outlook = new OutlookMail((action, payload) => this.requestFrom(current, scope, action, payload))
      const data = await read(outlook)
      if (!scope.signal.aborted && this.archive.revision === revision) {
        try {
          const owner = await this.ownerFor(current, scope)
          if (!scope.signal.aborted && this.archive.revision === revision) {
            await save(owner, revision, data)
            this.updateArchive(null)
          }
        } catch {
          if (!scope.signal.aborted && this.archive.revision === revision) this.updateArchive(archiveUnavailable)
        }
      }
      return data
    })
  }

  private async archived<T>(read: (owner: string, revision: number) => Promise<T>): Promise<T | undefined> {
    if (!this.archive.enabled || !['connected', 'error'].includes(this.state.phase)) return
    const scope = this.sessionScope, revision = this.archive.revision
    try {
      const current = await this.findSession(scope.signal)
      if (!current) return
      const owner = await this.ownerFor(current, scope)
      scope.signal.throwIfAborted()
      const data = await read(owner, revision)
      if (!scope.signal.aborted && this.archive.revision === revision) return data
    } catch {
      if (!scope.signal.aborted && this.archive.revision === revision) this.updateArchive(archiveUnavailable)
    }
  }

  async history(folder: MailFolder): Promise<MailHistory> {
    const revision = this.archive.revision
    const messages = await this.archived((owner, version) => this.archive.list(owner, version, folder))
    return { revision, messages: messages ?? [] }
  }

  displayList(folder: MailFolder, offset: number) {
    return this.withDisplayRead(outlook => outlook.list(folder, offset, 20),
      (owner, revision, page) => this.archive.saveList(owner, revision, folder, page.messages))
  }

  async displayMessage(id: string): Promise<MailMessage> {
    const cached = await this.archived((owner, revision) => this.archive.get(owner, revision, id))
    if (cached) return cached
    return this.withDisplayRead(async outlook => {
      try { return await outlook.get(id, 'HTML') }
      catch (error) {
        if (!(error instanceof MailError) || !['mail_rejected', 'mail_invalid_response'].includes(error.code)) throw error
        return outlook.get(id)
      }
    }, (owner, revision, message) => this.archive.saveMessage(owner, revision, message))
  }

  get({ id, name, folder }: MailLookup) {
    return this.read(async () => {
      if (id) return this.outlook.get(id)
      const subject = name!.normalize('NFC').toLowerCase()
      const matches = new Set<string>()
      const deadline = Date.now() + 20_000
      for (const mailbox of folder ? [folder] : ['inbox', 'sentitems'] as const) {
        let offset: number | null = 0
        // Full-subject matching must not silently select one of several messages.
        for (let page = 0; offset !== null && page < 10 && Date.now() < deadline; page++) {
          const result = await this.outlook.list(mailbox, offset, 100)
          for (const item of result.messages) if (item.subject.trim().normalize('NFC').toLowerCase() === subject) matches.add(item.id)
          if (matches.size > 1) throw new MailError('mail_ambiguous', '有多封邮件使用该主题，请用邮件 ID 指定其中一封。')
          offset = result.nextOffset
        }
        if (offset !== null) throw new MailError('mail_search_incomplete', '邮件较多，未能完成主题查找。请使用邮件列表返回的 ID。')
      }
      const match = matches.values().next().value
      if (!match) throw new MailError('mail_not_found', '所选邮件文件夹中找不到该主题。')
      return this.outlook.get(match)
    })
  }

  async send(message: OutgoingMail): Promise<void> {
    if (!this.state.sendEnabled) throw sendingDisabled()
    if (this.sending) throw new MailError('mail_busy', '上一封邮件仍在发送，请等待结果。')
    this.sending = true
    try { await this.read(() => this.outlook.send(message)) }
    finally { this.sending = false }
  }

  private cancelRequests(): void {
    this.sessionScope.abort()
    this.sessionScope = new AbortController()
    this.checkPending = null
    this.archiveOwner = null
    this.update({ sessionRevision: this.state.sessionRevision + 1 })
  }

  async cancelAccountAutomation(): Promise<void> {
    this.cancelRequests()
    this.window?.destroy()
  }

  accountChanged(previous: { username: string | null }, current: { username: string | null }): void {
    if (previous.username !== current.username) void this.disconnect().catch(() => {})
  }

  disconnect(): Promise<void> {
    this.checkedOnEntry = true
    this.cancelRequests()
    this.window?.destroy()
    this.activeOrigin = null
    this.update({ ...initialMailState, sessionRevision: this.state.sessionRevision, archive: this.state.archive })
    const clear = this.reset.catch(() => {}).then(() => this.school.clearStorageData())
    this.reset = clear
    return clear
  }

  dispose(): void { this.cancelRequests(); this.window?.destroy() }
}
