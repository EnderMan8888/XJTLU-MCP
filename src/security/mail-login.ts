import type { SavedCredentials } from '../shared/credentials.ts'
import { CAMPUS_MAIL_URL } from './mail-navigation.ts'

const origin = new URL(CAMPUS_MAIL_URL).origin
const logonPath = '/owa/auth/logon.aspx'
const formPath = '/owa/auth.owa'
const onLoginPage = `location.origin === ${JSON.stringify(origin)} && location.pathname.toLowerCase() === ${JSON.stringify(logonPath)}`
const microsoftOrigin = 'https://login.microsoftonline.com'
const authorizationPath = /^\/[a-z0-9.-]+\/oauth2\/(?:v2\.0\/)?authorize$/i
const mailboxCallbackPath = /^\/owa\/?$/i

export function isCampusMailLoginPage(raw: string): boolean {
  const url = URL.parse(raw)
  return !!url && url.origin === origin && url.pathname.toLowerCase() === logonPath && !url.username && !url.password
}

export function isMicrosoftMailLoginPage(url: URL): boolean {
  if (url.origin !== microsoftOrigin || url.username || url.password || !authorizationPath.test(url.pathname)) return false
  const callback = URL.parse(url.searchParams.get('redirect_uri') ?? '')
  return !!callback && callback.origin === origin && !callback.username && !callback.password && mailboxCallbackPath.test(callback.pathname)
}

export function microsoftMailAddress(username: string): string | null {
  const value = username.trim()
  if (/^[a-z][a-z0-9._-]*@(?:student\.)?xjtlu\.edu\.cn$/i.test(value)) return value
  return /^[a-z][a-z0-9._-]*$/i.test(value) ? `${value}@student.xjtlu.edu.cn` : null
}

export function buildMicrosoftMailAccountScript(address: string): string {
  return `(() => {
    if (location.origin !== ${JSON.stringify(microsoftOrigin)} || !${authorizationPath}.test(location.pathname)) return 'wrong-page';
    const page = new URL(location.href);
    const callback = URL.parse(page.searchParams.get('redirect_uri') || '');
    if (page.username || page.password || !callback || callback.origin !== ${JSON.stringify(origin)} ||
        callback.username || callback.password || !${mailboxCallbackPath}.test(callback.pathname)) return 'wrong-page';
    const shown = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
    if ([...document.querySelectorAll('input[autocomplete="one-time-code"], input[name="otc"], iframe[src*="captcha" i]')].some(shown)) return 'verification-required';
    if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return 'password-required';
    if (globalThis.__xjtluOutlookIdentifierSubmitted) return 'already-submitted';
    const fields = [...document.querySelectorAll('input[name="loginfmt"], input#i0116, input[type="email"][autocomplete="username"]')].filter(input =>
      ['email', 'text'].includes(input.type) && !input.disabled && !input.readOnly && shown(input));
    if (fields.length !== 1) return 'waiting';
    const [input] = fields;
    const address = ${JSON.stringify(address)};
    if (!input.value) {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setValue.call(input, address);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'filled';
    }
    if (input.value.trim().toLowerCase() !== address.toLowerCase()) return 'different-account';
    const button = document.querySelector('input#idSIButton9[type="submit"], button#idSIButton9[type="submit"]');
    if (!button || !shown(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return 'waiting';
    const label = (button.value || button.textContent || button.getAttribute('aria-label') || '').trim();
    if (!/^(Next|下一步)$/i.test(label)) return 'other-action';
    globalThis.__xjtluOutlookIdentifierSubmitted = true;
    button.click();
    return 'submitted';
  })()`
}

const inspectForm = String.raw`
  const shown = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
  const text = (document.body?.innerText || '').slice(0, 12000);
  const challenge = [...document.querySelectorAll('input,iframe,textarea,[id*="captcha" i]')].filter(shown).some(element =>
    element.autocomplete === 'one-time-code' || /captcha|verification.?code|security.?code|otpass|\botp\b|验证码/i.test(
      [element.id, element.name, element.title, element.placeholder, element.getAttribute('aria-label'), element.getAttribute('src')].join(' '))) ||
    /验证码|身份验证|二步验证|二次验证|verify your identity|verification code|two[ -](?:factor|step)/i.test(text);
  if (challenge) return 'verification-required';
  if (new URL(location.href).searchParams.get('reason') === '2' ||
      /(?:incorrect|invalid).{0,35}(?:password|credentials)|(?:username|password).{0,35}(?:incorrect|invalid)|用户名或密码|密码错误/i.test(text)) return 'login-error';
  const isSchoolForm = (value, method) => {
    const url = URL.parse(value, location.href);
    return method.toLowerCase() === 'post' && url?.origin === location.origin &&
      url.pathname.toLowerCase() === formPath && !url.username && !url.password;
  };
  const forms = [...document.forms].filter(form => isSchoolForm(form.action, form.method) && ['', '_self'].includes(form.target));
  if (forms.length !== 1) return 'waiting';
  const form = forms[0];
  const users = [...form.querySelectorAll('input[name="username"]')].filter(input => shown(input) && input.type === 'text');
  const passwords = [...form.querySelectorAll('input[name="password"][type="password"]')].filter(shown);
  const controls = [...form.querySelectorAll('button:not([type]),button[type="submit"],input[type="submit"],.signinbutton[onclick],.signinbutton[role="button"]')].filter(shown);
  if (users.length !== 1 || passwords.length !== 1 || controls.length !== 1) return 'waiting';
  const [username] = users, [password] = passwords, [button] = controls;
  const target = button.getAttribute('formtarget') ?? form.target;
  if (!['', '_self'].includes(target) || !isSchoolForm(button.getAttribute('formaction') ?? form.action, button.getAttribute('formmethod') ?? form.method)) return 'waiting';
  if (button.disabled || button.getAttribute('aria-disabled') === 'true' || username.disabled || username.readOnly || password.disabled || password.readOnly) return 'waiting';
  if ([...form.querySelectorAll('input[type="checkbox"][required]')].some(input => shown(input) && !input.checked)) return 'verification-required';
`

export function buildCampusMailLoginScript(credentials?: SavedCredentials): string {
  const username = credentials?.username.replace(/@(?:student\.)?xjtlu\.edu\.cn$/i, '')
  return `(() => {
    if (!(${onLoginPage})) return 'wrong-page';
    const formPath = ${JSON.stringify(formPath)};
    ${inspectForm}
    ${credentials ? `
      const storedUser = ${JSON.stringify(username)}, storedPassword = ${JSON.stringify(credentials.password)};
      if (!storedUser || storedUser.includes('@')) return 'user-input';
      if ((username.value && username.value.toLowerCase() !== storedUser.toLowerCase()) || password.value) return 'user-input';
      if (globalThis.__xjtluMailSubmitted) return 'already-submitted';
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      if (!username.value) setValue.call(username, storedUser);
      setValue.call(password, storedPassword);
      globalThis.__xjtluMailSubmitted = true;
      button.click();
      return 'submitted';
    ` : "return 'credentials';"}
  })()`
}
