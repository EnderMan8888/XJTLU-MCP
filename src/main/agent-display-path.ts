import { win32 } from 'node:path'

interface AgentDisplayRoots {
  appPath: string
  appData: string
  localAppData?: string
  userProfile: string
}

export function agentDisplayPath(filePath: string, roots: AgentDisplayRoots): string {
  if (!win32.isAbsolute(filePath)) return '自定义位置'

  // Keep account names and machine-specific paths out of the status page.
  const displayRoots = [
    ['程序目录', roots.appPath],
    ['%APPDATA%', roots.appData],
    ['%LOCALAPPDATA%', roots.localAppData],
    ['%USERPROFILE%', roots.userProfile]
  ] as const

  for (const [label, root] of displayRoots) {
    if (!root || !win32.isAbsolute(root)) continue
    const suffix = win32.relative(root, filePath)
    if (!suffix) return label
    if (suffix !== '..' && !suffix.startsWith('..\\') && !win32.isAbsolute(suffix)) {
      return `${label}\\${suffix}`
    }
  }
  return '自定义位置'
}
