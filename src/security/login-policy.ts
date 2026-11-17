import type { SavedCredentials } from '../shared/credentials.ts'

export function isCredentialPage(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.origin === 'https://uim.xjtlu.edu.cn' && url.pathname === '/esc-sso/login/page' && !url.username && !url.password
  } catch { return false }
}

export function isAuthenticationOrigin(raw: string): boolean {
  try { const url = new URL(raw); return url.origin === 'https://uim.xjtlu.edu.cn' && !url.username && !url.password } catch { return false }
}

// These form containers and button class were observed in UIM's public
// accountPsw.js. Inspect only visible DOM; return classifications, never page
// text, passwords, challenge codes, or application internals.
const domInspection = `
  const shown = element => !!element && !element.hidden && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const inputs = [...document.querySelectorAll('input')].filter(shown);
  const bodyText = (document.body?.innerText || '').slice(0, 12000);
  const challenge = inputs.some(input => input.autocomplete === 'one-time-code' || /captcha|otp|verification.?code|security.?code|验证码|动态码|短信/i.test([input.name, input.id, input.placeholder].join(' '))) ||
    [...document.querySelectorAll('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"], [class*="geetest"], [class*="yidun"], [class*="turnstile"]')].some(shown) ||
    /验证码|动态口令|身份验证|二次验证|安全验证|人机验证|拖动.{0,5}滑块|verification code|one.time (?:code|password)|authenticator|two.(?:factor|step)|verify your identity|verify you are human|security verification|短信验证/i.test(bodyText);
  const loginError = /(?:incorrect|invalid).{0,24}(?:password|credentials|account)|用户名或密码|密码(?:错误|不正确)|账号.{0,8}(?:锁定|不存在)|account.{0,20}locked|authentication failed/i.test(bodyText);
  const uncheckedConsent = [...document.querySelectorAll('.para-widget-account-psw__agreement input[type="checkbox"]')].some(input => shown(input) && !input.checked);
  const users = [...document.querySelectorAll('.para-widget-account-psw__input--account input')].filter(shown);
  const passwords = [...document.querySelectorAll('.para-widget-account-psw__input--psw input[type="password"]')].filter(shown);
  const buttons = [...document.querySelectorAll('button.para-widget-account-psw__login-button')].filter(shown);
  const classify = () => challenge || uncheckedConsent ? 'verification-required' : loginError ? 'login-error' : users.length === 1 && passwords.length === 1 && buttons.length === 1 ? 'credentials' : 'waiting';
`

export function buildLoginInspectionScript(): string {
  return `(() => {
    if (location.origin !== 'https://uim.xjtlu.edu.cn') return 'other-page';
    ${domInspection}
    return classify();
  })()`
}

export function buildAutomaticLoginScript(credentials: SavedCredentials, attempt: string): string {
  return `(async () => {
    if (location.origin !== 'https://uim.xjtlu.edu.cn' || location.pathname !== '/esc-sso/login/page') return 'wrong-page';
    const attempt = ${JSON.stringify(attempt)};
    globalThis.__xjtluLoginAttempt = attempt;
    if (globalThis.__xjtluSubmittedAttempt === attempt) return 'already-submitted';
    ${domInspection}
    const state = classify();
    if (state !== 'credentials') return state;
    const credentials = ${JSON.stringify(credentials)};
    const username = users[0], password = passwords[0], button = buttons[0];
    if (username.value && username.value !== credentials.username) return 'different-account';
    if (password.value && password.value !== credentials.password) return 'user-input';
    if ((username.disabled || username.readOnly) && username.value !== credentials.username) return 'form-unavailable';
    if (password.disabled || password.readOnly) return 'form-unavailable';
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [input, value] of [[username, credentials.username], [password, credentials.password]]) {
      if (input.value !== value) {
        set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    if (globalThis.__xjtluLoginAttempt !== attempt) return 'cancelled';
    if (location.origin !== 'https://uim.xjtlu.edu.cn' || location.pathname !== '/esc-sso/login/page') return 'wrong-page';
    { ${domInspection}
      const current = classify();
      if (current !== 'credentials') return current;
    }
    if (username.value !== credentials.username || password.value !== credentials.password) return 'user-input';
    if (button.disabled || button.getAttribute('aria-disabled') === 'true' || /disabled|loading/.test(button.className)) return 'form-unavailable';
    // Use the school's real button and its validation/encryption logic. Do not
    // synthesize login API requests or accept verification/consent controls.
    globalThis.__xjtluSubmittedAttempt = attempt;
    button.click();
    return 'submitted';
  })()`
}
