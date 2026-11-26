import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAMPUS_MAIL_URL, isMailNavigation, outlookMailErrorStatus } from '../src/security/mail-navigation.ts'
import { isCampusMailLoginPage, isMicrosoftMailLoginPage, microsoftMailAddress } from '../src/security/mail-login.ts'

test('mail windows follow regular web redirects, including new sign-in origins', () => {
  for (const url of [
    CAMPUS_MAIL_URL,
    'https://mail.xjtlu.edu.cn/owa/',
    'https://login.microsoftonline.com/common/oauth2/authorize',
    'https://login.microsoft.com/',
    'https://login.windows.net/',
    'https://login.live.com/',
    'https://mysignins.microsoft.com/security-info',
    'https://device.login.microsoftonline.com/',
    'https://outlook.office.com/mail/',
    'https://outlook.office365.com/mail/',
    'https://outlook.cloud.microsoft/mail/',
    'https://sso.xjtlu.edu.cn/',
    'https://uim.xjtlu.edu.cn/esc-sso/login/page',
    'https://trust.xjtlu.edu.cn/',
    'https://example-for-test.xjtlu.edu.cn/',
    'https://tenant.example.org:8443/sso/',
    'http://example.org/',
    'about:blank'
  ]) assert.equal(isMailNavigation(url), true, url)
})

test('mail navigation only opens ordinary websites and blank popups', () => {
  for (const url of [
    'https://mail.xjtlu.edu.cn@example.org/',
    'https://someone@mail.xjtlu.edu.cn/',
    'blob:https://mail.xjtlu.edu.cn/example',
    'file:///example',
    'javascript:void 0',
    'data:text/html,example',
    'not a URL'
  ]) assert.equal(isMailNavigation(url), false, url)
})

test('the password policy remains limited to the official HTTPS OWA login page', () => {
  const path = '/owa/auth/logon.aspx'
  assert.equal(isCampusMailLoginPage(`https://mail.xjtlu.edu.cn${path}?reason=0`), true)
  assert.equal(isCampusMailLoginPage(CAMPUS_MAIL_URL), false)
  assert.equal(isCampusMailLoginPage(`http://mail.xjtlu.edu.cn${path}`), false)
  assert.equal(isCampusMailLoginPage(`https://mail.xjtlu.edu.cn.example.org${path}`), false)
  assert.equal(isCampusMailLoginPage(`https://login.microsoftonline.com${path}`), false)
})

test('Microsoft username prefill applies only to the campus mailbox flow', () => {
  const authorize = new URL('https://login.microsoftonline.com/common/oauth2/authorize')
  assert.equal(isMicrosoftMailLoginPage(authorize), false)
  authorize.searchParams.set('redirect_uri', 'https://mail.xjtlu.edu.cn/owa/')
  assert.equal(isMicrosoftMailLoginPage(authorize), true)
  authorize.searchParams.set('redirect_uri', 'https://mail.xjtlu.edu.cn.example.org/owa/')
  assert.equal(isMicrosoftMailLoginPage(authorize), false)
  assert.equal(microsoftMailAddress('Example.Student25'), 'Example.Student25@student.xjtlu.edu.cn')
  assert.equal(microsoftMailAddress('Example.Staff@xjtlu.edu.cn'), 'Example.Staff@xjtlu.edu.cn')
  assert.equal(microsoftMailAddress('private@example.com'), null)
})

test('recognizes Outlook error documents without trusting error parameters on other sites', () => {
  assert.equal(outlookMailErrorStatus('https://outlook.office365.com/mail/olkerror.html?httpCode=404'), 404)
  assert.equal(outlookMailErrorStatus('https://outlook.cloud.microsoft/mail/olkerror.html?httpCode=503'), 503)
  assert.equal(outlookMailErrorStatus('https://outlook.office365.com/mail/inbox?httpCode=404'), null)
  assert.equal(outlookMailErrorStatus('https://example.org/mail/olkerror.html?httpCode=404'), null)
  assert.equal(outlookMailErrorStatus('https://outlook.office365.com/mail/olkerror.html?httpCode=4040'), null)
})
