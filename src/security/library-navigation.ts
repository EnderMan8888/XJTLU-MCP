import { LIBRARY_ORIGIN } from '../shared/library.ts'
import { isAuthenticationOrigin } from './login-policy.ts'

// The library can redirect to the university's access portal before its SSO.
const TRUST_ORIGIN = 'https://trust.xjtlu.edu.cn'

export function isLibraryLoginNavigation(raw: string): boolean {
  if (isAuthenticationOrigin(raw)) return true
  try {
    const url = new URL(raw)
    return !url.username && !url.password && (url.origin === LIBRARY_ORIGIN || url.origin === TRUST_ORIGIN)
  } catch { return false }
}
