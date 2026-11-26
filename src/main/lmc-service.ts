import { app, BrowserWindow, session, shell, type DownloadItem, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { z } from 'zod'
import type { AccountConsumer, AccountService } from '../services/account-service'
import type { CredentialStatus } from '../shared/credentials'
import { initialLmcState, LMC_ORIGIN, LMC_SUBMISSION_TYPES, type LmcAssignmentDates, type LmcDownload, type LmcFile, type LmcModule, type LmcNotification, type LmcNotificationAttachment, type LmcNotificationRange, type LmcReadSnapshot, type LmcSource, type LmcState } from '../shared/lmc'
import { cleanLmcAssignmentDates, lmcAcademicUrl, lmcAjaxScript, lmcAssignmentCardsScript, lmcAssignmentPageInspection, lmcCourseInspection, lmcDownloadAllowed, lmcFileInspection, lmcFileUrl, lmcForumAttachmentsScript, lmcForumTarget, lmcId, lmcSchoolUrl, lmcText, parseLmcCourses, parseLmcForumAttachments, parseLmcNotifications, safeLmcFilename, type LmcFilesDocument, type LmcPageDocument } from '../providers/lmc'
import { lmcActivityResultScript, lmcAssessmentResult, lmcCourseGradesScript, lmcGradeReport } from '../providers/lmc-grades'
import { LmcSavePathError, prepareLmcSavePath, type LmcSaveTarget } from '../infrastructure/lmc-save-path'
import { buildAutomaticLoginScript, buildLoginInspectionScript, isAuthenticationOrigin, isCredentialPage, SCHOOL_VERIFICATION_MESSAGE } from '../security/login-policy'
import { isAbortedNavigation, schoolLoginFailure, SCHOOL_MANUAL_LOGIN_MESSAGE, showSchoolLoginWindow } from './school-login-window'

interface Route { url: string; courseId: string; kind: 'resource' | 'folder' | 'activity' | 'file'; name: string }
interface NotificationRoute { url: string; files?: Map<string, { url: string; name: string }> }
interface DownloadTicket { id: string; generation: number; win: BrowserWindow; expected: Set<string>; destination?: LmcSaveTarget; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
class LmcAuthError extends Error {}
class LmcCancelledDownload extends Error {}

export class LmcService implements AccountConsumer {
  private school = session.fromPartition('persist:xjtlu-core')
  private win: BrowserWindow | null = null
  private state = initialLmcState()
  private generation = 0
  private credentialGeneration = 0
  private disposed = false
  private watch: ReturnType<typeof setInterval> | null = null
  private ticking = false
  private submitted = false
  private manual = false
  private ssoClicked = false
  private deadline = 0
  private automatic: Promise<unknown> | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private pending = new Map<string, Promise<void>>()
  private routes = new Map<string, Route>()
  private notificationRoutes = new Map<string, NotificationRoute>()
  private notificationOffset = 0
  private notificationReads = new Map<number, Promise<LmcNotificationRange>>()
  private startingDownload: object | null = null
  private ticket: DownloadTicket | null = null
  private items = new Map<string, DownloadItem>()
  private saved = new Map<string, string>()
  private publish: (state: LmcState) => void
  private account: AccountService

  constructor(publish: (state: LmcState) => void, account: AccountService) {
    this.publish = publish; this.account = account
    this.school.setPermissionRequestHandler((_w, _p, callback) => callback(false))
    this.school.setPermissionCheckHandler(() => false)
    this.school.on('will-download', this.onDownload)
  }
  getState(): LmcState { return structuredClone(this.state) }
  private update(next: Partial<LmcState>): void { if (!this.disposed) { this.state = { ...this.state, ...next }; this.publish(this.getState()) } }
  private valid(g: number, win: BrowserWindow): boolean { return !this.disposed && this.generation === g && this.win === win && !win.isDestroyed() }
  private stopWatch(): void { if (this.watch) clearInterval(this.watch); this.watch = null }
  private attention(message: string): void {
    const first = this.state.phase !== 'verification-required'
    this.manual = true
    if (first || this.state.message !== message) this.update({ phase: 'verification-required', message })
    if (first) showSchoolLoginWindow(this.win)
  }
  private fail(message: string): void { this.stopWatch(); this.update({ phase: 'error', message }) }
  private loginFailed(message: string, keepWatching = this.manual): void {
    if (!keepWatching) this.stopWatch()
    const text = schoolLoginFailure(message, keepWatching)
    if (this.state.phase !== 'manual-login-required' || this.state.message !== text) this.update({ phase: 'manual-login-required', message: text })
  }
  private requireWindow(): BrowserWindow { if (!this.win || this.win.isDestroyed() || this.state.phase !== 'connected') throw new Error('请先连接 Learning Mall Core。'); return this.win }
  private queued(key: string, operation: (g: number, win: BrowserWindow) => Promise<void>): Promise<void> {
    const existing = this.pending.get(key)
    if (existing) return existing
    const g = this.generation, win = this.win
    const task = this.tail.catch(() => {}).then(async () => {
      if (!win || !this.valid(g, win)) return
      try { await operation(g, win) }
      catch (error) { if (error instanceof LmcCancelledDownload) return; if (this.valid(g, win) && error instanceof LmcAuthError) this.update({ phase: 'expired', message: 'LMC 登录已失效，请重新连接学校账号。' }); throw new Error(error instanceof LmcAuthError ? '请重新连接 Learning Mall Core。' : 'LMC 读取未能完成，请重试或打开学校原页。') }
    }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key) })
    this.pending.set(key, task); this.tail = task
    return task
  }
  async connect(): Promise<void> {
    if (this.state.phase === 'manual-login-required') return
    if (this.state.phase === 'verification-required' && this.win && !this.win.isDestroyed()) { await this.showLogin(); return }
    if (this.watch || this.pending.size) return
    if (this.state.phase === 'connected' && this.win && !this.win.isDestroyed()) return this.refresh()
    this.startLogin(false)
  }

  private startLogin(manual: boolean): void {
    if (this.disposed) return
    this.stopWatch(); this.generation++; this.credentialGeneration++
    const previous = this.win
    this.win = null
    previous?.destroy()
    this.submitted = false; this.ssoClicked = false; this.manual = manual
    const g = this.generation
    const win = new BrowserWindow({ title: 'Learning Mall Core · 学校原页', width: 1180, height: 840, show: manual, autoHideMenuBar: true, webPreferences: { session: this.school, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    this.win = win
    win.webContents.setWindowOpenHandler(({ url }) => { if (lmcSchoolUrl(url)) void win.loadURL(url).catch(() => {}); return { action: 'deny' } })
    win.webContents.on('will-navigate', (event, url) => { if (!lmcSchoolUrl(url)) event.preventDefault() })
    win.webContents.on('will-redirect', (event, url) => { if (!lmcSchoolUrl(url)) event.preventDefault() })
    win.on('closed', () => {
      if (this.win !== win) return
      this.win = null
      this.stopWatch()
      this.cancelTicket()
      this.update({ courseGrades: {}, activityResults: {} })
      if (this.state.phase === 'manual-login-required') this.loginFailed('学校窗口已关闭。', false)
      else this.update({ phase: 'idle', message: 'LMC 学校窗口已关闭，可重新连接。' })
    })
    this.deadline = Date.now() + 75_000
    this.update(manual ? { phase: 'manual-login-required', message: SCHOOL_MANUAL_LOGIN_MESSAGE }
      : { phase: 'authenticating', message: '正在连接 Learning Mall Core 和西浦统一认证…' })
    const tick = (): void => { void this.tick(g, win) }
    this.watch = setInterval(tick, 750); win.webContents.on('did-finish-load', tick)
    void win.loadURL(`${LMC_ORIGIN}/`).catch(error => {
      if (!isAbortedNavigation(error) && this.valid(g, win) && this.watch && this.state.phase !== 'verification-required') this.loginFailed('LMC 页面加载失败，请检查网络。', false)
    })
  }
  private async tick(g: number, win: BrowserWindow): Promise<void> {
    if (!this.valid(g, win) || !this.watch || this.ticking) return
    this.ticking = true
    try {
      if (win.webContents.isLoadingMainFrame()) return
      const url = win.webContents.getURL()
      if (isAuthenticationOrigin(url)) {
        const state = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildLoginInspectionScript() }])
        if (!this.valid(g, win)) return
        if (state === 'verification-required') { this.attention(SCHOOL_VERIFICATION_MESSAGE); return }
        if (state === 'login-error') { this.loginFailed('学校登录未通过。'); return }
        if (this.manual || state !== 'credentials' || this.submitted || !isCredentialPage(url)) return
        const cg = this.credentialGeneration
        const saved = await this.account.read().catch(() => null)
        if (!this.valid(g, win) || cg !== this.credentialGeneration || !isCredentialPage(win.webContents.getURL())) return
        if (!saved) { this.stopWatch(); this.update({ phase: 'credentials-required', message: '请先在“账号与设置”保存学校账号。' }); return }
        this.submitted = true
        const task = win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildAutomaticLoginScript(saved, `lmc:${g}:${cg}`) }])
        this.automatic = task
        let result: unknown
        try { result = await task } finally { if (this.automatic === task) this.automatic = null }
        if (!this.valid(g, win) || cg !== this.credentialGeneration) return
        if (result === 'verification-required') this.attention(SCHOOL_VERIFICATION_MESSAGE)
        else if (result !== 'submitted' && result !== 'already-submitted' && result !== 'cancelled' && result !== 'wrong-page') this.loginFailed('学校登录表单未能自动提交。')
        return
      }
      if (!lmcAcademicUrl(url)) return
      const status = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(() => ({loggedIn:!!document.querySelector('a[href*="/login/logout.php"]'),sso:[...document.querySelectorAll('a[href]')].some(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&u.pathname==='/auth/saml2/login.php'}catch{return false}})}))()` }])
      if (!this.valid(g, win)) return
      if (status.sso && !status.loggedIn && !this.ssoClicked) {
        this.ssoClicked = true
        await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `if(location.origin===${JSON.stringify(LMC_ORIGIN)}){const a=[...document.querySelectorAll('a[href]')].find(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&u.pathname==='/auth/saml2/login.php'}catch{return false}});a?.click()}` }])
        return
      }
      if (!status.loggedIn) return
      this.stopWatch(); this.update({ phase: 'loading', message: 'LMC 已登录，正在读取课程和通知…' })
      await this.queued('overview', (generation, window) => this.readOverview(generation, window)).catch(() => { if (this.valid(g, win) && this.state.phase !== 'expired') this.fail('LMC 信息暂未读取成功，请重新连接。') })
    } catch { /* A successful SAML redirect can replace the old document. */ }
    finally {
      this.ticking = false
      if (this.valid(g, win) && this.watch && !this.manual && Date.now() > this.deadline) {
        this.loginFailed('LMC 认证等待超时。')
      }
    }
  }
  private async navigate(g: number, win: BrowserWindow, url: string): Promise<void> {
    if (!this.valid(g, win) || !lmcAcademicUrl(url)) throw new Error('Invalid LMC navigation')
    await win.loadURL(url)
    if (!this.valid(g, win)) return
    if (!lmcAcademicUrl(win.webContents.getURL()) || new URL(win.webContents.getURL()).pathname.includes('/login/')) throw new LmcAuthError()
  }
  private async portal(g: number, win: BrowserWindow): Promise<void> {
    if (!lmcAcademicUrl(win.webContents.getURL()) || !await win.webContents.executeJavaScript(`location.origin===${JSON.stringify(LMC_ORIGIN)}&&!!globalThis.M?.cfg?.sesskey`)) await this.navigate(g, win, `${LMC_ORIGIN}/my/`)
  }
  private ajax(g: number, win: BrowserWindow, kind: 'courses' | 'notifications', offset: number): Promise<unknown> {
    return this.readAjax(g, win, lmcAjaxScript(kind, offset))
  }
  private async readAjax(g: number, win: BrowserWindow, script: string): Promise<unknown> {
    if (!this.valid(g, win)) throw new Error('Cancelled')
    const result = await win.webContents.executeJavaScript(script)
    if (!this.valid(g, win)) throw new Error('Cancelled')
    if (!result?.ok) { if (result?.reason === 'auth') throw new LmcAuthError(); throw new Error('LMC response unavailable') }
    return result.data
  }
  private async readOverview(g: number, win: BrowserWindow): Promise<void> {
    await this.portal(g, win)
    let authFailed = false
    try {
      const courses = new Map<string, ReturnType<typeof parseLmcCourses>[number]>(); let complete = false
      for (let offset = 0; offset < 500; offset += 50) {
        const page = parseLmcCourses(await this.ajax(g, win, 'courses', offset))
        const size = courses.size
        for (const course of page) courses.set(course.id, course)
        if (page.length < 50) { complete = true; break }
        if (courses.size === size) break
      }
      if (!this.valid(g, win)) return
      const ids = new Set(courses.keys())
      // Successful course refresh drops cached modules no longer in this account's list.
      const modules = Object.fromEntries(Object.entries(this.state.modules).filter(([id]) => ids.has(id)))
      const courseGrades = Object.fromEntries(Object.entries(this.state.courseGrades).filter(([id]) => ids.has(id)))
      const activityResults = Object.fromEntries(Object.entries(this.state.activityResults).filter(([id]) => ids.has(id.split(':')[1])))
      for (const [id, route] of this.routes) if (!ids.has(route.courseId)) this.routes.delete(id)
      this.update({ courses: [...courses.values()], coursesAt: new Date().toISOString(), coursesComplete: complete, modules, courseGrades, activityResults, issues: { ...this.state.issues, courses: complete ? null : '课程列表较长，当前仅读取了部分课程。' } })
    } catch (error) { authFailed = error instanceof LmcAuthError; if (this.valid(g, win)) this.update({ issues: { ...this.state.issues, courses: '课程列表读取失败，保留上次结果。' } }) }
    if (!this.valid(g, win)) return
    if (!authFailed) { try { await this.readNotifications(g, win, false) } catch (error) { authFailed = error instanceof LmcAuthError } }
    if (!this.valid(g, win)) return
    this.update({ phase: authFailed ? 'expired' : 'connected', message: authFailed ? 'LMC 会话已失效，请重新连接。' : this.state.issues.courses || this.state.issues.notifications ? '已连接 LMC，部分信息暂未更新，请查看页面提示。' : '课程和通知已更新，选择课程查看 Module 资料。' })
  }
  refresh(): Promise<void> {
    if (this.state.phase === 'manual-login-required') return Promise.resolve()
    if (this.state.phase === 'verification-required') return this.showLogin()
    if (this.watch) return Promise.resolve()
    if (!this.win || this.win.isDestroyed() || this.state.phase !== 'connected') return this.connect()
    return this.queued('overview', (g, win) => this.readOverview(g, win))
  }
  private moduleState(courseId: string, next: Partial<LmcModule>): void {
    const current = this.state.modules[courseId] ?? { courseId, activities: [], folders: {}, fetchedAt: null, loading: false, issue: null }
    this.update({ modules: { ...this.state.modules, [courseId]: { ...current, ...next } } })
  }
  loadCourse(input: unknown): Promise<void> {
    const id = lmcId.parse(input); this.requireWindow()
    if (!this.state.courses.some(course => course.id === id)) throw new Error('请选择已读取的课程。')
    return this.queued(`course:${id}`, async (g, win) => {
      this.moduleState(id, { loading: true, issue: null })
      try {
        await this.navigate(g, win, `${LMC_ORIGIN}/course/view.php?id=${id}`)
        const until = Date.now() + 10_000
        let document: LmcPageDocument
        do {
          document = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: lmcCourseInspection }])
          if (!this.valid(g, win)) return
          if (document?.auth) throw new LmcAuthError()
          if (document?.recognized && document.indexReady) break
          await new Promise(resolve => setTimeout(resolve, 250))
        } while (Date.now() < until)
        if (!this.valid(g, win)) return
        if (document?.auth) throw new LmcAuthError()
        if (!document?.recognized || !document.indexReady || !Array.isArray(document.activities)) throw new Error('Unrecognized course or index not ready')
        const rows = document.activities.filter(row => lmcId.safeParse(row.cmid).success && /^[a-z][a-z0-9_]{0,40}$/.test(row.type))
        const indexAssignments = rows.filter(row => row.type === 'assign' && !row.assignmentDates).map(row => row.cmid)
        const cards: [string, LmcAssignmentDates][] = indexAssignments.length
          ? await win.webContents.executeJavaScript(lmcAssignmentCardsScript(indexAssignments)).catch(() => [])
          : []
        if (!this.valid(g, win)) return
        const datesById = new Map(cards)
        const activities = rows.map(row => {
          const activityId = `activity:${id}:${row.type}:${row.cmid}`
          this.routes.set(activityId, { url: `${LMC_ORIGIN}/mod/${row.type}/view.php?id=${row.cmid}`, courseId: id, kind: row.type === 'resource' ? 'resource' : row.type === 'folder' ? 'folder' : 'activity', name: lmcText(row.title, 1000) })
          const assignmentDates = row.type === 'assign' ? cleanLmcAssignmentDates(row.assignmentDates ?? datesById.get(row.cmid)) : undefined
          return { id: activityId, title: lmcText(row.title, 1000), section: lmcText(row.section, 300), type: row.type, fileType: lmcText(row.fileType, 30), downloadable: row.type === 'resource', ...(assignmentDates && { assignmentDates }) }
        })
        this.moduleState(id, { activities, folders: {}, fetchedAt: new Date().toISOString(), loading: false, issue: null })
      } catch (error) { if (this.valid(g, win)) this.moduleState(id, { loading: false, issue: '课程资料暂未读取成功，保留上次结果。' }); throw error }
    })
  }
  private readAssessment<T>(key: string, script: string, schema: { parse(input: unknown): T },
    previous: LmcReadSnapshot<T> | undefined, save: (snapshot: LmcReadSnapshot<T>) => void, issue: string): Promise<void> {
    return this.queued(key, async (g, win) => {
      const cached = previous ?? { data: null, fetchedAt: null, loading: false, issue: null }
      save({ ...cached, loading: true, issue: null })
      try {
        await this.portal(g, win)
        const data = schema.parse(await this.readAjax(g, win, script))
        if (this.valid(g, win)) save({ data, fetchedAt: new Date().toISOString(), loading: false, issue: null })
      } catch (error) {
        if (this.valid(g, win)) save({ ...cached, loading: false, issue })
        if (error instanceof LmcAuthError) throw error
      }
    })
  }
  loadCourseGrades(input: unknown): Promise<void> {
    this.requireWindow()
    const id = lmcId.parse(input)
    if (!this.state.courses.some(course => course.id === id)) throw new Error('请选择已读取的课程。')
    return this.readAssessment('grades:' + id, lmcCourseGradesScript(id), lmcGradeReport, this.state.courseGrades[id],
      snapshot => this.update({ courseGrades: { ...this.state.courseGrades, [id]: snapshot } }),
      '个人成绩表暂不可读，请在学校 Grades 页面确认。')
  }
  async loadActivityResult(input: unknown, refreshGrades = false): Promise<void> {
    this.requireWindow()
    const { id, route } = this.route(input, 'activity')
    const activity = this.state.modules[route.courseId]?.activities.find(item => item.id === id)
    if (!activity) throw new Error('请选择课程目录中已读取的活动。')
    const type = LMC_SUBMISSION_TYPES.find(type => type === activity.type)
    if (type) {
      const cmid = id.split(':')[3]
      return this.readAssessment('result:' + id, lmcActivityResultScript(type, cmid), lmcAssessmentResult, this.state.activityResults[id],
        snapshot => this.update({ activityResults: { ...this.state.activityResults, [id]: snapshot } }),
        '暂未读取到提交结果，请在学校原页确认。')
    }
    if (refreshGrades || !this.state.courseGrades[route.courseId]?.fetchedAt) await this.loadCourseGrades(route.courseId)
  }
  private route(input: unknown, kind?: Route['kind']): { id: string; route: Route } {
    const id = z.string().max(200).parse(input), route = this.routes.get(id)
    if (!route || kind && route.kind !== kind || !this.state.courses.some(course => course.id === route.courseId)) throw new Error('资料入口已更新，请重新打开对应课程。')
    return { id, route }
  }
  private folderState(courseId: string, id: string, next: Partial<LmcModule['folders'][string]>): void {
    const module = this.state.modules[courseId]
    if (!module) return
    const current = module.folders[id] ?? { files: [], fetchedAt: null, loading: false, issue: null }
    this.moduleState(courseId, { folders: { ...module.folders, [id]: { ...current, ...next } } })
  }
  private async inspectFiles(g: number, win: BrowserWindow, wait: boolean): Promise<LmcFilesDocument> {
    const until = Date.now() + (wait ? 10_000 : 1500)
    const emptyNotBefore = Date.now() + (wait ? 1500 : 0)
    let document: LmcFilesDocument
    do {
      if (!this.valid(g, win)) throw new Error('Cancelled')
      document = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: lmcFileInspection }])
      if (document?.auth || !lmcAcademicUrl(win.webContents.getURL())) throw new LmcAuthError()
      if (document?.recognized && document.ready && (document.files.length || Date.now() >= emptyNotBefore)) return document
      await new Promise(resolve => setTimeout(resolve, 250))
    } while (Date.now() < until)
    throw new Error('File list not ready')
  }
  loadFolder(input: unknown): Promise<void> {
    this.requireWindow(); const { id, route } = this.route(input, 'folder')
    return this.queued(`folder:${id}`, async (g, win) => {
      this.folderState(route.courseId, id, { loading: true, issue: null })
      try {
        await this.navigate(g, win, route.url)
        const document = await this.inspectFiles(g, win, true)
        if (!this.valid(g, win)) return
        const files: LmcFile[] = document.files.filter(file => lmcFileUrl(file.url)).map(file => {
          const fileId = `file:${randomUUID()}`
          this.routes.set(fileId, { url: file.url, courseId: route.courseId, kind: 'file', name: safeLmcFilename(file.name) })
          return { id: fileId, name: safeLmcFilename(file.name), path: lmcText(file.path, 1000), extension: file.name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ?? '' }
        })
        this.folderState(route.courseId, id, { files, fetchedAt: new Date().toISOString(), loading: false, issue: null })
      } catch (error) { if (this.valid(g, win)) this.folderState(route.courseId, id, { loading: false, issue: '文件夹未能读取，请重试或打开学校原页。' }); throw error }
    })
  }
  private attachmentList(route: NotificationRoute): LmcNotificationAttachment[] | undefined {
    return route.files && [...route.files].map(([fileId, { name }]) => ({ fileId, name }))
  }
  private rememberNotification({ privateUrl, ...item }: LmcNotification & { privateUrl: string | null }): LmcNotification {
    if (!privateUrl) {
      this.notificationRoutes.delete(item.id)
      return item
    }
    const previous = this.notificationRoutes.get(item.id)
    const route = previous?.url === privateUrl ? previous : { url: privateUrl }
    this.notificationRoutes.delete(item.id)
    this.notificationRoutes.set(item.id, route)
    if (this.notificationRoutes.size > 5000) this.notificationRoutes.delete(this.notificationRoutes.keys().next().value!)
    const attachments = this.attachmentList(route)
    return attachments ? { ...item, attachments } : item
  }
  async loadNotificationAttachments(input: unknown): Promise<LmcNotificationAttachment[] | null> {
    const id = z.string().min(1).max(200).parse(input)
    const route = this.notificationRoutes.get(id)
    const target = lmcForumTarget(route?.url ?? null)
    if (!route || !target) return null
    if (route.files) return this.attachmentList(route)!
    await this.queued(`notification-attachments:${id}`, async (g, win) => {
      await this.portal(g, win)
      const files = parseLmcForumAttachments(await this.readAjax(g, win, lmcForumAttachmentsScript(target)))
      if (!this.valid(g, win) || this.notificationRoutes.get(id) !== route) return
      route.files = new Map(files.map(file => [`attachment:${randomUUID()}`, file]))
      const attachments = this.attachmentList(route)!
      this.update({ notifications: this.state.notifications.map(item => item.id === id ? { ...item, attachments } : item) })
    })
    return this.attachmentList(route) ?? null
  }
  private async readNotifications(g: number, win: BrowserWindow, more: boolean): Promise<void> {
    this.update({ notificationsLoading: true })
    try {
      await this.portal(g, win)
      const offset = more ? this.notificationOffset : 0
      const result = parseLmcNotifications(await this.ajax(g, win, 'notifications', offset))
      if (!this.valid(g, win)) return
      const items = result.items.map(item => this.rememberNotification(item))
      const merged = new Map((more ? this.state.notifications : []).map(item => [item.id, item]))
      for (const item of items) merged.set(item.id, item)
      this.notificationOffset = offset + items.length
      this.update({ notifications: [...merged.values()], notificationsAt: new Date().toISOString(), unreadCount: result.unreadCount, moreNotifications: items.length === 20 && merged.size < 500, notificationsLoading: false, issues: { ...this.state.issues, notifications: null } })
    } catch (error) { if (this.valid(g, win)) this.update({ notificationsLoading: false, issues: { ...this.state.issues, notifications: '通知暂未更新，保留上次结果。' } }); throw error }
  }
  loadNotifications(more: boolean): Promise<void> { this.requireWindow(); if (more && !this.state.moreNotifications) return Promise.resolve(); return this.queued('notifications', (g, win) => this.readNotifications(g, win, more)) }
  readNotificationRange(since: number): Promise<LmcNotificationRange> {
    this.requireWindow()
    const existing = this.notificationReads.get(since)
    if (existing) return existing
    const items = new Map<string, LmcNotification>()
    let fetchedAt: string | null = null
    let complete = false
    let issue: string | null = null
    const task = this.queued(`notification-range:${since}`, async (g, win) => {
      const deadline = Date.now() + 24_000
      await this.portal(g, win)
      let previousTime = Infinity
      let ordered = true
      for (let offset = 0; offset < 5_000 && Date.now() < deadline && this.valid(g, win); offset += 20) {
        const page = parseLmcNotifications(await this.ajax(g, win, 'notifications', offset)).items
        if (!this.valid(g, win)) return
        fetchedAt = new Date().toISOString()
        for (const item of page) {
          const time = item.createdAt ? Date.parse(item.createdAt) : NaN
          ordered &&= Number.isFinite(time) && time <= previousTime
          previousTime = time
          if (!Number.isFinite(time) || time >= since) items.set(item.id, this.rememberNotification(item))
        }
        if (page.length < 20 || ordered && previousTime < since) { complete = true; break }
      }
    }).catch(() => { issue = 'LMC 通知未能全部读取，请检查连接后重试。' }).then(() => ({
      notifications: [...items.values()], fetchedAt, complete,
      issue: issue ?? (complete ? null : '通知读取达到分页或时间限制，请缩小查询范围后重试。')
    })).finally(() => { if (this.notificationReads.get(since) === task) this.notificationReads.delete(since) })
    this.notificationReads.set(since, task)
    return task
  }
  private downloadState(id: string, next: Partial<LmcDownload>): void { this.update({ downloads: this.state.downloads.map(item => item.id === id ? { ...item, ...next } : item) }) }
  private cancelTicket(message = '下载已取消。', cancelled = false): void {
    const ticket = this.ticket
    if (!ticket) return
    this.ticket = null; clearTimeout(ticket.timer); this.downloadState(ticket.id, { phase: cancelled ? 'cancelled' : 'error', message }); ticket.reject(cancelled ? new LmcCancelledDownload(message) : new Error(message))
  }
  async download(input: unknown, notificationId?: string): Promise<void> { await this.startDownload(input, undefined, notificationId) }
  private downloadRoute(input: unknown, notificationId?: string) {
    if (notificationId === undefined) return this.route(input)
    const id = z.string().max(200).parse(input)
    const file = this.notificationRoutes.get(notificationId)?.files?.get(id)
    if (!file) throw new Error('附件入口已更新，请重新读取公告附件。')
    return { id, route: { ...file, kind: 'file' as const } }
  }
  async startDownload(input: unknown, savePath?: string, notificationId?: string): Promise<string | null> {
    const win = this.requireWindow(), generation = this.generation
    const { id, route } = this.downloadRoute(input, notificationId)
    if (route.kind !== 'resource' && route.kind !== 'file') throw new Error('请展开文件夹后选择文件下载。')
    if (this.startingDownload || this.ticket || this.items.size) throw new Error('请等待当前下载完成或取消后再下载。')
    const start = {}
    this.startingDownload = start
    let startedId: string | null = null
    let destination: LmcSaveTarget | undefined
    try {
      if (savePath !== undefined) destination = await prepareLmcSavePath(savePath, app.getPath('temp'))
      if (!this.valid(generation, win)) return null
      await this.queued('download', async (g, win) => {
        if (this.ticket || this.items.size) throw new Error('A download is already active')
        const current = this.downloadRoute(id, notificationId).route
        const downloadId = randomUUID()
        this.update({ downloads: [{ id: downloadId, name: current.name, phase: 'preparing' as const, received: 0, total: 0, message: '正在取得学校文件…' }, ...this.state.downloads].slice(0, 20) })
        const started = new Promise<void>((resolve, reject) => {
          this.ticket = { id: downloadId, generation: g, win, expected: new Set([current.url]), destination, resolve, reject,
            timer: setTimeout(() => this.cancelTicket('未能取得下载文件，请重试或打开学校原页。'), 30_000) }
        })
        const ticket = this.ticket!
        void (async () => {
          try {
            if (current.kind === 'file') { win.webContents.downloadURL(current.url); return }
            // A resource can redirect straight to a download or render a preview.
            await win.loadURL(current.url).catch(() => {})
            if (this.ticket !== ticket || !this.valid(g, win)) return
            if (!lmcAcademicUrl(win.webContents.getURL()) || new URL(win.webContents.getURL()).pathname.includes('/login/')) { this.cancelTicket('登录已失效，请重新连接 LMC 后下载。'); this.update({ phase: 'expired' }); return }
            const currentUrl = win.webContents.getURL()
            if (lmcFileUrl(currentUrl)) { ticket.expected.add(currentUrl); win.webContents.downloadURL(currentUrl); return }
            const document = await this.inspectFiles(g, win, false)
            if (this.ticket !== ticket || !this.valid(g, win)) return
            const file = document.files.find(file => lmcFileUrl(file.url))
            if (!file) { this.cancelTicket('未识别到实际文件，请打开学校原页确认。'); return }
            ticket.expected.add(file.url); win.webContents.downloadURL(file.url)
          } catch { if (this.ticket === ticket) this.cancelTicket('下载入口暂时不可用，请重试。') }
        })()
        await started
        startedId = ticket.id
      })
      return startedId
    } finally {
      if (!startedId) await destination?.cleanup()
      if (this.startingDownload === start) this.startingDownload = null
    }
  }
  private onDownload = (event: Electron.Event, item: DownloadItem, contents: WebContents): void => {
    const ticket = this.ticket
    const chain = item.getURLChain()
    const initiator = item.getInitiatorOrigin()
    if (!ticket || !this.valid(ticket.generation, ticket.win) || contents !== ticket.win.webContents || !lmcDownloadAllowed(ticket.expected, chain, initiator)) {
      event.preventDefault()
      if (ticket) this.cancelTicket('下载来源未通过校验，请重新打开课程资料。')
      return
    }
    const destination = ticket.destination
    const name = destination ? basename(destination.target) : safeLmcFilename(item.getFilename())
    try {
      if (destination) item.setSavePath(destination.stagingPath)
      else item.setSaveDialogOptions({ title: '保存 Learning Mall 资料', defaultPath: join(app.getPath('downloads'), name), properties: ['showOverwriteConfirmation', 'createDirectory'] })
    } catch {
      event.preventDefault()
      this.cancelTicket('未能设置文件保存位置。')
      return
    }
    this.ticket = null; clearTimeout(ticket.timer)
    this.items.set(ticket.id, item)
    this.downloadState(ticket.id, { name, phase: 'downloading', total: item.getTotalBytes(), message: destination ? '正在下载…' : '请选择保存位置，正在下载…' })
    ticket.resolve()
    let lastUpdate = 0
    item.on('updated', (_event, state) => {
      if (this.disposed || ticket.generation !== this.generation || Date.now() - lastUpdate < 200) return
      lastUpdate = Date.now()
      this.downloadState(ticket.id, { received: item.getReceivedBytes(), total: item.getTotalBytes(), message: state === 'interrupted' ? '下载中断，等待学校服务器恢复。' : '正在下载…' })
    })
    item.once('done', (_event, state) => {
      this.items.delete(ticket.id)
      void this.finishDownload(ticket, state, item.getSavePath(), item.getReceivedBytes(), item.getTotalBytes())
    })
  }
  private async finishDownload(ticket: DownloadTicket, state: 'completed' | 'cancelled' | 'interrupted', path: string, received: number, total: number): Promise<void> {
    const destination = ticket.destination
    let phase: LmcDownload['phase'] = state === 'interrupted' ? 'error' : state
    let message = state === 'completed' ? '下载完成。' : state === 'cancelled' ? '下载已取消。' : '下载中断，请重新下载。'
    try {
      if (state === 'completed' && !this.disposed && ticket.generation === this.generation) await destination?.save()
    } catch (error) {
      phase = 'error'
      message = error instanceof LmcSavePathError ? error.message : '未能保存下载文件。'
    } finally { await destination?.cleanup() }
    if (this.disposed || ticket.generation !== this.generation) return
    if (phase === 'completed') this.saved.set(ticket.id, destination?.target ?? path)
    this.downloadState(ticket.id, { received, total, phase, message })
  }
  async cancelDownload(input: unknown): Promise<void> { const id = z.string().max(200).parse(input); if (this.ticket?.id === id) this.cancelTicket('下载已取消。', true); this.items.get(id)?.cancel() }
  async revealDownload(input: unknown): Promise<void> { const id = z.string().max(200).parse(input), path = this.saved.get(id); if (!path) throw new Error('文件尚未下载完成。'); shell.showItemInFolder(path) }
  async showLogin(): Promise<void> {
    if (this.state.phase === 'manual-login-required') {
      const win = this.win
      if (!win || win.isDestroyed() || (!this.watch && (win.webContents.isLoadingMainFrame() || !isAuthenticationOrigin(win.webContents.getURL())))) {
        this.startLogin(true)
        return
      }
      const g = this.generation
      this.manual = true
      this.watch ??= setInterval(() => void this.tick(g, win), 750)
      this.update({ message: SCHOOL_MANUAL_LOGIN_MESSAGE })
    } else if (!this.win || this.win.isDestroyed()) await this.connect()
    showSchoolLoginWindow(this.win)
  }
  openSource(source: LmcSource): Promise<void> {
    this.requireWindow()
    let url = `${LMC_ORIGIN}/my/`
    let assignment: { id: string; courseId: string } | undefined
    if (source.kind === 'course' || source.kind === 'grades') {
      const id = lmcId.parse(source.id)
      if (!this.state.courses.some(course => course.id === id)) throw new Error('Invalid course')
      url = `${LMC_ORIGIN}${source.kind === 'grades' ? '/grade/report/user/index.php' : '/course/view.php'}?id=${id}`
    }
    else if (source.kind === 'activity') {
      const { id, route } = this.route(source.id)
      url = route.url
      if (url.startsWith(`${LMC_ORIGIN}/mod/assign/view.php?id=`)) assignment = { id, courseId: route.courseId }
    }
    else if (source.kind === 'notification') { const target = this.notificationRoutes.get(source.id); if (!target) throw new Error('这条通知未提供可打开的原文入口。'); url = target.url }
    return this.queued('open-source', async (g, win) => {
      await this.navigate(g, win, url)
      if (!this.valid(g, win)) return
      win.show(); win.focus()
      if (!assignment || win.webContents.getURL() !== url) return
      const result = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: lmcAssignmentPageInspection }]).catch(() => null)
      if (!this.valid(g, win) || win.webContents.getURL() !== url) return
      const dates = cleanLmcAssignmentDates(result)
      const { id, courseId } = assignment
      const module = this.state.modules[courseId]
      if (!dates || !module) return
      const activities = module.activities.map(activity => activity.id === id ? {
        ...activity,
        assignmentDates: { opens: dates.opens ?? activity.assignmentDates?.opens ?? null, due: dates.due ?? activity.assignmentDates?.due ?? null }
      } : activity)
      this.moduleState(courseId, { activities })
    })
  }
  async cancelAccountAutomation(): Promise<void> {
    this.credentialGeneration++
    const contents = this.win?.webContents
    if (contents && !contents.isDestroyed() && isAuthenticationOrigin(contents.getURL())) await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: 'globalThis.__xjtluLoginAttempt=null' }]).catch(() => {})
    await this.automatic?.catch(() => {})
  }
  accountChanged(previous: CredentialStatus, current: CredentialStatus): void {
    if (previous.username && current.username && previous.username !== current.username) void this.disconnect().catch(() => this.fail('请重新连接 LMC。'))
    else if (current.saved && this.state.phase === 'credentials-required') void this.connect().catch(() => this.fail('请重新连接 LMC。'))
  }
  private reset(): void {
    this.generation++; this.credentialGeneration++; this.stopWatch(); this.cancelTicket('下载已取消。', true)
    for (const item of this.items.values()) item.cancel()
    this.items.clear(); this.saved.clear(); this.routes.clear(); this.notificationRoutes.clear(); this.notificationOffset = 0; this.notificationReads.clear(); this.startingDownload = null; this.pending.clear(); this.tail = Promise.resolve()
    const win = this.win; this.win = null; win?.destroy()
    this.state = initialLmcState()
  }
  async disconnect(): Promise<void> { this.reset(); this.update({ message: 'LMC 已断开，首页公共学校账号保留。' }); await this.school.clearStorageData(); await this.school.clearCache() }
  dispose(): void { this.disposed = true; this.reset(); this.school.removeListener('will-download', this.onDownload) }
}
