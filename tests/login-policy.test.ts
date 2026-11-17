import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { buildAutomaticLoginScript, buildLoginInspectionScript, isAuthenticationOrigin, isCredentialPage } from '../src/security/login-policy.ts'

class TestElement {
  hidden = false
  disabled = false
  readOnly = false
  className = ''
  name = ''
  id = ''
  placeholder = ''
  autocomplete = ''
  checked = false
  getBoundingClientRect(): { width: number; height: number } { return { width: 100, height: 20 } }
}
class TestInput extends TestElement {
  private current = ''
  events: string[] = []
  get value(): string { return this.current }
  set value(value: string) { this.current = value }
  dispatchEvent(event: { type: string }): void { this.events.push(event.type) }
}
class TestButton extends TestElement {
  clicks = 0
  getAttribute(): string | null { return null }
  click(): void { this.clicks++ }
}

function fixture() {
  const username = new TestInput(), password = new TestInput(), button = new TestButton()
  const extra: TestInput[] = [], consents: TestElement[] = []
  const context = {
    location: { origin: 'https://uim.xjtlu.edu.cn', pathname: '/esc-sso/login/page' },
    document: {
      body: { innerText: 'XJTLU Authentication Centre Account Sign in' },
      querySelectorAll(selector: string): TestElement[] {
        if (selector === 'input') return [username, password, ...extra]
        if (selector.includes('__input--account')) return [username]
        if (selector.includes('__input--psw')) return [password]
        if (selector.startsWith('button.')) return [button]
        if (selector.includes('__agreement')) return consents
        return []
      }
    },
    HTMLInputElement: TestInput,
    Event: class { type: string; constructor(type: string) { this.type = type } },
    setTimeout: ((callback: () => void) => { queueMicrotask(callback) }) as unknown as typeof setTimeout
  }
  return { username, password, button, extra, consents, context }
}
const saved = { username: 'synthetic-account', password: 'synthetic-password' }

describe('automatic school login', () => {
  it('allows password submission only on the exact HTTPS login page', () => {
    assert.equal(isCredentialPage('https://uim.xjtlu.edu.cn/esc-sso/login/page?lang=en'), true)
    for (const url of ['http://uim.xjtlu.edu.cn/esc-sso/login/page', 'https://uim.xjtlu.edu.cn.evil.example/esc-sso/login/page', 'https://ams.xjtlu.edu.cn/esc-sso/login/page', 'https://uim.xjtlu.edu.cn/other', 'https://user:password@uim.xjtlu.edu.cn/esc-sso/login/page', 'invalid']) assert.equal(isCredentialPage(url), false)
    assert.equal(isAuthenticationOrigin('https://uim.xjtlu.edu.cn/mfa'), true)
    assert.equal(isAuthenticationOrigin('https://uim.xjtlu.edu.cn.evil.example/mfa'), false)
  })

  it('fills the stored account and clicks the real login button once', async () => {
    const { username, password, button, context } = fixture()
    const isolated = vm.createContext(context)
    assert.equal(await vm.runInContext(buildAutomaticLoginScript(saved, 'attempt-1'), isolated), 'submitted')
    assert.equal(username.value, saved.username)
    assert.equal(password.value, saved.password)
    assert.deepEqual(password.events, ['input', 'change'])
    assert.equal(button.clicks, 1)
    assert.equal(await vm.runInContext(buildAutomaticLoginScript(saved, 'attempt-1'), isolated), 'already-submitted')
    assert.equal(button.clicks, 1)
  })

  it('escapes credentials as data instead of executing their contents', async () => {
    const { username, password, button, context } = fixture()
    const special = { username: 'synthetic " account', password: '\"); throw new Error("injected"); //' }
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(special, 'special'), context), 'submitted')
    assert.equal(username.value, special.username)
    assert.equal(password.value, special.password)
    assert.equal(button.clicks, 1)
  })

  it('returns before touching a form after navigation to a different origin', async () => {
    const { username, password, button, context } = fixture()
    context.location.origin = 'https://evil.example'
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(saved, 'wrong'), context), 'wrong-page')
    assert.equal(username.value, '')
    assert.equal(password.value, '')
    assert.equal(button.clicks, 0)
  })

  it('hands off verification codes without entering or submitting them', async () => {
    const { username, password, button, extra, context } = fixture()
    const otp = new TestInput(); otp.autocomplete = 'one-time-code'; extra.push(otp)
    assert.equal(vm.runInNewContext(buildLoginInspectionScript(), context), 'verification-required')
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(saved, 'otp'), context), 'verification-required')
    assert.equal(username.value, '')
    assert.equal(password.value, '')
    assert.equal(otp.value, '')
    assert.equal(button.clicks, 0)
  })

  it('detects a challenge that appears after filling, before submission', async () => {
    const { button, extra, context } = fixture()
    context.setTimeout = ((callback: () => void) => { const captcha = new TestInput(); captcha.placeholder = '验证码'; extra.push(captcha); callback() }) as unknown as typeof setTimeout
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(saved, 'late-challenge'), context), 'verification-required')
    assert.equal(button.clicks, 0)
  })

  it('does not accept an unchecked agreement on the user’s behalf', async () => {
    const { consents, button, context } = fixture()
    const consent = new TestElement(); consents.push(consent)
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(saved, 'agreement'), context), 'verification-required')
    assert.equal(consent.checked, false)
    assert.equal(button.clicks, 0)
  })

  it('stops on a visible login error instead of retrying the password', async () => {
    const { button, context } = fixture()
    context.document.body.innerText = 'Invalid password'
    assert.equal(vm.runInNewContext(buildLoginInspectionScript(), context), 'login-error')
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(saved, 'failed'), context), 'login-error')
    assert.equal(button.clicks, 0)
  })

  it('preserves a different account or password entered manually', async () => {
    const first = fixture(); first.username.value = 'other-account'
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(saved, 'other-account'), first.context), 'different-account')
    assert.equal(first.password.value, '')
    assert.equal(first.button.clicks, 0)
    const second = fixture(); second.password.value = 'manually-entered'
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(saved, 'other-password'), second.context), 'user-input')
    assert.equal(second.password.value, 'manually-entered')
    assert.equal(second.button.clicks, 0)
  })

  it('cancels submission when the saved account is deleted or changed', async () => {
    const { button, context } = fixture()
    const isolated = vm.createContext(context)
    context.setTimeout = ((callback: () => void) => { isolated.__xjtluLoginAttempt = null; callback() }) as unknown as typeof setTimeout
    assert.equal(await vm.runInContext(buildAutomaticLoginScript(saved, 'cancelled'), isolated), 'cancelled')
    assert.equal(button.clicks, 0)
  })

  it('respects a disabled login button', async () => {
    const { button, context } = fixture(); button.disabled = true
    assert.equal(await vm.runInNewContext(buildAutomaticLoginScript(saved, 'disabled'), context), 'form-unavailable')
    assert.equal(button.clicks, 0)
  })
})
