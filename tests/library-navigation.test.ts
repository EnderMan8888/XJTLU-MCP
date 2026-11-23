import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLibraryLoginNavigation, libraryNavigationLabel } from '../src/security/library-navigation.ts'
import { isAuthenticationOrigin, isCredentialPage } from '../src/security/login-policy.ts'

test('library navigation accepts HTTPS redirects across school services', () => {
  for (const url of [
    'https://xjtlu.edu.cn/',
    'https://seatbookings.xjtlu.edu.cn/#/ic/home',
    'https://trust.xjtlu.edu.cn/controller/v1/public/verify',
    'https://trust.xjtlu.edu.cn/portal/shortcut.html',
    'https://gateway.example-for-test.xjtlu.edu.cn:8443/auth',
    'https://sso.xjtlu.edu.cn/',
    'https://uim.xjtlu.edu.cn/esc-sso/login/page'
  ]) assert.equal(isLibraryLoginNavigation(url), true)
  assert.equal(isAuthenticationOrigin('https://trust.xjtlu.edu.cn/portal/shortcut.html'), false)
  assert.equal(isCredentialPage('https://trust.xjtlu.edu.cn/esc-sso/login/page'), false)
  assert.equal(isCredentialPage('https://uim.xjtlu.edu.cn:8443/esc-sso/login/page'), false)
  assert.equal(isCredentialPage('https://gateway.example-for-test.xjtlu.edu.cn/esc-sso/login/page'), false)
  assert.equal(isCredentialPage('https://uim.xjtlu.edu.cn/esc-sso/login/page'), true)
})

test('library navigation rejects insecure or impersonating access portals', () => {
  for (const url of [
    'http://trust.xjtlu.edu.cn/portal/shortcut.html',
    'https://trust.xjtlu.edu.cn.example.org/',
    'https://notxjtlu.edu.cn/',
    'https://name@trust.xjtlu.edu.cn/',
    'about:blank',
    'not a URL'
  ]) assert.equal(isLibraryLoginNavigation(url), false)
})

test('library navigation errors identify only the destination origin or protocol', () => {
  assert.equal(libraryNavigationLabel('https://someone:secret@example.org:8443/signed-path?code=private#session'), 'https://example.org:8443')
  assert.equal(libraryNavigationLabel('http://example.org/redirect'), 'http://example.org')
  assert.equal(libraryNavigationLabel('about:blank'), 'about:blank')
  assert.equal(libraryNavigationLabel('custom://private?id=secret'), 'custom:')
  assert.equal(libraryNavigationLabel('not a URL'), null)
})
