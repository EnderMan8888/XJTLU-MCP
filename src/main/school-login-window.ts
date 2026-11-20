import type { BrowserWindow } from 'electron'

export function showSchoolLoginWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function isAbortedNavigation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED'
}
