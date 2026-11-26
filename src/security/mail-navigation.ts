export const CAMPUS_MAIL_URL = 'https://mail.xjtlu.edu.cn/'

export const mailOrigins = [
  new URL(CAMPUS_MAIL_URL).origin,
  'https://outlook.office.com',
  'https://outlook.office365.com',
  'https://outlook.cloud.microsoft'
]

export function isMailNavigation(raw: string): boolean {
  if (raw === 'about:blank') return true
  const url = URL.parse(raw)
  return !!url && (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
}

export function outlookMailErrorStatus(raw: string): number | null {
  const url = URL.parse(raw)
  if (!url || url.pathname !== '/mail/olkerror.html' || !isMailNavigation(raw) ||
      url.origin === new URL(CAMPUS_MAIL_URL).origin || !mailOrigins.includes(url.origin)) return null
  const status = url.searchParams.get('httpCode')
  return status && /^[45]\d\d$/.test(status) ? Number(status) : null
}
