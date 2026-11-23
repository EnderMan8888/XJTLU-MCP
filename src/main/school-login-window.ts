import type { BrowserWindow } from 'electron'

export const SCHOOL_MANUAL_LOGIN_MESSAGE = '请在西浦官方窗口手动登录。成功后工作台会自动连接。'
export function schoolLoginFailure(message: string, manual: boolean): string {
  return `${message}${manual ? '请在官方窗口核对提示。' : '请点击“手动登录”。'}`
}

export function showSchoolLoginWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function isAbortedNavigation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED'
}
