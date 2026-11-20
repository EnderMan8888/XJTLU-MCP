import { BrowserWindow, session, type Session } from 'electron'
import { AmsError, fetchTimetable } from '../providers/ams'
import { academicTermSchema, fetchModuleSnapshot, fetchTermOptions } from '../providers/ams-modules'
import { fetchModuleRecords, moduleAttendanceQuerySchema } from '../providers/ams-module-records'
import { AMS_ENTRY, AMS_MODULE_SOURCE, AMS_ORIGIN, AMS_SOURCE, initialState, type AmsState } from '../shared/ams'
import type { AcademicTerm, ModuleAttendanceSnapshot } from '../shared/modules'
import { amsRelativeDays } from '../shared/module-attendance'
import { ebridgeTimetableForDate } from '../shared/ebridge-timetable'
import type { EbridgeState } from '../shared/ebridge'
import type { CredentialStatus } from '../shared/credentials'
import type { AccountConsumer, AccountService } from '../services/account-service'
import { buildAutomaticLoginScript, buildLoginInspectionScript, isAuthenticationOrigin, isCredentialPage, SCHOOL_VERIFICATION_MESSAGE } from '../security/login-policy'
import { isAbortedNavigation, showSchoolLoginWindow } from './school-login-window'

function isSchoolUrl(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'xjtlu.edu.cn' || url.hostname.endsWith('.xjtlu.edu.cn')) } catch { return false }
}
function isAmsPage(raw: string): boolean {
  try { const url = new URL(raw); return url.origin === AMS_ORIGIN && url.pathname.startsWith('/studentpc/') } catch { return false }
}
function message(error: unknown): string { return error instanceof AmsError ? error.message : '读取失败，请稍后重试。' }

export class AmsService implements AccountConsumer {
  private school: Session
  private login: BrowserWindow | null = null
  private state = initialState()
  private pending: Promise<void> | null = null
  private attendanceGeneration=0
  private scheduleAttendanceGeneration=new Map<string,number>()
  private automaticPending: Promise<unknown> | null = null
  private watch: ReturnType<typeof setInterval> | null = null
  private tickPending = false
  private generation = 0
  private credentialGeneration = 0
  private submitted = false
  private deadline = 0
  private explicitWindow = false
  private authenticating = false
  private recoveries = 0
  private token = ''
  private currentTerm: AcademicTerm | null = null
  private selectedTerm: AcademicTerm | null = null
  private disposed = false

  constructor(private readonly publish: (state: AmsState) => void, private readonly account: AccountService) {
    this.school = session.fromPartition('persist:xjtlu-ams')
    this.school.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.school.setPermissionCheckHandler(() => false)
    this.school.on('will-download', (event) => event.preventDefault())
    this.school.webRequest.onBeforeRequest({ urls: ['http://ams.xjtlu.edu.cn/*'] }, (details, callback) => {
      const url = new URL(details.url); url.protocol = 'https:'; callback({ redirectURL: url.href })
    })
  }

  getState(): AmsState { return structuredClone(this.state) }
  private update(next: Partial<AmsState>): void { if (!this.disposed) { this.state = { ...this.state, ...next }; this.publish(this.getState()) } }
  private stopWatch(): void { if (this.watch) clearInterval(this.watch); this.watch = null }

  private attention(text: string): void {
    const newlyRequired = this.state.phase !== 'verification-required'
    this.submitted = true
    if (newlyRequired || this.state.message !== text) this.update({ phase: 'verification-required', message: text })
    if (newlyRequired) showSchoolLoginWindow(this.login)
  }

  private fail(text: string): void {
    this.authenticating = false
    this.stopWatch()
    this.update({ phase: 'error', message: text })
  }

  private beginLogin(show: boolean, target = AMS_ENTRY): void {
    if (this.disposed) return
    this.generation++
    this.credentialGeneration++
    this.pending = null
    this.submitted = false
    this.token = ''
    this.currentTerm = null
    this.stopWatch()
    this.authenticating = false
    this.login?.destroy()
    this.explicitWindow = show
    this.authenticating = true
    this.deadline = Date.now() + 60_000
    const win = new BrowserWindow({
      title: '西浦官方认证 · AMS', width: 1180, height: 800, minWidth: 800, show,
      autoHideMenuBar: true,
      webPreferences: { session: this.school, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
    })
    this.login = win
    win.webContents.setWindowOpenHandler(({ url }) => { if (isSchoolUrl(url)) void win.loadURL(url).catch(() => {}); return { action: 'deny' } })
    win.webContents.on('will-navigate', (event, url) => { if (!isSchoolUrl(url)) event.preventDefault() })
    win.webContents.on('will-redirect', (event, url) => { if (!isSchoolUrl(url)) event.preventDefault() })
    const probe = (): void => { void this.tickAuthentication() }
    win.webContents.on('did-finish-load', probe)
    win.webContents.on('did-navigate-in-page', probe)
    win.on('closed', () => {
      if (this.login !== win) return
      this.login = null
      this.stopWatch()
      if (this.authenticating) { this.authenticating = false; this.update({ phase: 'error', message: '认证窗口已关闭，可重新连接 AMS。' }) }
    })
    this.update({ phase: 'authenticating', message: '正在后台恢复学校会话，必要时自动填写账号并登录…' })
    this.watch = setInterval(probe, 700)
    void win.loadURL(target).catch(error => {
      if (!isAbortedNavigation(error) && this.login === win && !win.isDestroyed() && this.authenticating && this.state.phase !== 'verification-required') {
        this.fail('学校页面加载失败，请检查网络后重试。')
      }
    })
  }

  async openLogin(): Promise<void> {
    if (this.state.phase === 'verification-required') { await this.showLogin(); return }
    if (this.authenticating && this.login && !this.login.isDestroyed()) return
    if (this.token && this.state.phase === 'connected') { await this.refresh(); return }
    this.recoveries = 0
    this.beginLogin(false)
  }

  async showLogin(): Promise<void> {
    if (this.login && !this.login.isDestroyed()) { showSchoolLoginWindow(this.login); return }
    this.beginLogin(true)
  }

  private async tickAuthentication(): Promise<void> {
    const win = this.login
    if (this.tickPending || !this.authenticating || !win || win.isDestroyed() || this.disposed) return
    this.tickPending = true
    const generation = this.generation
    try {
      if (win.webContents.isLoadingMainFrame()) return
      const url = win.webContents.getURL()
      if (isAmsPage(url)) {
        await this.readSession(generation)
        if (generation !== this.generation) return
        if (this.token && this.currentTerm) {
          this.authenticating = false
          this.stopWatch()
          await this.refresh(false)
        }
        return
      }
      if (!isAuthenticationOrigin(url)) return
      const inspection: unknown = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildLoginInspectionScript() }])
      if (generation !== this.generation || win.isDestroyed()) return
      if (inspection === 'verification-required') { this.attention(SCHOOL_VERIFICATION_MESSAGE); return }
      if (this.state.phase === 'verification-required') return
      if (inspection === 'login-error') { this.fail('学校登录未通过，请到首页核对保存的账号密码后重试。'); return }
      if (inspection !== 'credentials' || !isCredentialPage(url) || this.submitted) return
      const credentialGeneration = this.credentialGeneration
      let saved: Awaited<ReturnType<AccountService['read']>>
      try { saved = await this.account.read() } catch {
        this.stopWatch()
        this.update({ phase: 'credentials-required', message: '保存的学校账号暂时无法解锁，请到首页更新账号设置。' })
        return
      }
      if (generation !== this.generation || credentialGeneration !== this.credentialGeneration || win.isDestroyed()) return
      if (!saved) {
        this.stopWatch()
        this.update({ phase: 'credentials-required', message: '请在首页的“账号与登录”中保存学校账号，之后由程序自动登录。' })
        return
      }
      if (!isCredentialPage(win.webContents.getURL())) return
      this.submitted = true
      const task = win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: buildAutomaticLoginScript(saved, `${generation}:${credentialGeneration}`) }])
      this.automaticPending = task
      let result: unknown
      try { result = await task } finally { if (this.automaticPending === task) this.automaticPending = null }
      if (generation !== this.generation || credentialGeneration !== this.credentialGeneration || win.isDestroyed()) return
      if (result === 'submitted' || result === 'already-submitted') this.update({ message: '已自动提交登录，正在等待学校认证结果…' })
      else if (result === 'verification-required') this.attention(SCHOOL_VERIFICATION_MESSAGE)
      else if (result !== 'cancelled' && result !== 'wrong-page') this.fail('登录表单未能自动提交，请检查首页账号设置，或打开官方页面处理。')
    } catch {
      // A successful login may navigate before executeJavaScript resolves. Do
      // not resubmit; keep watching for the AMS page or a verification step.
    } finally {
      this.tickPending = false
      if (generation === this.generation && !win.isDestroyed() && this.authenticating && Date.now() > this.deadline && this.state.phase !== 'verification-required' && this.state.phase !== 'credentials-required') {
        if (isAuthenticationOrigin(win.webContents.getURL())) this.attention('学校认证还未结束。请在官方窗口查看提示并继续登录。')
        else this.fail('学校认证等待超时，请检查网络，或打开登录页查看状态。')
      }
    }
  }

  async cancelAccountAutomation(): Promise<void> {
    this.credentialGeneration++
    const contents = this.login?.webContents
    if (contents && !contents.isDestroyed() && isAuthenticationOrigin(contents.getURL())) {
      await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: 'globalThis.__xjtluLoginAttempt = null' }]).catch(() => {})
    }
    await this.automaticPending?.catch(() => {})
  }

  accountChanged(previous: CredentialStatus, current: CredentialStatus): void {
    if (previous.username && current.username && previous.username !== current.username) {
      void this.clearSession().then(() => this.openLogin()).catch(() => this.fail('切换学校账号失败，请重试连接。'))
    } else if (current.saved && this.state.phase !== 'connected') {
      void this.reconnect().catch(() => this.fail('重新连接失败，请重试。'))
    }
  }

  async reconnect(userInitiated = true): Promise<void> {
    if (userInitiated) this.recoveries = 0
    this.generation++
    this.authenticating = false
    this.stopWatch()
    this.login?.destroy()
    this.login = null
    await this.school.clearStorageData({ origin: AMS_ORIGIN, storages: ['localstorage'] })
    this.beginLogin(false)
  }

  private async readSession(generation: number): Promise<void> {
    const contents = this.login?.webContents
    if (!contents || contents.isDestroyed() || !isAmsPage(contents.getURL())) return
    const value: unknown = await contents.executeJavaScript(`(() => {
      if (location.origin !== 'https://ams.xjtlu.edu.cn') return null;
      let info = {}; try { info = JSON.parse(localStorage.getItem('userInfo') || '{}') || {}; } catch {}
      return { token: localStorage.getItem('Token') || '', academicYear: String(info.academicYear || ''), semester: String(info.semester || '') };
    })()`)
    if (generation !== this.generation || this.login?.webContents !== contents || contents.isDestroyed() || !isAmsPage(contents.getURL())) return
    if (!value || typeof value !== 'object' || !('token' in value) || typeof value.token !== 'string') return
    this.token = value.token
    const term = academicTermSchema.safeParse({ academicYear: 'academicYear' in value ? value.academicYear : '', semester: 'semester' in value ? value.semester : '' })
    if (term.success) this.currentTerm = term.data
  }

  refresh(userInitiated = true): Promise<void> {
    if (!this.token) return this.openLogin()
    if (this.pending) return this.pending
    if (userInitiated) this.recoveries = 0
    const generation = this.generation
    const task = this.performRefresh(generation).finally(() => { if (this.pending === task) this.pending = null })
    this.pending = task
    return task
  }

  private async performRefresh(generation: number): Promise<void> {
    this.update({ phase: 'loading', message: '正在读取 AMS 课程列表、签到率和近期课表…' })
    const term = this.selectedTerm ?? this.currentTerm
    const fetcher = (url: string, init: RequestInit): Promise<Response> => this.school.fetch(url, init)
    const [timetable, modules, terms] = await Promise.allSettled([
      fetchTimetable(this.token, fetcher),
      fetchModuleSnapshot(this.token, term, fetcher),
      this.state.termOptions.academicYears.length ? Promise.resolve(this.state.termOptions) : fetchTermOptions(this.token, fetcher)
    ])
    if (generation !== this.generation || this.disposed) return
    const authenticationFailure = [timetable, modules, terms].some((result) => result.status === 'rejected' && result.reason instanceof AmsError && result.reason.kind === 'auth')
    if (authenticationFailure) {
      this.token = ''
      if (this.recoveries++ < 1) { await this.reconnect(false); return }
      this.fail('学校会话未能建立，请核对首页账号设置后重试。')
      return
    }
    const successful = timetable.status === 'fulfilled' || modules.status === 'fulfilled'
    this.update({
      phase: successful ? 'connected' : 'error',
      message: successful ? timetable.status === 'fulfilled' && modules.status === 'fulfilled' ? '已更新课程列表、签到率与近期课表。' : '部分信息已更新，请查看对应视图的提示。' : 'AMS 信息读取失败，请稍后重试。',
      days: timetable.status === 'fulfilled' ? timetable.value : this.state.days,
      timetableTerm: timetable.status === 'fulfilled' ? this.currentTerm : this.state.timetableTerm,
      fetchedAt: timetable.status === 'fulfilled' ? new Date().toISOString() : this.state.fetchedAt,
      moduleSnapshot: modules.status === 'fulfilled' ? modules.value : this.state.moduleSnapshot,
      termOptions: terms.status === 'fulfilled' ? terms.value : this.state.termOptions,
      issues: { timetable: timetable.status === 'rejected' ? message(timetable.reason) : null, modules: modules.status === 'rejected' ? message(modules.reason) : terms.status === 'rejected' ? '学期选项暂时不可用，当前课程数据已保留。' : null }
    })
    if (successful && !this.explicitWindow) { this.authenticating = false; this.login?.destroy(); this.login = null }
  }

  async setTerm(input: unknown): Promise<void> {
    const parsed = academicTermSchema.safeParse(input)
    if (!parsed.success) throw new Error('请选择有效的学年和学期。')
    const options = this.state.termOptions
    if (!options.academicYears.includes(parsed.data.academicYear) || !options.semesters.includes(parsed.data.semester)) throw new Error('请选择学校提供的学年和学期。')
    this.selectedTerm = parsed.data
    await this.refresh()
  }

  async loadModuleAttendance(input:unknown,target:'home'|'schedule'='home'):Promise<void> {
    const query=moduleAttendanceQuerySchema.parse(input)
    if(!this.token)return
    const generation=this.generation,token=this.token
    const request=target==='home'?++this.attendanceGeneration:(this.scheduleAttendanceGeneration.get(query.date)??0)+1
    if(target==='schedule')this.scheduleAttendanceGeneration.set(query.date,request)
    const previous=target==='home'?this.state.moduleAttendance:this.state.scheduleAttendance[query.date]
    const same=previous?.date===query.date&&previous.term.academicYear===query.term.academicYear&&previous.term.semester===query.term.semester
    const cached=same?previous.records:[]
    const publish=(snapshot:ModuleAttendanceSnapshot):void=>this.update(target==='home'?{moduleAttendance:snapshot}:{scheduleAttendance:{...this.state.scheduleAttendance,[query.date]:snapshot}})
    publish({...query,records:cached,fetchedAt:same?previous.fetchedAt:null,loading:true,issue:null})
    const valid=():boolean=>!this.disposed&&this.generation===generation&&(target==='home'?this.attendanceGeneration:this.scheduleAttendanceGeneration.get(query.date))===request&&this.token===token
    try{
      const fetcher=(url:string,init:RequestInit):Promise<Response>=>this.school.fetch(url,init)
      const current=this.state.moduleSnapshot
      const modules=current&&current.term.academicYear===query.term.academicYear&&current.term.semester===query.term.semester?current:await fetchModuleSnapshot(token,query.term,fetcher)
      if(!valid())return
      const enrolled=new Set(modules.modules.map(m=>m.code.toUpperCase()))
      const codes=[...new Set(query.moduleCodes.map(code=>code.toUpperCase()))].filter(code=>enrolled.has(code))
      const results=await Promise.allSettled(codes.map(code=>fetchModuleRecords(token,query,code,fetcher)))
      if(!valid())return
      const failed=results.flatMap((r,i)=>r.status==='rejected'?[codes[i]]:[])
      const missing=query.moduleCodes.filter(code=>!enrolled.has(code.toUpperCase()))
      const records=results.flatMap(r=>r.status==='fulfilled'?r.value:[])
      // Failed courses retain only their own previous Module records, never the
      // homepage timetable status. The issue explicitly marks that stale data.
      records.push(...cached.filter(r=>failed.includes(r.moduleCode)))
      const issue=[missing.length?`AMS Module 中未找到课程：${missing.join('、')}。`:'',failed.length?`以下课程的单节考勤未更新：${failed.join('、')}。`:''].filter(Boolean).join(' ')
      publish({...query,records,fetchedAt:failed.length===codes.length&&codes.length?(same?previous.fetchedAt:null):new Date().toISOString(),loading:false,issue:issue||null})
      if(process.argv.includes('--inspect-home'))console.log('AMS_MODULE_ATTENDANCE',JSON.stringify({view:target,courses:codes.length,records:records.length,failed:failed.length,statuses:records.map(r=>r.attendance)}))
    }catch(error){
      if(valid())publish({...query,records:cached,fetchedAt:same?previous.fetchedAt:null,loading:false,issue:error instanceof AmsError?error.message:'Module 单节考勤读取失败，请重试。'})
    }
  }

  async loadScheduleAttendance(input:unknown,ebridge:EbridgeState):Promise<void> {
    const date=moduleAttendanceQuerySchema.shape.date.parse(input)
    if(!amsRelativeDays().some(day=>day.date===date))throw new AmsError('schema','请选择今天、昨天或明天。')
    if(!this.token)throw new AmsError('auth','请先连接 AMS 后再读取签到记录。')
    const day=ebridgeTimetableForDate(ebridge,date)
    if(!day.known||!ebridge.timetableTerm)throw new AmsError('schema',day.message??'请先刷新 eBridge Timetable。')
    const term={academicYear:ebridge.timetableTerm.year,semester:`SEM${ebridge.timetableTerm.semester}`}
    const moduleCodes=[...new Set(day.rows.map(session=>session.code))].sort()
    const home=this.state.moduleAttendance
    if(home?.date===date&&home.term.academicYear===term.academicYear&&home.term.semester===term.semester&&!home.loading&&!home.issue&&home.fetchedAt&&home.fetchedAt>=(this.state.fetchedAt??'')&&moduleCodes.every(code=>home.moduleCodes.includes(code))){
      this.update({scheduleAttendance:{...this.state.scheduleAttendance,[date]:{...structuredClone(home),moduleCodes}}})
      return
    }
    await this.loadModuleAttendance({date,term,moduleCodes},'schedule')
  }

  async openSource(): Promise<void> {
    if (this.state.phase === 'verification-required') return this.showLogin()
    this.beginLogin(true, AMS_SOURCE)
  }
  async openModuleSource(): Promise<void> { this.beginLogin(true, AMS_MODULE_SOURCE) }

  async clearSession(): Promise<void> {
    this.generation++
    this.credentialGeneration++
    this.authenticating = false
    this.stopWatch()
    this.pending = null
    this.token = ''
    this.currentTerm = null
    this.selectedTerm = null
    this.login?.destroy()
    this.login = null
    await this.school.clearStorageData()
    await this.school.clearCache()
    this.state = initialState()
    this.update({ message: 'AMS 会话和课表已清除；学校账号仍由首页统一管理。' })
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    this.credentialGeneration++
    this.authenticating = false
    this.stopWatch()
    this.token = ''
    this.login?.destroy()
    this.login = null
  }
}
