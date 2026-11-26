import { useEffect, useMemo, useRef, useState } from 'react'
import { schoolLoginAction } from '../../shared/ams'
import { mailDate, type MailAddress, type MailArchiveState, type MailBridge, type MailFolder, type MailHistory, type MailListPage, type MailMessage, type MailState, type MailSummary } from '../../shared/mail'
import { MailBody } from './MailBody'
import { phases, updatedAt } from './presentation'
import './mail.css'

const folders: Record<MailFolder, string> = { inbox: '收件箱', sentitems: '已发送' }
const dates = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const fullDates = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false })
const messageTitle = (item: MailSummary) => item.subject.trim() || '无主题'
const historyPageSize = 100

function formatDate(value: string | null, formatter: Intl.DateTimeFormat): string {
  const timestamp = value ? Date.parse(value) : NaN
  return Number.isFinite(timestamp) ? formatter.format(timestamp) : ''
}

function addressLabel(entry: MailAddress | null): string {
  if (!entry) return ''
  const { name, address } = entry
  return name && address && name !== address ? `${name} <${address}>` : name || address || ''
}

export function MailPage({ state, api }: { state: MailState; api?: MailBridge }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [folder, setFolder] = useState<MailFolder>('inbox')
  const [refresh, setRefresh] = useState(0)
  const [listPending, setListPending] = useState(false)

  useEffect(() => {
    if (!api || state.phase !== 'idle') return
    let live = true
    void api.restore().catch(() => { if (live) setError('无法读取邮箱状态。') })
    return () => { live = false }
  }, [api, state.phase])

  async function run(operation: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setError('')
    try { await operation() }
    catch { setError('邮箱操作未完成，请重试。') }
    finally { setBusy(false) }
  }

  const connected = state.phase === 'connected'
  const connecting = state.phase === 'authenticating' || state.phase === 'loading'
  const manualAction = schoolLoginAction(state.phase) ?? (state.phase === 'error' ? '手动登录' : null)
  const showMailbox = api && (connected || state.phase === 'error')
  return <>
    <div className="heading">
      <div>
        <div className="eyebrow">XJTLU WEBMAIL</div>
        <h1>西浦邮箱</h1>
        <p>查看学校邮箱的收件箱与已发送邮件，时间按北京时间显示。</p>
      </div>
      <div className="ams-icon" aria-hidden="true">✉</div>
    </div>
    <section className="connection card" aria-labelledby="mail-connection">
      <div className="connection-top">
        <div>
          <span className={`status status-${state.phase}`} role="status"><span aria-hidden="true" />{phases[state.phase]}</span>
          <h2 id="mail-connection">邮箱连接</h2>
          <p>{state.message}</p>
        </div>
        <div className="actions">
          {manualAction && <button type="button" disabled={!api || busy} onClick={() => void run(() => api!.open('manual'))}>{manualAction}</button>}
          {connected
            ? <button type="button" className="primary" disabled={busy || listPending} onClick={() => setRefresh(current => current + 1)}>{listPending ? '正在读取…' : '刷新邮件'}</button>
            : <button type="button" className="primary" disabled={!api || busy || connecting} onClick={() => void run(() => api!.open('campus'))}>{connecting ? '正在连接…' : manualAction ? '自动重试' : '连接西浦邮箱'}</button>}
        </div>
      </div>
      <div className="connection-bottom"><span>◈ 首页统一管理账号</span><span>◈ 邮件来自学校邮箱</span></div>
    </section>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="view-tabs" role="group" aria-label="邮件文件夹">
      {(Object.keys(folders) as MailFolder[]).map(key => <button type="button" key={key} className={key === folder ? 'active' : ''} aria-pressed={key === folder} onClick={() => setFolder(key)}>{folders[key]}</button>)}
    </div>
    {showMailbox
      ? <MailFolderView key={`${state.sessionRevision}:${folder}`} api={api} connected={connected} folder={folder}
          archive={state.archive} refresh={refresh} onLoading={setListPending} />
      : <section className="schedule card mail-empty">
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">✉</div>
          <h3>{connecting ? '正在连接邮箱…' : '等待邮箱数据'}</h3>
          <p>连接后读取{folders[folder]}。</p>
        </div>
      </section>}
    {connected && <footer className="page-footer"><p>来源：西浦邮箱。</p><button className="text-button" type="button" disabled={!api || busy} onClick={() => void run(() => api!.disconnect())}>退出邮箱</button></footer>}
  </>
}

type MailFolderProps = { api: MailBridge; connected: boolean; folder: MailFolder; archive: MailArchiveState; refresh: number; onLoading: (loading: boolean) => void }

function MailFolderView({ api, connected, folder, archive, refresh, onLoading }: MailFolderProps): React.JSX.Element {
  const [page, setPage] = useState<MailListPage | null>(null)
  const [history, setHistory] = useState<MailHistory | null>(null)
  const [visibleLimit, setVisibleLimit] = useState(historyPageSize)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [pending, setPending] = useState(connected)
  const [error, setError] = useState('')
  const [request, setRequest] = useState<{ offset: number } | null>(() => connected ? { offset: 0 } : null)
  const lastRefresh = useRef(refresh)

  useEffect(() => {
    if (!connected) return
    const refreshed = lastRefresh.current !== refresh
    lastRefresh.current = refresh
    setRequest(current => refreshed || !current ? { offset: 0 } : current)
  }, [connected, refresh])

  useEffect(() => {
    if (!request) return
    let live = true
    setPending(true)
    onLoading(true)
    setError('')
    void api.list(folder, request.offset).then(result => {
      if (!live) return
      if (!result.ok) { setError(result.message); return }
      const next = result.value
      setFetchedAt(new Date().toISOString())
      if (request.offset === 0) {
        setPage(next)
      } else {
        setPage(current => {
          const messages = new Map(current?.messages.map(item => [item.id, item]))
          for (const item of next.messages) messages.set(item.id, item)
          return { ...next, messages: [...messages.values()] }
        })
      }
    }).catch(() => { if (live) setError('无法读取邮件列表，请重试。') })
      .finally(() => { if (live) { setPending(false); onLoading(false) } })
    return () => { live = false; onLoading(false) }
  }, [api, folder, request, onLoading])

  useEffect(() => {
    if (!archive.enabled) return
    let live = true
    void api.history(folder).then(result => {
      if (live && result.ok) setHistory(result.value)
    }).catch(() => {})
    return () => { live = false }
  }, [api, archive.enabled, archive.revision, folder, fetchedAt])

  const stored = archive.enabled && history?.revision === archive.revision ? history : null
  const messages = useMemo(() => {
    if (!stored?.messages.length) return page?.messages ?? []
    const combined = new Map(stored.messages.map(item => [item.id, item]))
    for (const item of page?.messages ?? []) combined.set(item.id, item)
    const date = (item: MailSummary) => Date.parse(mailDate(item, folder) ?? '') || 0
    return [...combined.values()].sort((a, b) => date(b) - date(a))
  }, [stored, page, folder])
  const limit = Math.max(page?.messages.length ?? 0, visibleLimit)
  const hasMoreHistory = messages.length > limit
  const selectedMessage = messages.find(item => item.id === selected)
  return <div className="lmc-layout mail-browser">
    <section className="card lmc-courses mail-list" aria-label="邮件列表">
      <div className="lmc-panel-heading"><h2>{folders[folder]}</h2>{(page || stored) && <span>{messages.length} 封邮件</span>}</div>
      {error && <div className="notice error mail-list-error" role="alert">{error}</div>}
      {archive.enabled && archive.issue && <div className="notice mail-list-error" role="status">{archive.issue}</div>}
      <div aria-busy={pending}>
        {messages.length ? <ul className="lmc-course-list mail-rows">{messages.slice(0, limit).map(item => {
          const from = item.from?.name || item.from?.address || '未知发件人'
          const time = mailDate(item, folder)
          return <li key={item.id}>
            <button type="button" className={item.id === selected ? 'mail-row selected' : 'mail-row'} aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>
              <span className="mail-row-top"><strong className="mail-sender" title={from}>{from}</strong><time dateTime={time ?? undefined}>{formatDate(time, dates)}</time></span>
              <span className="mail-row-bottom">
                {item.isRead === false && <span className="mail-unread" aria-label="未读" title="未读" />}
                <span className="mail-subject" title={messageTitle(item)}>{messageTitle(item)}</span>
                {item.hasAttachments && <span className="mail-attachment">有附件</span>}
              </span>
            </button>
          </li>
        })}</ul> : <div className="lmc-empty" role="status">{pending ? '正在读取邮件…' : page ? '这个文件夹没有邮件。' : '邮件列表尚未读取。'}</div>}
      </div>
      <div className="lmc-updated mail-list-footer">
        <span>上次更新：{updatedAt(fetchedAt)}</span>
        {hasMoreHistory
          ? <button type="button" onClick={() => setVisibleLimit(limit + historyPageSize)}>查看更多历史</button>
          : connected && page && page.nextOffset !== null && <button type="button" disabled={pending}
              onClick={() => setRequest({ offset: page.nextOffset! })}>{pending ? '正在加载…' : '加载更多'}</button>}
      </div>
    </section>
    <section className="card lmc-module mail-reader" aria-label="邮件正文">
      {selectedMessage
        ? <MailReader key={`${selectedMessage.id}:${archive.revision}`} api={api} item={selectedMessage} folder={folder} />
        : <div className="empty"><div className="empty-icon" aria-hidden="true">✉</div><h3>选择一封邮件</h3><p>查看发件人、收件人和邮件正文。</p></div>}
    </section>
  </div>
}

function MailReader({ api, item, folder }: { api: MailBridge; item: MailSummary; folder: MailFolder }): React.JSX.Element {
  const [detail, setDetail] = useState<MailMessage | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    void api.read(item.id).then(result => {
      if (!live) return
      if (result.ok) setDetail(result.value)
      else setError(result.message)
    }).catch(() => { if (live) setError('无法读取邮件正文，请重试。') })
    return () => { live = false }
  }, [api, item.id, attempt])

  const mail = detail ?? item
  const time = formatDate(mailDate(mail, folder), fullDates)
  const addresses = [
    ['发件人', addressLabel(mail.from)],
    ['收件人', detail?.to.map(addressLabel).filter(Boolean).join('、')],
    ['抄送', detail?.cc.map(addressLabel).filter(Boolean).join('、')],
    ['密送', detail?.bcc.map(addressLabel).filter(Boolean).join('、')],
    ['时间', time && `${time}（北京时间）`]
  ]

  return <>
    <header className="lmc-panel-heading mail-reader-header">
      <div>
        <h2>{messageTitle(mail)}</h2>
        <dl className="mail-message-meta">{addresses.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {mail.hasAttachments && <span className="mail-attachment">有附件</span>}
      </div>
    </header>
    {error ? <div className="mail-reader-error" role="alert"><p>{error}</p><button type="button" onClick={() => { setError(''); setAttempt(current => current + 1) }}>重试</button></div>
      : <MailBody message={detail} />}
  </>
}
