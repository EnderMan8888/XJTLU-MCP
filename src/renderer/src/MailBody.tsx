import { createElement, Fragment, useMemo, type ReactNode } from 'react'
import type { MailMessage } from '../../shared/mail'

const ignored = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'svg', 'math',
  'iframe', 'object', 'embed', 'button', 'input', 'select', 'textarea', 'link', 'meta', 'canvas', 'video', 'audio'])
const allowed = new Set(['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sup', 'sub', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'])

function bodyContent(html: string): ReactNode[] {
  const template = document.createElement('template')
  template.innerHTML = html
  let remaining = 30_000

  function render(node: ChildNode, key: number, depth: number): ReactNode {
    if (--remaining < 0 || depth > 80) return null
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (!(node instanceof HTMLElement)) return null
    const tag = node.localName
    if (ignored.has(tag) || node.hidden || node.getAttribute('aria-hidden') === 'true'
      || node.style.display === 'none' || node.style.visibility === 'hidden' || /\bmso-hide\s*:\s*all\b/i.test(node.getAttribute('style') ?? '')) return null
    if (tag === 'img') {
      const image = node as HTMLImageElement
      const alt = image.alt.trim()
      if (!alt || image.width === 1 || image.height === 1) return null
      return <span key={key}>{alt}</span>
    }
    if (tag === 'br' || tag === 'hr') return createElement(tag, { key })
    const children = [...node.childNodes].map((child, index) => render(child, index, depth + 1))
    if (tag === 'a') return <span key={key} className="mail-body-link">{children}</span>
    if (!allowed.has(tag)) return <Fragment key={key}>{children}</Fragment>
    if (tag === 'td' || tag === 'th') {
      const cell = node as HTMLTableCellElement
      return createElement(tag, { key, colSpan: Math.min(cell.colSpan, 50), rowSpan: Math.min(cell.rowSpan, 50) }, children)
    }
    if (tag === 'table') {
      return <div className={node.getAttribute('role') === 'presentation' ? 'mail-body-layout' : 'mail-body-table'} key={key}>
        <table>{children}</table>
      </div>
    }
    return createElement(tag, { key }, children)
  }

  return [...template.content.childNodes].map((node, index) => render(node, index, 0))
}

export function MailBody({ message }: { message: MailMessage | null }): React.JSX.Element {
  const content = useMemo(() => {
    if (!message?.body.trim()) return '这封邮件没有正文。'
    return message.bodyType === 'html' ? bodyContent(message.body) : message.body.replace(/\r\n?/g, '\n').trim()
  }, [message])
  return <div className={message?.bodyType === 'html' ? 'mail-body mail-body-html' : 'mail-body mail-body-text'}
    aria-busy={!message}>{message ? content : '正在读取正文…'}</div>
}
