import type { SavedCredentials } from '../shared/credentials.ts'

const authenticationOrigins = ['https://uim.xjtlu.edu.cn', 'https://sso.xjtlu.edu.cn']
const uimLoginOrigin = authenticationOrigins[0]
const uimLoginPath = '/esc-sso/login/page'
const onUimLoginPage = `location.origin === ${JSON.stringify(uimLoginOrigin)} && location.pathname === ${JSON.stringify(uimLoginPath)}`
export const SCHOOL_VERIFICATION_MESSAGE = '请在西浦官方窗口选择验证方式，输入短信、邮箱验证码或 OTP，再按学校页面提交。'

export function isCredentialPage(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.origin === uimLoginOrigin && url.pathname === uimLoginPath && !url.username && !url.password
  } catch { return false }
}

export function isAuthenticationOrigin(raw: string): boolean {
  try { const url = new URL(raw); return authenticationOrigins.includes(url.origin) && !url.username && !url.password } catch { return false }
}

// These form containers and button class were observed in UIM's public
// accountPsw.js. Inspect only visible DOM; return classifications, never page
// text, passwords, challenge codes, or application internals.
const domInspection = String.raw`
  const shown = element => {
    if (!element || element.hidden || !element.getBoundingClientRect().width || !element.getBoundingClientRect().height) return false;
    const visibility = getComputedStyle(element).visibility;
    return visibility !== 'hidden' && visibility !== 'collapse';
  };
  const inputs = [...document.querySelectorAll('input')].filter(shown);
  const bodyText = (document.body?.innerText || '').slice(0, 12000);
  const riskyLogin = /异地登[录錄]|异常登[录錄]|风险登[录錄]|登[录錄]风险|二次(?:认证|验证)|二步验证|(?:risky|suspicious|abnormal|unusual)\s+(?:log\s*in|sign[ -]?in)|(?:log\s*in|sign[ -]?in)\s+from\s+(?:a\s+)?(?:new|different|unusual)\s+(?:location|device)|(?:secondary|multi[- ]factor)\s+authenticat/i.test(bodyText);
  const challenge = riskyLogin || inputs.some(input => input.autocomplete === 'one-time-code' || /captcha|otp|(?:verify|validate|verification|security|sms|email)[-_ ]?code|验证码|动态码|短信/i.test([input.name, input.id, input.placeholder, input.getAttribute('aria-label')].join(' '))) ||
    [...document.querySelectorAll('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"], [class*="geetest"], [class*="yidun"], [class*="turnstile"]')].some(shown) ||
    /验证码|动态口令|身份验证|二次验证|安全验证|人机验证|拖动.{0,5}滑块|verification code|one.time (?:code|password)|authenticator|two.(?:factor|step)|verify your identity|verify you are human|security verification|短信验证/i.test(bodyText);
  const loginError = /(?:incorrect|invalid).{0,24}(?:password|credentials|account)|用户名或密码|密码(?:错误|不正确)|账号.{0,8}(?:锁定|不存在)|account.{0,20}locked|authentication failed/i.test(bodyText);
  const uncheckedConsent = [...document.querySelectorAll('.para-widget-account-psw__agreement input[type="checkbox"]')].some(input => shown(input) && !input.checked);
  const users = [...document.querySelectorAll('.para-widget-account-psw__input--account input')].filter(shown);
  const passwords = [...document.querySelectorAll('.para-widget-account-psw__input--psw input[type="password"]')].filter(shown);
  const buttons = [...document.querySelectorAll('button.para-widget-account-psw__login-button')].filter(shown);
  const classify = () => challenge || uncheckedConsent ? 'verification-required' : loginError ? 'login-error' : users.length === 1 && passwords.length === 1 && buttons.length === 1 ? 'credentials' : 'waiting';
`

// UIM's accountPsw widget adds this container when the remembered username
// is shown in a disabled input. Use the school's switch control without reading
// the underlying saved account or trying to match its masked display.
const rememberedAccountInspection = String.raw`
  const rememberedAccountControl = () => {
    if (users.length !== 1 || passwords.length !== 1 || buttons.length !== 1 || !(users[0].disabled || users[0].readOnly)) return null;
    const containers = [...document.querySelectorAll('.para-widget-switch-account-content')].filter(shown);
    if (containers.length !== 1) return null;
    const matches = element => shown(element) && /^(?:switch accounts?|切换[账帐]号|切換[賬帳]號)$/i.test((element.textContent || '').trim().replace(/\s+/g, ' '));
    const controls = [...containers[0].querySelectorAll('a, button, [role="button"]')].filter(matches);
    if (controls.length === 1) return controls[0];
    if (controls.length) return null;
    const labels = [...containers[0].querySelectorAll('*')].filter(element => !element.children.length && matches(element));
    return labels.length === 1 ? labels[0] : null;
  };
`

export function buildLoginInspectionScript(checkRememberedAccount = false): string {
  return `(() => {
    if (!${JSON.stringify(authenticationOrigins)}.includes(location.origin)) return 'other-page';
    ${domInspection}
    ${checkRememberedAccount ? rememberedAccountInspection : ''}
    const state = classify();
    ${checkRememberedAccount ? `if (state === 'credentials' && (${onUimLoginPage}) && rememberedAccountControl()) return 'remembered-account';` : ''}
    return state;
  })()`
}

export function buildSwitchRememberedAccountScript(): string {
  return `(() => {
    if (!(${onUimLoginPage})) return 'wrong-page';
    ${domInspection}
    ${rememberedAccountInspection}
    const state = classify();
    if (state !== 'credentials') return state;
    const control = rememberedAccountControl();
    if (!control) return 'waiting';
    if (passwords[0].value || control.disabled || control.getAttribute('aria-disabled') === 'true') return 'form-unavailable';
    control.click();
    return 'switched-account';
  })()`
}

export function buildAutomaticLoginScript(credentials: SavedCredentials, attempt: string): string {
  return `(async () => {
    if (!(${onUimLoginPage})) return 'wrong-page';
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
    if (!(${onUimLoginPage})) return 'wrong-page';
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
