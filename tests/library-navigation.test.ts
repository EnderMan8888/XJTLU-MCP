import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLibraryLoginNavigation } from '../src/security/library-navigation.ts'
import { isAuthenticationOrigin, isCredentialPage } from '../src/security/login-policy.ts'

test('library navigation accepts both steps of the school access check and the subsequent school login', () => {
  for (const url of [
    'https://seatbookings.xjtlu.edu.cn/#/ic/home',
    'https://trust.xjtlu.edu.cn/controller/v1/public/verify',
    'https://trust.xjtlu.edu.cn/portal/shortcut.html',
    'https://sso.xjtlu.edu.cn/',
    'https://uim.xjtlu.edu.cn/esc-sso/login/page'
  ]) assert.equal(isLibraryLoginNavigation(url), true)
  assert.equal(isAuthenticationOrigin('https://trust.xjtlu.edu.cn/portal/shortcut.html'), false)
  assert.equal(isCredentialPage('https://trust.xjtlu.edu.cn/esc-sso/login/page'), false)
  assert.equal(isCredentialPage('https://uim.xjtlu.edu.cn/esc-sso/login/page'), true)
})

test('library navigation rejects insecure or impersonating access portals', () => {
  for (const url of [
    'http://trust.xjtlu.edu.cn/portal/shortcut.html',
    'https://trust.xjtlu.edu.cn.example.org/',
    'https://other.xjtlu.edu.cn/',
    'https://trust.xjtlu.edu.cn:444/',
    'https://name@trust.xjtlu.edu.cn/',
    'about:blank',
    'not a URL'
  ]) assert.equal(isLibraryLoginNavigation(url), false)
})
