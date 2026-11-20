import { app, BrowserWindow, clipboard, ipcMain, net, protocol, safeStorage, session, shell } from 'electron'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AmsService } from './ams-service'
import { CredentialStore } from '../infrastructure/credential-store'
import { EbridgeCache } from '../infrastructure/ebridge-cache'
import type { CredentialActionResult } from '../shared/credentials'
import { AccountService } from '../services/account-service'
import { EbridgeService } from './ebridge-service'
import { LibraryService } from './library-service'
import { todayCourses } from '../shared/today-courses'
import { ebridgeTimetableForDate } from '../shared/ebridge-timetable'
import { amsRelativeDays } from '../shared/module-attendance'
import { CampusQueries } from '../mcp/campus-queries'
import { McpKeyStore } from '../infrastructure/mcp-key-store'
import { McpService } from './mcp-service'
import { codexPluginLink, inspectCodexPairing, inspectCodexPlugin, registerCodexMarketplace, saveCodexPairingKey } from './codex-plugin'
import { LmcService } from './lmc-service'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
const smoke = process.argv.includes('--smoke-test')
// Keep development credentials and Chromium files out of the repository.
app.setPath('userData', smoke ? resolve('.scratch/smoke-profile') : join(app.getPath('appData'), 'XJTLU-MCP-AMS'))
// Retain the existing profile identity so previously encrypted credentials and
// SSO state remain usable while the visible product becomes an aggregate app.
app.setName('XJTLU-MCP AMS')
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

if (!app.requestSingleInstanceLock()) app.quit()
else {
  let main: BrowserWindow | null = null
  let ams: AmsService
  let ebridge: EbridgeService
  let library: LibraryService
  let mcp: McpService
  let lmc: LmcService
  let ebridgeRefreshChecked=false
  let moduleAttendanceKey=''
  const syncTodayAttendance=():void=>{
    if(!ams||!ebridge)return
    const a=ams.getState(),e=ebridge.getState()
    if(a.phase!=='connected'||e.phase!=='connected'||!a.moduleSnapshot||!e.timetableAt||!e.timetableTerm)return
    const today=todayCourses(e,a)
    if(!today.known)return
    const query={date:today.date,term:{academicYear:e.timetableTerm.year,semester:`SEM${e.timetableTerm.semester}`},moduleCodes:[...new Set(today.rows.map(r=>r.code))].sort()}
    const key=JSON.stringify([query,e.timetableAt,a.moduleSnapshot.fetchedAt])
    if(key===moduleAttendanceKey)return
    moduleAttendanceKey=key
    void ams.loadModuleAttendance(query).catch(()=>console.error('Module attendance query could not complete.'))
  }
  let homeReported=false
  const reportToday=():void=>{
    if(!process.argv.includes('--inspect-home')||homeReported||!ams||!ebridge)return
    const a=ams.getState(),e=ebridge.getState()
    if(!e.timetableAt||!a.moduleAttendance||a.moduleAttendance.loading)return
    const today=todayCourses(e,a)
    console.log('HOME_TODAY',JSON.stringify({source:'AMS Module Detail',known:today.known,week:today.week,courses:today.rows.length,matched:today.rows.filter(r=>r.attendance!=='unmatched'&&r.attendance!=='unavailable').length,unmatched:today.rows.filter(r=>r.attendance==='unmatched').length,issue:a.moduleAttendance.issue}))
    console.log('TIMETABLE_ROOMS',JSON.stringify(amsRelativeDays().map(day=>{const result=ebridgeTimetableForDate(e,day.date);return {day:day.label,known:result.known,courses:result.rows.length,withRoom:result.rows.filter(row=>!!row.room).length}})))
    homeReported=true
  }
  const devUrl = process.env.ELECTRON_RENDERER_URL

  const trustedSender = (event: Electron.IpcMainInvokeEvent): void => {
    const frame = event.senderFrame
    if (!main || event.sender !== main.webContents || frame !== main.webContents.mainFrame ||
      (devUrl ? new URL(frame.url).origin !== new URL(devUrl).origin : !frame.url.startsWith('app://desktop/'))) {
      throw new Error('Unsupported caller')
    }
  }

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    const root = resolve(here, '../renderer')
    protocol.handle('app', async (request) => {
      try {
        const url = new URL(request.url)
        if (url.hostname !== 'desktop' || request.method !== 'GET') return new Response(null, { status: 403 })
        const file = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`)
        if (!file.startsWith(root + sep)) return new Response(null, { status: 403 })
        const response = await net.fetch(pathToFileURL(file).href)
        const headers = new Headers(response.headers)
        headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        return new Response(response.body, { status: response.status, headers })
      } catch { return new Response(null, { status: 404 }) }
    })

    const userData = app.getPath('userData')
    const localCrypto = {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (plaintext: string) => safeStorage.encryptStringAsync(plaintext),
      decrypt: async (ciphertext: Buffer) => (await safeStorage.decryptStringAsync(ciphertext)).result
    }
    const store = new CredentialStore(userData, localCrypto)
    const account = new AccountService(store, (status) => { if (main && !main.isDestroyed()) main.webContents.send('account:changed', status) })
    const credentialAction = async (operation: () => Promise<void>): Promise<CredentialActionResult> => {
      try { await operation(); return { ok: true, message: '已完成。', status: await account.status() } }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : '操作未完成，请重试。', status: await account.status() } }
    }
    ams = new AmsService((state) => { if (main && !main.isDestroyed()) main.webContents.send('ams:state', state);syncTodayAttendance();reportToday() }, account)
    account.subscribe(ams)
    ebridge = new EbridgeService((state) => {
      if (main && !main.isDestroyed()) main.webContents.send('ebridge:state', state)
      syncTodayAttendance();reportToday()
      if(process.argv.includes('--check-ebridge-refresh')&&state.phase==='connected'&&!ebridgeRefreshChecked){ebridgeRefreshChecked=true;setTimeout(()=>{void ebridge.refresh().catch(()=>console.error('eBridge refresh check failed.'))},0)}
    }, account, process.argv.includes('--inspect-ebridge'), new EbridgeCache(userData, localCrypto))
    account.subscribe(ebridge)
    await ebridge.restoreLocalCache()
    library = new LibraryService((state) => { if (main && !main.isDestroyed()) main.webContents.send('library:state',state) },account,process.argv.includes('--inspect-library'))
    account.subscribe(library)
    lmc = new LmcService(state => { if (main && !main.isDestroyed()) main.webContents.send('lmc:state', state) }, account)
    account.subscribe(lmc)
    const queries = new CampusQueries({ ams, ebridge, library, lmc })
    account.subscribe({
      cancelAccountAutomation: async () => { queries.cancelPending() },
      accountChanged: (previous, current) => { if (previous.username && current.username && previous.username !== current.username) queries.invalidate() }
    })
    mcp = new McpService(queries, new McpKeyStore(app.getPath('userData'), {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: value => safeStorage.encryptStringAsync(value),
      decrypt: async value => (await safeStorage.decryptStringAsync(value)).result
    }), app.getVersion(), state => { if (main && !main.isDestroyed()) main.webContents.send('mcp:state', state) })
    const handlers = {
      'lmc:get-state': () => lmc.getState(),
      'lmc:connect': () => lmc.connect(),
      'lmc:refresh': () => lmc.refresh(),
      'lmc:show-login': () => lmc.showLogin(),
      'lmc:disconnect': () => lmc.disconnect(),
      'lmc:load-course': (id: unknown) => lmc.loadCourse(id),
      'lmc:load-folder': (id: unknown) => lmc.loadFolder(id),
      'lmc:notifications': (more: unknown) => lmc.loadNotifications(z.boolean().parse(more)),
      'lmc:download': (id: unknown) => lmc.download(id),
      'lmc:cancel-download': (id: unknown) => lmc.cancelDownload(id),
      'lmc:reveal-download': (id: unknown) => lmc.revealDownload(id),
      'lmc:open-source': (value: unknown) => lmc.openSource(z.union([z.object({ kind: z.literal('home') }).strict(), z.object({ kind: z.enum(['course', 'activity', 'notification']), id: z.string().min(1).max(200) }).strict()]).parse(value)),
      'mcp:get-status': () => mcp.getStatus(),
      'mcp:get-codex-plugin-status': async () => {
        const [plugin, pairing] = await Promise.all([inspectCodexPlugin(app.getAppPath()), mcp.inspectCodexPairing(inspectCodexPairing)])
        return { ...plugin, pairing }
      },
      'mcp:open-codex-plugin': async () => {
        const link = await codexPluginLink(app.getAppPath())
        await mcp.pairCodex(saveCodexPairingKey)
        await registerCodexMarketplace(app.getAppPath())
        await shell.openExternal(link)
      },
      'mcp:copy-config': (value: unknown) => { if (value !== 'json' && value !== 'codex' && value !== 'token') throw new Error('Unsupported configuration'); mcp.copyConfig(value, text => clipboard.writeText(text)) },
      'mcp:set-enabled': (value: unknown) => { if (typeof value !== 'boolean') throw new Error('Unsupported setting'); return mcp.setEnabled(value) },
      'mcp:rotate-key': () => mcp.rotateKey(),
      'ams:get-state': () => ams.getState(),
      'ams:open-login': () => ams.openLogin(),
      'ams:refresh': () => ams.refresh(),
      'ams:clear-session': () => ams.clearSession(),
      'ams:open-source': () => ams.openSource(),
      'ams:open-module-source': () => ams.openModuleSource(),
      'ams:reconnect': () => ams.reconnect(),
      'ams:show-login': () => ams.showLogin(),
      'ams:set-term': (value: unknown) => ams.setTerm(value),
      'ams:load-schedule-attendance': (value:unknown) => ams.loadScheduleAttendance(value,ebridge.getState()),
      'ebridge:get-state': () => ebridge.getState(),
      'ebridge:connect': () => ebridge.connect(),
      'ebridge:refresh': () => ebridge.refresh(),
      'ebridge:local-cache': (value: unknown) => ebridge.setLocalCache(z.boolean().parse(value)),
      'ebridge:grades': () => ebridge.loadGrades(),
      'ebridge:grade-source': (value: unknown) => ebridge.openGradeSource(z.enum(['components', 'records']).parse(value)),
      'ebridge:show-login': () => ebridge.showLogin(),
      'ebridge:open-source': (value: unknown) => { if (value !== 'courses' && value !== 'timetable' && value !== 'exams' && value !== 'grades') throw new Error('Unsupported view'); return ebridge.openSource(value) },
      'ebridge:disconnect': () => ebridge.disconnect(),
      'library:get-state': () => library.getState(),
      'library:refresh': () => library.refresh(),
      'library:connect': () => library.connect(),
      'library:show-login': () => library.showLogin(),
      'library:search': (value:unknown) => library.searchSeats(value),
      'library:prepare': (value:unknown) => library.prepareBooking(value),
      'library:submit': (value:unknown) => { if(!value||typeof value!=='object'||!('id'in value)||!('acceptedNotice'in value)||!('captcha'in value))throw new Error('Unsupported booking');return library.submitBooking(value.id,value.acceptedNotice,value.captcha) },
      'library:agent-review': (id:unknown) => library.agentBookings.review(z.uuid().parse(id)),
      'library:agent-cancel': (id:unknown) => library.agentBookings.cancel(z.uuid().parse(id)),
      'library:agent-submit': (value:unknown) => {
        const {requestId,draftId,acceptedNotice,captcha}=z.object({requestId:z.uuid(),draftId:z.uuid(),acceptedNotice:z.boolean(),captcha:z.string().max(1000)}).strict().parse(value)
        return library.agentBookings.submit(requestId,draftId,acceptedNotice,captcha)
      },
      'library:captcha': () => library.getCaptcha(),
      'library:reservations': () => library.getReservations(),
      'library:open-source': () => library.openSource(),
      'account:get-status': () => account.status(),
      'account:save': (value: unknown) => credentialAction(() => account.save(value)),
      'account:forget': () => credentialAction(() => account.forget())
    }
    for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, value: unknown) => { trustedSender(event); return handler(value) })

    main = new BrowserWindow({
      title: 'XJTLU-MCP · 校园信息中心', width: 1220, height: 860, minWidth: 940, minHeight: 680,
      backgroundColor: '#f6f7fb', autoHideMenuBar: true,
      webPreferences: { preload: join(here, '../preload/index.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
    // The academic connectors may own hidden windows. Closing the workbench
    // must quit those too, otherwise a later start targets a destroyed window.
    main.on('closed', () => { main = null; app.quit() })
    main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    main.webContents.on('will-navigate', (event) => event.preventDefault())
    if (devUrl) await main.loadURL(devUrl)
    else await main.loadURL('app://desktop/index.html')
    main.show()
    main.focus()
    void mcp.setEnabled(true)
    if (smoke) main.setTitle('XJTLU-MCP · UI 测试')
    if (!smoke && !process.argv.includes('--inspect-lmc')) void ams.openLogin().catch(() => console.error('AMS initial connection failed.'))
    if (!smoke && !process.argv.includes('--inspect-lmc')) void ebridge.connect().catch(() => console.error('eBridge initial connection failed.'))
    if (!smoke && process.argv.includes('--connect-lmc')) void lmc.connect().catch(() => console.error('LMC connection failed.'))
    if (!smoke && process.argv.includes('--read-library')) void library.refresh().catch(() => console.error('Library query failed.'))
    if (!smoke && process.argv.includes('--connect-library')) void library.connect().catch(() => console.error('Library connection failed.'))
  }).catch(() => { console.error('The desktop application could not start.'); app.quit() })

  app.on('second-instance', () => { if (main && !main.isDestroyed()) { main.show(); main.focus() } })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => { void mcp?.dispose(); lmc?.dispose(); ams?.dispose(); ebridge?.dispose(); library?.dispose() })
}
