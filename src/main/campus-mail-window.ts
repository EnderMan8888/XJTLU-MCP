import { BrowserWindow, dialog, shell, type Session } from 'electron'
import { isMailNavigation, outlookMailErrorStatus } from '../security/mail-navigation'
import { showSchoolLoginWindow } from './school-login-window'

const MAIL_LOAD_TIMEOUT_MS = 20_000

function guardMailWindow(window: BrowserWindow, onBlockedRedirect: () => void): void {
  const contents = window.webContents
  const popups = new Set<BrowserWindow>()
  contents.on('will-navigate', event => {
    if (!isMailNavigation(event.url)) event.preventDefault()
  })
  contents.on('will-redirect', event => {
    if (!event.isMainFrame || isMailNavigation(event.url)) return
    event.preventDefault()
    onBlockedRedirect()
  })
  contents.setWindowOpenHandler(({ url }) => isMailNavigation(url)
    ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
    : { action: 'deny' })
  contents.on('did-create-window', popup => {
    popups.add(popup)
    popup.once('closed', () => popups.delete(popup))
    guardMailWindow(popup, onBlockedRedirect)
  })
  window.once('closed', () => {
    for (const popup of popups) {
      if (!popup.isDestroyed()) popup.destroy()
    }
  })
}

export function createCampusMailWindow(parent: BrowserWindow, mailSession: Session, entry: string,
  onPage: (window: BrowserWindow) => void, onFailure: (message: string) => void, background = false): BrowserWindow {

  const window = new BrowserWindow({
    parent, title: '西浦邮箱 · XJTLU-MCP', width: 1120, height: 780,
    autoHideMenuBar: true, show: false,
    webPreferences: { session: mailSession, nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  const { webContents } = window
  const closed = new AbortController()
  let loadTimeout: ReturnType<typeof setTimeout> | undefined
  window.once('closed', () => {
    clearTimeout(loadTimeout)
    closed.abort()
  })
  let showingFailure = false

  const showFailure = async (message: string): Promise<void> => {
    if (showingFailure || window.isDestroyed()) return
    showingFailure = true
    onFailure(message)
    if (!window.isVisible()) { window.destroy(); return }
    try {
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning', title: '西浦邮箱', message,
        detail: '可以重试登录，或在默认浏览器查看该入口是否可用。',
        buttons: ['重试', '在浏览器打开', '关闭'], defaultId: 0, cancelId: 2, noLink: true,
        signal: closed.signal
      })
      if (window.isDestroyed()) return
      showingFailure = false
      if (response === 0) openMail()
      else {
        if (response === 1) await shell.openExternal(entry)
        window.close()
      }
    } catch {
      if (!window.isDestroyed()) window.close()
    } finally {
      showingFailure = false
    }
  }

  function openMail(): void {
    clearTimeout(loadTimeout)
    const timeout = setTimeout(() => {
      if (window.isDestroyed()) return
      void showFailure('连接学校邮箱超时。')
      webContents.stop()
    }, MAIL_LOAD_TIMEOUT_MS)
    loadTimeout = timeout
    void window.loadURL(entry)
      .catch(() => { /* Navigation events report failures, including blocked redirects. */ })
      .finally(() => clearTimeout(timeout))
  }

  guardMailWindow(window, () => void showFailure('邮箱跳转使用了非网页协议。'))
  const outlookFailed = (url: string): boolean => {
    const status = outlookMailErrorStatus(url)
    if (status === null) return false
    void showFailure(`Outlook 返回了邮箱错误页（HTTP ${status}）。`)
    return true
  }
  webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    if (outlookFailed(url)) return
    const problem = code === -105 ? '域名解析失败' : [-100, -101].includes(code) ? '连接被关闭'
      : [-107, -113].includes(code) ? 'TLS 握手失败'
      : [-111, -130].includes(code) ? '网络代理连接失败' : '页面加载失败'
    void showFailure(`邮箱${problem}（${code}）。`)
  })
  webContents.on('did-navigate', (_event, url, httpStatusCode) => {
    if (outlookFailed(url)) return
    if (httpStatusCode === 417 || httpStatusCode >= 500) void showFailure(`邮箱入口当前无法访问（HTTP ${httpStatusCode}）。`)
  })
  // The sign-in page may load optional Outlook frames that do not finish with the main document.
  webContents.on('dom-ready', () => {
    clearTimeout(loadTimeout)
    if (!showingFailure) onPage(window)
  })
  webContents.on('render-process-gone', () => void showFailure('邮箱页面意外关闭。'))
  if (!background) showSchoolLoginWindow(window)
  openMail()
  return window
}
