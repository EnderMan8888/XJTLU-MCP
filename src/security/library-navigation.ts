const SCHOOL_DOMAIN = 'xjtlu.edu.cn'

// Navigation may cross school services. The login policy separately controls credential entry.
export function isLibraryLoginNavigation(raw: string): boolean {
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/\.$/, '')
    return url.protocol === 'https:' && !url.username && !url.password
      && (host === SCHOOL_DOMAIN || host.endsWith(`.${SCHOOL_DOMAIN}`))
  } catch { return false }
}

export function libraryNavigationLabel(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' || url.protocol === 'http:') return `${url.protocol}//${url.host}`
    if (url.protocol === 'about:' && url.pathname === 'blank') return 'about:blank'
    return url.protocol.slice(0, 32)
  } catch { return null }
}
