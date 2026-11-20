import type { LmcNotification } from '../../shared/lmc'

interface NotificationContent { title: string; course: string; author: string; body: string; preview: string; canExpand: boolean }

// Format the plain notification text already in memory. Never render school HTML.
export function notificationContent(item: Pick<LmcNotification, 'title' | 'body' | 'source'>): NotificationContent {
  const clean = (value: string): string => value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n').map(line => line.trim().replace(/[\t ]+/g, ' ')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  let title = item.title.trim(), course = '', author = '', body = clean(item.body)
  if (item.source === 'mod_forum') {
    const subject = title.match(/^([^\n:]{1,160}):\s+(.+)$/)
    if (subject) { course = subject[1]; title = subject[2] }
    const lines = body.split('\n')
    const byline = lines.findIndex(line => /^by .+ - .+/i.test(line))
    // Only remove the observed Moodle forum email wrapper, with all its markers.
    const heading = lines.slice(0, byline).join(' ')
    if (byline > 0 && byline < 30 && heading.includes('»') && /\bForums\b/.test(heading) && heading.includes(title)) {
      author = lines[byline].match(/^by (.+?) - .+/i)?.[1] ?? ''
      body = lines.slice(byline + 1).join('\n').trim()
      const footer = new Set(['See this post in context', 'Change your forum digest preferences'])
      const content = body.split('\n')
      while (content.length && (!content.at(-1) || footer.has(content.at(-1)!))) content.pop()
      body = content.join('\n').trim()
    }
  } else if (item.source === 'mod_assign') {
    const separator = body.indexOf('\n\n')
    if (separator > 0) {
      const path = body.slice(0, separator).split(/\s*->\s*/)
      if (path.length === 3 && path[1] === 'Assignment' && path.every(part => !!part.trim())) {
        course = path[0].trim()
        body = body.slice(separator).trim()
      }
    }
  }
  const preview = body.replace(/\s+/g, ' ')
  return { title, course, author, body, preview, canExpand: body.length > 220 || body.includes('\n') }
}
