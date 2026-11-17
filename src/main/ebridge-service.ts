import { BrowserWindow, session } from 'electron'
import { EBRIDGE_ENTRY, EBRIDGE_ORIGIN, initialEbridgeState, type EbridgeState, type EbridgeView } from '../shared/ebridge'
import type { CredentialStatus } from '../shared/credentials'
import type { AccountConsumer, AccountService } from '../services/account-service'
import { buildAutomaticLoginScript, buildLoginInspectionScript, isAuthenticationOrigin, isCredentialPage } from '../security/login-policy'
import { parseCourses, parseExams, parseTimetable, parseTimetableTerm, portalInspectionScript, selectPortalLink, type PortalDocument, type PortalLink } from '../providers/ebridge'

function schoolUrl(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password && ['ebridge.xjtlu.edu.cn', 'uim.xjtlu.edu.cn', 'timetableplus.xjtlu.edu.cn'].includes(u.hostname) } catch { return false }
}
function academicUrl(raw: string): boolean {
  try { return [EBRIDGE_ORIGIN, 'https://timetableplus.xjtlu.edu.cn'].includes(new URL(raw).origin) && schoolUrl(raw) } catch { return false }
}

export class EbridgeService implements AccountConsumer {
  private school = session.fromPartition('persist:xjtlu-ebridge')
  private window: BrowserWindow | null = null
  private state = initialEbridgeState()
  private generation = 0
  private credentialGeneration = 0
  private watch: ReturnType<typeof setInterval> | null = null
  private ticking = false
  private submitted = false
  private ssoClicked = false
  private deadline = 0
  private automaticPending: Promise<unknown> | null = null
  private pending: Promise<void> | null = null
  private routes = new Map<EbridgeView, string>()
  private explicit = false
  private disposed = false

  constructor(private publish: (state: EbridgeState) => void, private account: AccountService, private diagnostic = false) {
    this.school.setPermissionRequestHandler((_w, _p, callback) => callback(false))
    this.school.setPermissionCheckHandler(() => false)
    this.school.on('will-download', event => event.preventDefault())
  }
  getState(): EbridgeState { return structuredClone(this.state) }
  private update(next: Partial<EbridgeState>): void { if (!this.disposed) { this.state = { ...this.state, ...next }; this.publish(this.getState()) } }
  private stop(): void { if (this.watch) clearInterval(this.watch); this.watch = null }
  private fail(message: string): void { this.stop(); this.update({ phase: 'error', message }) }
  private attention(message: string): void {
    const first = this.state.phase !== 'verification-required'
    this.update({ phase: 'verification-required', message })
    if (first) { this.window?.show(); this.window?.focus() }
  }
  private valid(g: number, win: BrowserWindow): boolean { return !this.disposed && this.generation === g && this.window === win && !win.isDestroyed() }

  async connect(): Promise<void> {
    if (this.watch || this.pending) return
    if (this.state.phase === 'verification-required' && this.window) { await this.showLogin(); return }
    this.generation++; this.credentialGeneration++; this.routes.clear()
    const g = this.generation
    this.window?.destroy()
    this.submitted = false; this.ssoClicked = false; this.explicit = false
    const win = new BrowserWindow({ title: '西浦官方页面 · eBridge', width: 1180, height: 820, show: false, autoHideMenuBar: true, webPreferences: { session: this.school, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    this.window = win
    win.webContents.setWindowOpenHandler(({ url }) => { if (schoolUrl(url)) void win.loadURL(url).catch(() => {}); return { action: 'deny' } })
    win.webContents.on('will-navigate', (event, url) => { if (!schoolUrl(url)) event.preventDefault() })
    win.webContents.on('will-redirect', (event, url) => { if (!schoolUrl(url)) event.preventDefault() })
    win.on('closed', () => { if (this.window === win) { this.window = null; this.stop(); if (this.state.phase === 'authenticating' || this.state.phase === 'verification-required') this.update({ phase: 'idle', message: '学校窗口已关闭，可以重新连接。' }) } })
    this.deadline = Date.now() + 75_000
    this.update({ phase: 'authenticating', message: '正在恢复 eBridge 会话并连接学校统一认证…' })
    const tick = (): void => { void this.tick(g, win) }
    this.watch = setInterval(tick, 750)
    win.webContents.on('did-finish-load', tick)
    await win.loadURL(EBRIDGE_ENTRY).catch(() => { if (this.valid(g, win)) this.fail('eBridge 页面加载失败，请检查网络后重新连接。') })
  }

  private async tick(g: number, win: BrowserWindow): Promise<void> {
    if (!this.valid(g, win) || !this.watch || this.ticking || win.webContents.isLoadingMainFrame()) return
    this.ticking = true
    try {
      const url = win.webContents.getURL()
      if (isAuthenticationOrigin(url)) {
        const status = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildLoginInspectionScript() }])
        if (!this.valid(g, win)) return
        if (status === 'verification-required') { this.attention('eBridge 登录需要验证码或二次验证，请在学校窗口完成。'); return }
        if (status === 'login-error') { this.fail('学校登录未通过，请到首页核对账号密码后重新连接。'); return }
        if (this.state.phase === 'verification-required') { this.deadline = Date.now() + 75_000; this.update({ phase: 'authenticating', message: '正在继续学校认证…' }) }
        if (status !== 'credentials' || this.submitted || !isCredentialPage(url)) return
        const credentialGeneration = this.credentialGeneration
        const saved = await this.account.read().catch(() => null)
        if (!this.valid(g, win) || credentialGeneration !== this.credentialGeneration) return
        if (!saved) { this.stop(); this.update({ phase: 'credentials-required', message: '请先到首页“账号与登录”保存学校账号。' }); return }
        if (!isCredentialPage(win.webContents.getURL())) return
        this.submitted = true
        const task = win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildAutomaticLoginScript(saved, `ebridge:${g}:${credentialGeneration}`) }])
        this.automaticPending = task
        let result: unknown
        try { result = await task } finally { if (this.automaticPending === task) this.automaticPending = null }
        if (!this.valid(g, win) || credentialGeneration !== this.credentialGeneration) return
        if (result === 'verification-required') { this.submitted = false; this.attention('请在学校窗口完成额外验证。') }
        else if (result === 'submitted' || result === 'already-submitted') this.update({ message: '已自动提交学校登录，正在等待 eBridge…' })
        else if (result !== 'cancelled' && result !== 'wrong-page') this.attention('学校登录表单需要确认，请在官方窗口完成。')
        return
      }
      if (!url.startsWith(EBRIDGE_ORIGIN + '/')) return
      const docs = await this.inspect(win)
      if (!this.valid(g, win)) return
      if (docs.some(d => d.sso)) {
        if (!this.ssoClicked) {
          this.ssoClicked = true
          await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `if(location.origin === '${EBRIDGE_ORIGIN}') document.getElementById('OpenIDButton')?.click()` }])
        }
        return
      }
      if (docs.some(d => d.login)) return
      if (!docs.some(d => d.links.length || d.tables.length)) return
      this.stop()
      const task=this.readAll(g,win,docs)
      this.pending=task
      try{await task}finally{if(this.pending===task)this.pending=null}
    } catch { /* Navigation can destroy the old document during a successful SSO redirect. */ }
    finally {
      this.ticking = false
      if (this.valid(g, win) && this.watch && Date.now() > this.deadline && this.state.phase !== 'verification-required') this.fail('eBridge 连接等待超时，请打开学校页面查看状态或重新连接。')
    }
  }

  private async inspect(win: BrowserWindow): Promise<PortalDocument[]> {
    const frames = win.webContents.mainFrame.framesInSubtree.filter(f => academicUrl(f.url))
    const results = await Promise.allSettled(frames.map(f => f.executeJavaScript(portalInspectionScript)))
    return results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value as PortalDocument] : [])
  }

  private diagnosticDocs(label: string, docs: PortalDocument[]): void {
    if (this.diagnostic) console.log('EBRIDGE', label, JSON.stringify(docs.map(d => ({ title: d.title, links: d.links.map(l => l.text), tables: d.tables.map(t => ({headers:t.headers, rows:t.rows.length})), events:d.events.length, frames: d.frames.map(f => { try { return new URL(f).origin } catch { return 'embedded' } }) }))))
  }

  private findLink(docs: PortalDocument[], kind: 'courses' | 'timetable' | 'calendar'): PortalLink | undefined {
    const links = docs.flatMap(d => d.links).filter(l => academicUrl(l.href))
    return selectPortalLink(links,kind)
  }

  private async navigate(win: BrowserWindow, url: string): Promise<PortalDocument[]> {
    if (!academicUrl(url)) throw new Error('Unsupported academic destination')
    await win.loadURL(url)
    let docs = await this.inspect(win)
    const deadline = Date.now() + 20_000
    // The personal calendar is a cross-origin frame populated after main-frame
    // load. Wait for actual event cells (or an explicit empty response), rather
    // than recording the initial blank calendar as a successful empty result.
    while (!win.isDestroyed() && Date.now() < deadline && docs.some(d => d.frames.some(f => f.startsWith('https://timetableplus.xjtlu.edu.cn/pt/'))) && !docs.some(d => d.calendar && (d.events.length || d.empty))) {
      await new Promise(resolve => setTimeout(resolve, 350))
      if (win.isDestroyed()) break
      docs = await this.inspect(win)
    }
    return docs
  }

  private async readAll(g: number, win: BrowserWindow, initial: PortalDocument[]): Promise<void> {
    this.update({ phase: 'loading', message: '正在读取 eBridge 课程、课表与考试安排…' })
    this.diagnosticDocs('portal', initial)
    const portalUrl = win.webContents.getURL()
    let courses: ReturnType<typeof parseCourses> = null, timetable: ReturnType<typeof parseTimetable> = null
    let timetableTerm=this.state.timetableTerm
    let exams: ReturnType<typeof parseExams> = null
    const discovered:PortalDocument[]=[]
    const readExams = (docs: PortalDocument[], url: string): void => {
      const result = parseExams(docs)
      if (result !== null) {
        exams = result; this.routes.set('exams',url)
        this.update({exams:result,examsAt:new Date().toISOString(),issues:{...this.state.issues,exams:null}})
      }
    }
    readExams(initial,portalUrl)
    for (const kind of ['courses', 'timetable'] as const) {
      if (!this.valid(g, win)) return
      try {
        let docs = initial
        let link = this.findLink([...initial,...discovered], kind)
        const cached=this.routes.get(kind==='timetable'?'exams':'courses')
        if (!link && cached) link = {text:kind, href:cached}
        const overview=kind==='timetable'&&!!link
        if (!link && kind==='timetable') link=this.findLink([...initial,...discovered],'calendar')
        if (link) {
          if (kind === 'timetable') timetableTerm=parseTimetableTerm(link.text)??timetableTerm
          this.routes.set(kind, link.href)
          if (overview) this.routes.set('exams',link.href)
          docs = await this.navigate(win, link.href)
          if (!this.valid(g, win)) return
          this.diagnosticDocs(kind, docs)
          discovered.push(...docs)
          // Personal exam sittings are on the Timetables overview, before the
          // separate link to the repeating personal class calendar is followed.
          readExams(docs,win.webContents.getURL())
          // Portal sections may contain a second explicit read-only menu link.
          const child = kind === 'timetable' ? this.findLink(docs, 'calendar') : undefined
          if (child && /^my personal class timetable/i.test(child.text) && child.href !== win.webContents.getURL() && child.href !== link.href) {
            timetableTerm=parseTimetableTerm(child.text)??timetableTerm
            this.routes.set(kind, child.href)
            docs = await this.navigate(win, child.href)
            if (!this.valid(g, win)) return
            this.diagnosticDocs(`${kind}-detail`, docs)
          }
        }
        if (kind === 'courses') courses = parseCourses(docs)
        else timetable = parseTimetable(docs)
      } catch { /* Keep each academic view independent if the other fails. */ }
    }
    if (!this.valid(g, win)) return
    if (courses && timetable) {
      const titles = new Map(courses.map(c => [c.code,c.title]))
      timetable = timetable.map(s => ({...s,title:titles.get(s.code) || s.title}))
    }
    const now = new Date().toISOString()
    const ok = courses !== null || timetable !== null || exams !== null
    this.update({
      phase: ok ? 'connected' : 'error',
      message: courses !== null && timetable !== null && exams !== null ? '课程、课表与考试安排已更新。' : ok ? '已读取部分 eBridge 信息，请查看各视图的提示。' : '已进入 eBridge，尚未识别教务内容，可打开学校原页查看。',
      courses: courses ?? this.state.courses, timetable: timetable ?? this.state.timetable, exams: exams ?? this.state.exams,
      timetableTerm:timetable!==null?timetableTerm:this.state.timetableTerm,
      coursesAt: courses !== null ? now : this.state.coursesAt, timetableAt: timetable !== null ? now : this.state.timetableAt, examsAt: exams !== null ? now : this.state.examsAt,
      issues: {courses: courses === null ? '课程页面暂未读取成功。' : null, timetable: timetable === null ? 'Timetables 页面暂未读取成功。' : null, exams: exams === null ? '考试安排暂未读取成功，可打开学校原页确认是否已公布。' : null}
    })
    if (this.diagnostic) console.log('EBRIDGE_RESULT', JSON.stringify({phase:this.state.phase,courses:this.state.courses.length,timetable:this.state.timetable.length,exams:this.state.exams.length,examDatesRecognized:this.state.exams.filter(e => e.dateKey !== null).length,issues:this.state.issues}))
    // Keep the hidden source window alive so refresh reuses its established session.
    if (this.explicit && !this.routes.size && academicUrl(portalUrl)) await win.loadURL(portalUrl).catch(() => {})
  }

  refresh(): Promise<void> {
    if (this.pending) return this.pending
    if (this.watch) return Promise.resolve()
    const win = this.window, g = this.generation
    if (!win || win.isDestroyed()) return this.connect()
    const task = (async () => {
      try { const docs = await this.navigate(win, EBRIDGE_ENTRY); if (this.valid(g, win)) { if (docs.some(d => d.login || d.sso) || isAuthenticationOrigin(win.webContents.getURL())) { this.pending = null; await this.connect(); return }; await this.readAll(g, win, docs) } }
      catch { if (this.valid(g, win)) this.fail('eBridge 暂时无法读取，请重新连接。') }
    })().finally(() => { if (this.pending === task) this.pending = null })
    this.pending = task
    return task
  }
  async showLogin(): Promise<void> { if (!this.window || this.window.isDestroyed()) await this.connect(); this.explicit = true; this.window?.show(); this.window?.focus() }
  async openSource(view: EbridgeView): Promise<void> {
    if (view !== 'courses' && view !== 'timetable' && view !== 'exams') throw new Error('请选择课程、课表或考试安排。')
    if (this.watch || this.pending) { await this.showLogin(); return }
    await this.showLogin()
    const url = this.routes.get(view)
    if (url && this.window) await this.window.loadURL(url)
  }
  async cancelAccountAutomation(): Promise<void> {
    this.credentialGeneration++
    const c = this.window?.webContents
    if (c && !c.isDestroyed() && isAuthenticationOrigin(c.getURL())) await c.executeJavaScriptInIsolatedWorld(1001, [{ code: 'globalThis.__xjtluLoginAttempt = null' }]).catch(() => {})
    await this.automaticPending?.catch(() => {})
  }
  accountChanged(previous: CredentialStatus, current: CredentialStatus): void {
    if (previous.username && current.username && previous.username !== current.username) void this.disconnect().catch(() => this.fail('切换学校账号后，请重新连接 eBridge。'))
    else if (current.saved && this.state.phase === 'credentials-required') void this.connect().catch(() => this.fail('请重新连接 eBridge。'))
  }
  async disconnect(): Promise<void> {
    this.generation++; this.credentialGeneration++; this.stop(); this.routes.clear(); this.pending = null
    this.window?.destroy(); this.window = null
    await this.school.clearStorageData(); await this.school.clearCache()
    this.state = initialEbridgeState(); this.update({message:'eBridge 已断开；首页保存的学校账号保留。'})
  }
  dispose(): void { this.disposed = true; this.generation++; this.credentialGeneration++; this.stop(); this.routes.clear(); this.window?.destroy(); this.window = null }
}
