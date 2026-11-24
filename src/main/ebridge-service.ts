import { BrowserWindow, session } from 'electron'
import { schoolLoginAction } from '../shared/ams'
import { EBRIDGE_ENTRY, EBRIDGE_ORIGIN, initialEbridgeState, type EbridgeState, type EbridgeView, type EbridgeGradeView, type EbridgeGradeModule, type EbridgeCacheView, type EbridgeOverview } from '../shared/ebridge'
import type { CredentialStatus } from '../shared/credentials'
import type { AccountConsumer, AccountService } from '../services/account-service'
import type { EbridgeCache } from '../infrastructure/ebridge-cache'
import { buildAutomaticLoginScript, buildLoginInspectionScript, buildSwitchRememberedAccountScript, isAuthenticationOrigin, isCredentialPage, SCHOOL_VERIFICATION_MESSAGE } from '../security/login-policy'
import { isAbortedNavigation, schoolLoginFailure, SCHOOL_MANUAL_LOGIN_MESSAGE, showSchoolLoginWindow } from './school-login-window'
import { parseCourses, parseExams, parseTimetable, parseTimetableTerm, portalInspectionScript, selectPortalLink, type PortalDocument, type PortalLink } from '../providers/ebridge'
import { ebridgeGradeInspection, parseEbridgeGrades, selectGradeLinks } from '../providers/ebridge-grades'

class EbridgeGradeAuthError extends Error {}
const CACHE_WRITE_FAILED = '更新本地缓存失败，已保留原有文件。'

function schoolUrl(raw: string): boolean {
  try { const u = new URL(raw); return isAuthenticationOrigin(raw) || (!u.username && !u.password && [EBRIDGE_ORIGIN, 'https://timetableplus.xjtlu.edu.cn'].includes(u.origin)) } catch { return false }
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
  private switchRequested = false
  private manual = false
  private ssoClicked = false
  private deadline = 0
  private automaticPending: Promise<unknown> | null = null
  private pending: Promise<void> | null = null
  private gradesTask: Promise<void> | null = null
  private gradeRoutes = new Map<EbridgeGradeView, string>()
  private routes = new Map<EbridgeView, string>()
  private explicit = false
  private disposed = false
  private cacheOwner: string | null = null
  private cacheRevision = 0
  private cacheQueue: Promise<unknown> = Promise.resolve()
  private disconnectTask: Promise<void> | null = null

  constructor(private publish: (state: EbridgeState) => void, private account: AccountService, private diagnostic = false, private cache?: EbridgeCache) {
    this.school.setPermissionRequestHandler((_w, _p, callback) => callback(false))
    this.school.setPermissionCheckHandler(() => false)
    this.school.on('will-download', event => event.preventDefault())
  }
  getState(): EbridgeState { return structuredClone(this.state) }
  private update(next: Partial<EbridgeState>): void { if (!this.disposed) { this.state = { ...this.state, ...next }; this.publish(this.getState()) } }
  private stop(): void { if (this.watch) clearInterval(this.watch); this.watch = null }
  private fail(message: string): void { this.stop(); this.update({ phase: 'error', message }) }
  private loginFailed(message: string, keepWatching = this.manual): void {
    if (!keepWatching) this.stop()
    const text = schoolLoginFailure(message, keepWatching)
    if (this.state.phase !== 'manual-login-required' || this.state.message !== text) this.update({ phase: 'manual-login-required', message: text })
  }
  private attention(message: string): void {
    const first = this.state.phase !== 'verification-required'
    this.manual = true
    if (first || this.state.message !== message) this.update({ phase: 'verification-required', message })
    if (first) showSchoolLoginWindow(this.window)
  }
  private valid(g: number, win: BrowserWindow): boolean { return !this.disposed && this.generation === g && this.window === win && !win.isDestroyed() }

  async restoreLocalCache(): Promise<void> {
    try {
      const cached = await this.cache?.read()
      if (!cached) return
      const { username } = await this.account.status()
      if (!username || username !== cached.owner) return
      this.cacheOwner = username
      const restored = (['courses', 'timetable', 'exams'] as const).filter(view => cached.data[`${view}At`] !== null)
      this.update({ ...cached.data, localCache: { enabled: true, restored, issue: null } })
    } catch {
      this.update({ localCache: { ...this.state.localCache, issue: '无法读取本地缓存，可以重新开启本地缓存。' } })
    }
  }

  private queueCache(operation: () => Promise<void>): Promise<void> {
    const task = this.cacheQueue.then(operation)
    this.cacheQueue = task.catch(() => {})
    return task
  }

  private dropRestoredCache(issue: string | null = null): void {
    const { restored } = this.state.localCache
    this.cacheOwner = null
    this.update({
      ...(restored.includes('courses') ? { courses: [], coursesAt: null } : {}),
      ...(restored.includes('timetable') ? { timetable: [], timetableAt: null, timetableTerm: null } : {}),
      ...(restored.includes('exams') ? { exams: [], examsAt: null } : {}),
      localCache: { enabled: false, restored: [], issue }
    })
  }

  setLocalCache(enabled: boolean): Promise<void> {
    const revision = this.cacheRevision
    return this.queueCache(async () => {
      if (this.disposed || this.disconnectTask || revision !== this.cacheRevision || !this.cache) return
      try {
        if (!enabled) {
          await this.cache.clear()
          if (revision === this.cacheRevision) this.dropRestoredCache()
          return
        }
        const { username } = await this.account.status()
        if (revision !== this.cacheRevision) return
        if (!username) {
          this.update({ localCache: { ...this.state.localCache, issue: '请先在首页保存学校账号，以便区分不同账号的缓存。' } })
          return
        }
        await this.cache.write(username, this.state)
        if (revision !== this.cacheRevision) return
        this.cacheOwner = username
        this.update({ localCache: { ...this.state.localCache, enabled: true, issue: null } })
      } catch {
        if (revision === this.cacheRevision) this.update({ localCache: { ...this.state.localCache, issue: enabled ? '保存本地缓存失败，请重试。' : '清除本地缓存失败，请重试。' } })
      }
    })
  }

  private saveLocalCache(): Promise<void> {
    const revision = this.cacheRevision
    return this.queueCache(async () => {
      if (!this.cache || !this.cacheOwner || revision !== this.cacheRevision || this.disposed) return
      try {
        await this.cache.write(this.cacheOwner, this.state)
      } catch {
        if (revision === this.cacheRevision && !this.state.localCache.issue) this.update({ localCache: { ...this.state.localCache, issue: CACHE_WRITE_FAILED } })
        return
      }
      if (revision === this.cacheRevision && this.state.localCache.issue === CACHE_WRITE_FAILED) {
        this.update({ localCache: { ...this.state.localCache, issue: null } })
      }
    })
  }

  private freshlyRead(...views: EbridgeCacheView[]): EbridgeState['localCache'] {
    const cache = this.state.localCache
    return { ...cache, restored: cache.restored.filter(view => !views.includes(view)) }
  }

  async connect(): Promise<void> {
    if (this.disconnectTask) await this.disconnectTask
    if (this.state.phase === 'manual-login-required') return
    if (this.state.phase === 'verification-required' && this.window) { await this.showLogin(); return }
    if (this.watch || this.pending) return
    const win = this.window
    if (win && !win.isDestroyed() && isAuthenticationOrigin(win.webContents.getURL())) {
      this.resumeAuthentication(this.generation, win)
      return
    }
    this.startLogin(false)
  }

  private watchAuthentication(g: number, win: BrowserWindow, manual: boolean): void {
    this.deadline = Date.now() + 75_000
    this.watch = setInterval(() => void this.tick(g, win), 750)
    this.update(manual ? { phase: 'manual-login-required', message: SCHOOL_MANUAL_LOGIN_MESSAGE }
      : { phase: 'authenticating', message: '正在恢复 eBridge 会话并连接学校统一认证…' })
  }

  private resumeAuthentication(g: number, win: BrowserWindow): void {
    if (!this.valid(g, win) || this.watch) return
    this.credentialGeneration++
    this.submitted = false; this.switchRequested = false; this.ssoClicked = false; this.manual = false
    this.watchAuthentication(g, win, false)
    void this.tick(g, win)
  }

  private startLogin(manual: boolean): void {
    if (this.disposed) return
    this.stop()
    this.generation++; this.credentialGeneration++; this.routes.clear(); this.gradeRoutes.clear()
    const g = this.generation
    const previous = this.window
    this.window = null
    previous?.destroy()
    this.submitted = false; this.switchRequested = false; this.ssoClicked = false; this.manual = manual; this.explicit = manual
    const win = new BrowserWindow({ title: '西浦官方页面 · eBridge', width: 1180, height: 820, show: manual, autoHideMenuBar: true, webPreferences: { session: this.school, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    this.window = win
    win.webContents.setWindowOpenHandler(({ url }) => { if (schoolUrl(url)) void win.loadURL(url).catch(() => {}); return { action: 'deny' } })
    win.webContents.on('will-navigate', (event, url) => { if (!schoolUrl(url)) event.preventDefault() })
    win.webContents.on('will-redirect', (event, url) => { if (!schoolUrl(url)) event.preventDefault() })
    win.on('closed', () => {
      if (this.window !== win) return
      this.window = null
      this.stop()
      if (this.state.phase === 'manual-login-required') this.loginFailed('学校窗口已关闭。', false)
      else this.update({ phase: 'idle', message: '学校窗口已关闭，可以重新连接。', grades: { ...this.state.grades, loading: false } })
    })
    this.watchAuthentication(g, win, manual)
    win.webContents.on('did-finish-load', () => {
      if (!this.valid(g, win)) return
      if (!this.watch && !this.pending && this.state.phase === 'connected' && isAuthenticationOrigin(win.webContents.getURL())) {
        this.resumeAuthentication(g, win)
      } else void this.tick(g, win)
    })
    void win.loadURL(EBRIDGE_ENTRY).catch(error => {
      if (!isAbortedNavigation(error) && this.valid(g, win) && this.watch && this.state.phase !== 'verification-required') this.loginFailed('eBridge 页面加载失败，请检查网络。', false)
    })
  }

  private async tick(g: number, win: BrowserWindow): Promise<void> {
    if (!this.valid(g, win) || !this.watch || this.ticking) return
    this.ticking = true
    try {
      if (win.webContents.isLoadingMainFrame()) return
      const url = win.webContents.getURL()
      if (isAuthenticationOrigin(url)) {
        const status = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildLoginInspectionScript(true) }])
        if (!this.valid(g, win)) return
        if (status === 'verification-required') { this.attention(SCHOOL_VERIFICATION_MESSAGE); return }
        if (status === 'login-error') { this.loginFailed('学校登录未通过。'); return }
        if (this.manual || this.submitted || !isCredentialPage(url)) return
        if (status !== 'credentials' && status !== 'remembered-account') return
        if (status === 'remembered-account' && this.switchRequested) return
        const credentialGeneration = this.credentialGeneration
        const saved = await this.account.read().catch(() => null)
        if (!this.valid(g, win) || credentialGeneration !== this.credentialGeneration) return
        if (!saved) { this.stop(); this.update({ phase: 'credentials-required', message: '请先到“账号与设置”保存学校账号。' }); return }
        if (!isCredentialPage(win.webContents.getURL())) return
        if (status === 'remembered-account') {
          this.switchRequested = true
          const switched = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildSwitchRememberedAccountScript() }])
          if (!this.valid(g, win) || credentialGeneration !== this.credentialGeneration) return
          if (switched === 'verification-required') this.attention(SCHOOL_VERIFICATION_MESSAGE)
          else if (switched === 'switched-account') this.update({ message: '正在切换到可输入账号的学校登录页…' })
          else if (switched !== 'wrong-page' && switched !== 'waiting') this.loginFailed('学校认证页未能自动切换账号。')
          return
        }
        this.submitted = true
        const task = win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildAutomaticLoginScript(saved, `ebridge:${g}:${credentialGeneration}`) }])
        this.automaticPending = task
        let result: unknown
        try { result = await task } finally { if (this.automaticPending === task) this.automaticPending = null }
        if (!this.valid(g, win) || credentialGeneration !== this.credentialGeneration) return
        if (result === 'verification-required') this.attention(SCHOOL_VERIFICATION_MESSAGE)
        else if (result === 'submitted' || result === 'already-submitted') this.update({ message: '已自动提交学校登录，正在等待 eBridge…' })
        else if (result !== 'cancelled' && result !== 'wrong-page') this.loginFailed('学校登录表单未能自动提交。')
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
      if (this.valid(g, win) && this.watch && !this.manual && Date.now() > this.deadline) {
        this.loginFailed('eBridge 认证等待超时。')
      }
    }
  }

  private async inspect(win: BrowserWindow): Promise<PortalDocument[]> {
    const frames = win.webContents.mainFrame.framesInSubtree.filter(f => academicUrl(f.url))
    const results = await Promise.allSettled(frames.map(f => f.executeJavaScript(portalInspectionScript)))
    const docs = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value as PortalDocument] : [])
    if (this.window === win && !win.isDestroyed() && !this.disposed) {
      const overview = selectGradeLinks(docs.flatMap(doc => doc.links).filter(link => academicUrl(link.href))).overview
      if (overview) this.routes.set('grades', overview.href)
    }
    return docs
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

  private async readAll(g: number, win: BrowserWindow, initial: PortalDocument[], onExpired?: () => void): Promise<void> {
    this.update({ phase: 'loading', message: '正在读取 eBridge 课程、课表与考试安排…' })
    this.diagnosticDocs('portal', initial)
    const portalUrl = win.webContents.getURL()
    let courses: ReturnType<typeof parseCourses> = null, timetable: ReturnType<typeof parseTimetable> = null
    let timetableTerm: EbridgeOverview['timetableTerm'] = this.state.localCache.restored.includes('timetable') ? null : this.state.timetableTerm
    let exams: ReturnType<typeof parseExams> = null
    const discovered:PortalDocument[]=[]
    const readExams = (docs: PortalDocument[], url: string): void => {
      const result = parseExams(docs)
      if (result !== null) {
        exams = result; this.routes.set('exams',url)
        this.update({exams:result,examsAt:new Date().toISOString(),issues:{...this.state.issues,exams:null},localCache:this.freshlyRead('exams')})
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
          if (onExpired && (isAuthenticationOrigin(win.webContents.getURL()) || docs.some(doc => doc.login || doc.sso))) { onExpired(); return }
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
            if (onExpired && (isAuthenticationOrigin(win.webContents.getURL()) || docs.some(doc => doc.login || doc.sso))) { onExpired(); return }
            this.diagnosticDocs(`${kind}-detail`, docs)
          }
        }
        if (kind === 'courses') courses = parseCourses(docs)
        else timetable = parseTimetable(docs)
      } catch { /* Keep each academic view independent if the other fails. */ }
    }
    if (!this.valid(g, win)) return
    if (onExpired && isAuthenticationOrigin(win.webContents.getURL())) { onExpired(); return }
    if (courses && timetable) {
      const titles = new Map(courses.map(c => [c.code,c.title]))
      timetable = timetable.map(s => ({...s,title:titles.get(s.code) || s.title}))
    }
    const now = new Date().toISOString()
    const ok = courses !== null || timetable !== null || exams !== null
    const refreshed: EbridgeCacheView[] = []
    if (courses !== null) refreshed.push('courses')
    if (timetable !== null) refreshed.push('timetable')
    this.update({
      phase: ok ? 'connected' : 'error',
      message: courses !== null && timetable !== null && exams !== null ? '课程、课表与考试安排已更新。' : ok ? '已读取部分 eBridge 信息，请查看各视图的提示。' : '已进入 eBridge，尚未识别教务内容，可打开学校原页查看。',
      courses: courses ?? this.state.courses, timetable: timetable ?? this.state.timetable, exams: exams ?? this.state.exams,
      timetableTerm:timetable!==null?timetableTerm:this.state.timetableTerm,
      coursesAt: courses !== null ? now : this.state.coursesAt, timetableAt: timetable !== null ? now : this.state.timetableAt, examsAt: exams !== null ? now : this.state.examsAt,
      localCache: this.freshlyRead(...refreshed),
      issues: {...this.state.issues, courses: courses === null ? '课程页面暂未读取成功。' : null, timetable: timetable === null ? 'Timetables 页面暂未读取成功。' : null, exams: exams === null ? '考试安排暂未读取成功，可打开学校原页确认是否已公布。' : null}
    })
    if (ok) await this.saveLocalCache()
    if (this.diagnostic) console.log('EBRIDGE_RESULT', JSON.stringify({phase:this.state.phase,courses:this.state.courses.length,timetable:this.state.timetable.length,exams:this.state.exams.length,examDatesRecognized:this.state.exams.filter(e => e.dateKey !== null).length,issues:this.state.issues}))
    // Keep the hidden source window alive so refresh reuses its established session.
    if (this.valid(g, win) && this.explicit && !this.routes.size && academicUrl(portalUrl)) await win.loadURL(portalUrl).catch(() => {})
  }

  refresh(recover = true): Promise<void> {
    if (this.disconnectTask) return this.disconnectTask.then(() => { if (recover) return this.refresh() })
    if (this.state.phase === 'manual-login-required') return Promise.resolve()
    if (this.state.phase === 'verification-required') return this.showLogin()
    if (this.pending) return this.pending
    if (this.watch) return Promise.resolve()
    const win = this.window, g = this.generation
    if (!win || win.isDestroyed()) return recover ? this.connect() : Promise.resolve()
    const onExpired = (): void => {
      if (recover) this.resumeAuthentication(g, win)
      else this.update({ phase: 'expired', message: 'eBridge 会话已过期，请重新连接。' })
    }
    if (isAuthenticationOrigin(win.webContents.getURL())) {
      onExpired()
      return Promise.resolve()
    }
    const task = (async () => {
      try {
        const docs = await this.navigate(win, EBRIDGE_ENTRY)
        if (!this.valid(g, win)) return
        if (docs.some(d => d.login || d.sso) || isAuthenticationOrigin(win.webContents.getURL())) onExpired()
        else await this.readAll(g, win, docs, onExpired)
      } catch {
        if (!this.valid(g, win)) return
        if (isAuthenticationOrigin(win.webContents.getURL())) onExpired()
        else this.fail('eBridge 暂时无法读取，请重新连接。')
      }
    })().finally(() => { if (this.pending === task) this.pending = null })
    this.pending = task
    return task
  }

  loadGrades(): Promise<void> {
    if (this.gradesTask) return this.gradesTask
    const previous = this.pending, win = this.window, g = this.generation
    if (!win || win.isDestroyed() || this.state.phase !== 'connected') return Promise.reject(new Error('请先连接 eBridge，再查询成绩。'))
    const task = Promise.resolve().then(async () => {
      if (previous) await previous
      if (!this.valid(g, win)) return
      this.update({ grades: { ...this.state.grades, loading: true } })
      const checkLogin = (docs: PortalDocument[]): void => { if (isAuthenticationOrigin(win.webContents.getURL()) || docs.some(doc => doc.login || doc.sso)) throw new EbridgeGradeAuthError() }
      const menu = async (url: string): Promise<PortalDocument[]> => {
        let docs = await this.navigate(win, url)
        const until = Date.now() + 12_000
        while (this.valid(g, win)) {
          checkLogin(docs)
          const links = selectGradeLinks(docs.flatMap(doc => doc.links).filter(link => academicUrl(link.href)))
          if (links.records || links.components.length || Date.now() >= until) return docs
          await new Promise(resolve => setTimeout(resolve, 250))
          if (!this.valid(g, win)) return []
          docs = await this.inspect(win)
        }
        return []
      }
      try {
        // Re-entering the bare eBridge root can replace its signed portal
        // session. Use the Academic Records link observed in this session.
        let docs = await this.inspect(win)
        if (!this.valid(g, win)) return
        checkLogin(docs)
        const cachedOverview = this.routes.get('grades')
        const overview = selectGradeLinks(docs.flatMap(doc => doc.links).filter(link => academicUrl(link.href))).overview ?? (cachedOverview ? { text: 'Academic Records', href: cachedOverview } : undefined)
        if (overview) {
          this.routes.set('grades', overview.href)
          docs = await menu(overview.href)
          if (!this.valid(g, win)) return
          checkLogin(docs)
        }
        const links = selectGradeLinks(docs.flatMap(doc => doc.links).filter(link => academicUrl(link.href)))
        for (const kind of ['components', 'records'] as const) {
          const targets = kind === 'components' ? links.components : links.records ? [links.records] : []
          try {
            if (!targets.length) throw new Error('Grade entry unavailable')
            const modules: EbridgeGradeModule[] = []
            this.gradeRoutes.set(kind, targets[0].href)
            for (const target of targets) {
              const page = await this.navigate(win, target.href)
              if (!this.valid(g, win)) return
              checkLogin(page)
              const year = target.text.match(/\b20\d{2}\/\d{2}\b/)?.[0] ?? ''
              let raw: { recognized?: boolean; auth?: boolean } | null = null
              const until = Date.now() + 12_000
              do {
                raw = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: ebridgeGradeInspection(kind, year) }])
                if (!this.valid(g, win)) return
                if (raw?.auth) throw new EbridgeGradeAuthError()
                if (raw?.recognized) break
                await new Promise(resolve => setTimeout(resolve, 250))
              } while (Date.now() < until)
              if (!this.valid(g, win)) return
              if (raw?.auth) throw new EbridgeGradeAuthError()
              const result = parseEbridgeGrades(raw, kind)
              if (result === null) throw new Error('Grade page unrecognized')
              modules.push(...result)
            }
            const field = kind === 'components' ? 'componentsAt' : 'recordsAt'
            this.update({ grades: { ...this.state.grades, [kind]: [...new Map(modules.map(module => [module.id, module])).values()], [field]: new Date().toISOString(), issues: { ...this.state.grades.issues, [kind]: null } } })
          } catch (error) {
            if (!this.valid(g, win)) return
            this.update({ grades: { ...this.state.grades, issues: { ...this.state.grades.issues, [kind]: kind === 'components' ? '分项成绩暂未读取成功，请重试或打开学校原页。' : '完整成绩记录暂未读取成功，请重试或打开学校原页。' } } })
            if (error instanceof EbridgeGradeAuthError) throw error
          }
        }
      } catch (error) {
        if (!this.valid(g, win)) return
        const message = error instanceof EbridgeGradeAuthError ? 'eBridge 登录已失效，请重新连接后查询成绩。' : '成绩入口暂时无法读取，请重试或打开学校原页。'
        this.update({ ...(error instanceof EbridgeGradeAuthError ? { phase: 'expired' as const, message } : {}), grades: { ...this.state.grades, issues: { components: this.state.grades.issues.components ?? message, records: this.state.grades.issues.records ?? message } } })
      } finally {
        if (this.valid(g, win)) this.update({ grades: { ...this.state.grades, loading: false }, issues: { ...this.state.issues, grades: this.state.grades.issues.components || this.state.grades.issues.records } })
      }
    }).finally(() => { if (this.pending === task) this.pending = null; if (this.gradesTask === task) this.gradesTask = null })
    this.gradesTask = task; this.pending = task
    return task
  }

  async openGradeSource(kind: EbridgeGradeView): Promise<void> {
    if (kind !== 'components' && kind !== 'records') throw new Error('请选择分项成绩或完整成绩记录。')
    if (this.pending) await this.pending
    if (!this.gradeRoutes.has(kind) && this.state.phase === 'connected') await this.loadGrades()
    await this.showLogin()
    const win = this.window, g = this.generation, url = this.gradeRoutes.get(kind) ?? this.routes.get('grades')
    if (url && academicUrl(url) && win && this.valid(g, win)) await win.loadURL(url)
  }

  async showLogin(): Promise<void> {
    if (this.disconnectTask) await this.disconnectTask
    if (this.state.phase === 'manual-login-required') {
      const win = this.window
      if (!win || win.isDestroyed() || (!this.watch && (win.webContents.isLoadingMainFrame() || !isAuthenticationOrigin(win.webContents.getURL())))) {
        this.startLogin(true)
        return
      }
      const g = this.generation
      this.manual = true
      this.watch ??= setInterval(() => void this.tick(g, win), 750)
      this.update({ message: SCHOOL_MANUAL_LOGIN_MESSAGE })
    } else if (!this.window || this.window.isDestroyed()) await this.connect()
    this.explicit = true
    showSchoolLoginWindow(this.window)
  }
  async openSource(view: EbridgeView): Promise<void> {
    if (view !== 'courses' && view !== 'timetable' && view !== 'exams' && view !== 'grades') throw new Error('请选择课程、课表、考试安排或成绩查询。')
    if (schoolLoginAction(this.state.phase) || this.watch || this.pending) { await this.showLogin(); return }
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
    const changed = previous.username !== current.username
    const haveData = this.state.coursesAt || this.state.timetableAt || this.state.examsAt || this.state.grades.componentsAt || this.state.grades.recordsAt
    const haveSession = this.window && this.state.phase !== 'credentials-required'
    if (changed && current.username && (previous.username || haveData || haveSession)) void this.disconnect().catch(() => this.fail('切换学校账号后，请重新连接 eBridge。'))
    else if (changed && !current.username) {
      this.cacheRevision++
      const revision = this.cacheRevision
      this.dropRestoredCache()
      void this.queueCache(async () => { await this.cache?.clear() }).catch(() => {
        if (revision === this.cacheRevision) this.dropRestoredCache('清除本地缓存失败，请重试。')
      })
    }
    else if (current.saved && this.state.phase === 'credentials-required') void this.connect().catch(() => this.fail('请重新连接 eBridge。'))
  }
  disconnect(): Promise<void> {
    if (this.disconnectTask) return this.disconnectTask
    this.generation++; this.credentialGeneration++; this.stop(); this.routes.clear(); this.gradeRoutes.clear(); this.pending = null; this.gradesTask = null
    this.cacheRevision++; this.cacheOwner = null
    const win = this.window
    this.window = null
    win?.destroy()
    this.state = initialEbridgeState(); this.update({message:'eBridge 已断开；首页保存的学校账号保留。'})
    const clearCache = this.queueCache(async () => { await this.cache?.clear() }).catch(() => this.dropRestoredCache('清除本地缓存失败，请重试。'))
    const task = Promise.all([clearCache, this.school.clearStorageData().then(() => this.school.clearCache())])
      .then(() => {}).finally(() => { if (this.disconnectTask === task) this.disconnectTask = null })
    this.disconnectTask = task
    return task
  }
  dispose(): void { this.disposed = true; this.generation++; this.credentialGeneration++; this.stop(); this.routes.clear(); this.gradeRoutes.clear(); this.window?.destroy(); this.window = null }
}
