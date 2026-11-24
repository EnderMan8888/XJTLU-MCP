import { useState } from 'react'
import { schoolLoginAction } from '../../shared/ams'
import { isSignInNotice, type LmcBridge, type LmcDownload, type LmcNotification, type LmcState } from '../../shared/lmc'
import { phases, updatedAt } from './presentation'
import { notificationContent } from './lmc-notifications'

const activityLabels: Record<string, string> = { resource: '文件', folder: '文件夹', assign: '作业', forum: '讨论 / 公告', quiz: '测验', page: '页面', url: '外部链接', lti: '教学工具', checklist: '清单', bigbluebuttonbn: '在线课堂', moodleoverflow: '问答' }
const bytes = (value: number): string => value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(0)} KB` : `${value} B`
const sourceLabels: Record<string, string> = { mod_forum: '课程讨论', mod_assign: '作业通知', mod_quiz: '测验通知', moodle: '系统通知' }
const fileLabels: Record<string, string> = { pdf: 'PDF', powerpoint: 'PowerPoint', document: '文档', archive: '压缩包', markup: 'HTML', spreadsheet: '表格' }
const signInFilterKey = 'xjtlu.lmc.hideSignInNotifications'
const courseSortKey = 'xjtlu.lmc.courseSort'
const courseNameOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function LmcPage({ state, api, autoRelogin, onAccount }: { state: LmcState; api: LmcBridge | undefined; autoRelogin: boolean; onAccount: () => void }): React.JSX.Element {
  const loginAction = schoolLoginAction(state.phase)
  const [view, setView] = useState<'courses' | 'notifications'>('courses')
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [courseSort, setCourseSort] = useState<'recent' | 'name'>(() => { try { return localStorage.getItem(courseSortKey) === 'name' ? 'name' : 'recent' } catch { return 'recent' } })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [expandedNotices, setExpandedNotices] = useState<Set<string>>(new Set())
  const [hideSignIn, setHideSignIn] = useState(() => { try { return localStorage.getItem(signInFilterKey) !== 'false' } catch { return true } })
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const run = async (operation: () => Promise<void>): Promise<void> => { setBusy(true); setError(''); try { await operation() } catch { setError('操作未完成，请检查 LMC 连接状态后重试。') } finally { setBusy(false) } }
  const connecting = state.phase === 'authenticating' || state.phase === 'loading'
  const disabled = !api || busy || connecting
  const connected = state.phase === 'connected'
  const canRead = connected || autoRelogin && state.phase === 'expired'
  const query = search.trim().toLowerCase()
  const courses = state.courses.filter(course => `${course.title} ${course.shortName}`.toLowerCase().includes(query))
  if (courseSort === 'name') courses.sort((a, b) => courseNameOrder.compare(a.title, b.title))
  const course = state.courses.find(course => course.id === selected)
  const module = course ? state.modules[course.id] : null
  const sections = [...new Set(module?.activities.map(activity => activity.section) ?? [])]
  const downloadBusy = state.downloads.some(item => item.phase === 'preparing' || item.phase === 'downloading')
  const notices = state.notifications.filter(item => !hideSignIn || !isSignInNotice(item.title))
  const hiddenNotices = state.notifications.length - notices.length
  const selectCourse = (id: string): void => { setSelected(id); setExpandedFolders(new Set()); if (api && !state.modules[id]?.fetchedAt) void run(() => api.loadCourse(id)) }
  const toggleFolder = (id: string): void => {
    const next = new Set(expandedFolders)
    if (next.has(id)) next.delete(id)
    else { next.add(id); if (api && !module?.folders[id]?.fetchedAt) void run(() => api.loadFolder(id)) }
    setExpandedFolders(next)
  }
  return <>
    <div className="heading"><div><div className="eyebrow">LEARNING MALL CORE</div><h1>课程资料与通知</h1><p>查看 Module 内容，下载学校提供的原文件。</p></div><div className="ams-icon lmc-icon">LM</div></div>
    <section className="connection card"><div className="connection-top"><div><span className={`status status-${state.phase}`}><span />{phases[state.phase]}</span><h2>LMC 连接</h2><p>{state.message}</p></div><div className="actions"><button disabled={disabled} onClick={() => { if (!api) return; if (state.phase === 'credentials-required') onAccount(); else void run(() => loginAction ? api.showLogin() : api.connect()) }}>{loginAction ?? (state.phase === 'credentials-required' ? '设置学校账号' : connected ? '更新连接' : '连接 LMC')}</button><button className="primary" disabled={disabled || !canRead} onClick={() => { if (api) void run(() => api.refresh()) }}>{connecting ? '正在读取…' : '刷新课程与通知'}</button></div></div><div className="connection-bottom"><span>◈ 复用首页学校账号</span><span>◈ 文件直接下载，不提取文档内容</span></div></section>
    {error && <div className="notice error" role="alert">{error}</div>}
    <div className="view-tabs" role="group" aria-label="Learning Mall 视图"><button className={view === 'courses' ? 'active' : ''} aria-pressed={view === 'courses'} onClick={() => setView('courses')}>课程与资料</button><button className={view === 'notifications' ? 'active' : ''} aria-pressed={view === 'notifications'} onClick={() => setView('notifications')}>Notification{state.unreadCount !== null ? ` · ${state.unreadCount} 条未读` : ''}</button></div>
    {view === 'courses' && <>
      {state.issues.courses && <div className="notice" role="status">{state.issues.courses}</div>}
      <div className="lmc-layout"><section className="card lmc-courses"><div className="lmc-panel-heading"><h2>我的课程</h2><span>{state.courses.length} 门</span></div>
        <div className="lmc-course-sort"><label htmlFor="lmc-course-sort">排序</label><select id="lmc-course-sort" value={courseSort} onChange={event => { const value = event.target.value === 'name' ? 'name' : 'recent'; setCourseSort(value); try { localStorage.setItem(courseSortKey, value) } catch { /* Keep the current selection when storage is unavailable. */ } }}><option value="recent">最近访问</option><option value="name">名称 A–Z</option></select></div>
        <input aria-label="搜索 LMC 课程" className="lmc-search" placeholder="搜索课程名称或代码" value={search} onChange={event => setSearch(event.target.value)} />
        {courseSort === 'recent' && state.coursesAt && <p className="lmc-sort-hint">按 Core 最近访问记录，刷新课程后更新。</p>}
        {!state.coursesAt ? <div className="lmc-empty">连接后读取课程列表。</div> : !courses.length ? <div className="lmc-empty">{query ? '没有匹配课程。' : '学校未返回课程。'}</div> : <div className="lmc-course-list">{courses.map(item => <button key={item.id} className={selected === item.id ? 'selected' : ''} disabled={disabled || !canRead} onClick={() => selectCourse(item.id)}><strong>{item.title}</strong>{item.shortName && <small>{item.shortName}</small>}</button>)}</div>}
        <div className="lmc-updated">上次更新：{updatedAt(state.coursesAt)}</div>
      </section><section className="card lmc-module">
        {!course ? <div className="empty"><div className="empty-icon">▤</div><h3>选择一门课程</h3><p>展开 Module 资料和文件夹，选择文件下载。</p></div> : <>
          <div className="lmc-panel-heading"><div><h2>{course.title}</h2><small>{course.shortName}</small></div><div className="actions"><button disabled={disabled || !canRead} onClick={() => { if (api) void run(() => api.loadCourse(course.id)) }}>刷新资料</button><button className="text-button" disabled={disabled || !connected} onClick={() => { if (api) void run(() => api.openSource({ kind: 'course', id: course.id })) }}>学校原页 ↗</button></div></div>
          {module?.issue && <div className="notice" role="status">{module.issue}</div>}
          {module?.loading || busy && !module?.fetchedAt ? <div className="empty"><h3>正在读取课程资料…</h3></div> : !module?.fetchedAt ? <div className="empty"><h3>课程资料尚未读取</h3></div> : !module.activities.length ? <div className="empty"><h3>课程页面没有可显示的活动</h3></div> : sections.map(section => <section className="lmc-section" key={section}><h3>{section}</h3>{module.activities.filter(activity => activity.section === section).map(activity => <div key={activity.id} className="lmc-activity-group"><div className="lmc-activity"><span className={`lmc-kind ${activity.type === 'folder' ? 'is-folder' : ''}`}>{activityLabels[activity.type] ?? activity.type}</span>
            <div className="lmc-activity-name">
              <strong>{activity.title}</strong>
              {activity.type === 'assign' && <span className="lmc-assignment-dates">
                <span>开放 {activity.assignmentDates?.opens ?? '未读取到'}</span>
                <span>截止 {activity.assignmentDates?.due ?? '未读取到'}</span>
              </span>}
              {activity.fileType && <small>{fileLabels[activity.fileType] ?? activity.fileType.toUpperCase()}</small>}
            </div>
            <div className="actions">{activity.type === 'folder' ? <button disabled={disabled || !canRead} onClick={() => toggleFolder(activity.id)}>{expandedFolders.has(activity.id) ? '收起' : '查看文件'}</button> : activity.downloadable ? <button className="primary" disabled={disabled || !canRead || downloadBusy} onClick={() => { if (api) void run(() => api.download(activity.id)) }}>下载</button> : null}<button className="text-button" disabled={disabled || !connected} onClick={() => { if (api) void run(() => api.openSource({ kind: 'activity', id: activity.id })) }}>学校原页 ↗</button></div></div>
            {expandedFolders.has(activity.id) && <div className="lmc-folder">{module.folders[activity.id]?.issue && <div className="notice" role="status">{module.folders[activity.id].issue}<button className="text-button" disabled={disabled} onClick={() => { if (api) void run(() => api.loadFolder(activity.id)) }}>重试</button></div>}{module.folders[activity.id]?.loading ? <p>正在读取文件列表…</p> : !module.folders[activity.id]?.fetchedAt ? <p>文件列表尚未读取。</p> : !module.folders[activity.id].files.length ? <p>学校当前未提供文件。</p> : module.folders[activity.id].files.map(file => <div className="lmc-file" key={file.id}><div><strong>{file.name}</strong>{file.path !== file.name && <small>{file.path}</small>}</div><button disabled={disabled || !canRead || downloadBusy} onClick={() => { if (api) void run(() => api.download(file.id)) }}>下载{file.extension ? ` ${file.extension.toUpperCase()}` : ''}</button></div>)}</div>}
          </div>)}</section>)}
          <div className="lmc-updated">上次更新：{updatedAt(module?.fetchedAt ?? null)}</div>
        </>}
      </section></div>
    </>}
    {view === 'notifications' && <>
      {state.issues.notifications && <div className="notice" role="status">{state.issues.notifications}</div>}
      <div className="section-heading"><div><h2>通知</h2><span>当前显示 {notices.length} 条</span></div><button disabled={disabled || !canRead || state.notificationsLoading} onClick={() => { if (api) void run(() => api.loadNotifications(false)) }}>刷新通知</button></div>
      <div className="lmc-notification-filters"><label title="New sign in to your Learning Mall Core account"><input type="checkbox" checked={hideSignIn} onChange={event => { const checked = event.target.checked; setHideSignIn(checked); try { localStorage.setItem(signInFilterKey, String(checked)) } catch { /* The current page still keeps the selected filter. */ } }} />隐藏账号登录提醒</label><span>{hideSignIn ? `已隐藏 ${hiddenNotices} 条 · ` : ''}未读总数沿用学校统计</span></div>
      <section className="card lmc-notifications">
        {!state.notificationsAt ? <div className="empty"><h3>等待 LMC 通知</h3><p>连接后读取学校通知。</p></div> : !state.notifications.length ? <div className="empty"><h3>学校当前没有返回通知</h3></div> : !notices.length ? <div className="empty"><h3>当前已加载的通知均已隐藏</h3><p>可取消隐藏账号登录提醒，或加载更多通知。</p></div> : notices.map(item => <NotificationCard
          key={item.id} item={item} expanded={expandedNotices.has(item.id)} disabled={disabled || !connected}
          attachmentsDisabled={disabled || !canRead} downloadBusy={downloadBusy}
          onToggle={() => { const next = new Set(expandedNotices); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); setExpandedNotices(next) }}
          onSource={() => { if (api) void run(() => api.openSource({ kind: 'notification', id: item.id })) }}
          onAttachments={() => { if (api) void run(async () => {
            if (!await api.loadNotificationAttachments(item.id)) throw new Error('附件入口暂不可用。')
          }) }}
          onDownload={fileId => { if (api) void run(() => api.download(fileId, item.id)) }}
        />)}
        <div className="schedule-footer"><span>上次更新：{updatedAt(state.notificationsAt)}</span>{state.moreNotifications && <button disabled={disabled || !canRead || state.notificationsLoading} onClick={() => { if (api) void run(() => api.loadNotifications(true)) }}>加载更多</button>}</div>
      </section>
    </>}
    {!!state.downloads.length && <section className="card lmc-downloads"><h2>下载记录</h2>{state.downloads.map(item => <DownloadRow key={item.id} item={item} disabled={!api} reveal={() => { if (api) void run(() => api.revealDownload(item.id)) }} cancel={() => { if (api) void run(() => api.cancelDownload(item.id)) }} />)}</section>}
    <footer className="page-footer"><p>来源：Learning Mall Core。下载时选择保存位置，原文件直接保存在你的电脑。</p><button className="text-button" disabled={disabled} onClick={() => setConfirmDisconnect(true)}>断开 LMC</button></footer>
    {confirmDisconnect && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="lmc-disconnect"><h2 id="lmc-disconnect">断开 LMC？</h2><p>清除 LMC 会话和页面数据，并取消正在进行的下载；首页公共学校账号保留。</p><div className="actions"><button onClick={() => setConfirmDisconnect(false)}>取消</button><button className="primary" onClick={() => { setConfirmDisconnect(false); if (api) void run(() => api.disconnect()) }}>断开 LMC</button></div></section></div>}
  </>
}

function NotificationCard({ item, expanded, disabled, attachmentsDisabled, downloadBusy, onToggle, onSource, onAttachments, onDownload }: {
  item: LmcNotification
  expanded: boolean
  disabled: boolean
  attachmentsDisabled: boolean
  downloadBusy: boolean
  onToggle: () => void
  onSource: () => void
  onAttachments: () => void
  onDownload: (fileId: string) => void
}): React.JSX.Element {
  const content = notificationContent(item)
  return <article className={`lmc-notification${item.read === false ? ' is-unread' : ''}`}>
    <div className="lmc-notification-title"><h3>{content.title}</h3><span className={item.read === false ? 'lmc-unread' : 'lmc-read'}>{item.read === null ? '状态未知' : item.read ? '已读' : '未读'}</span></div>
    <div className="lmc-notification-meta">{content.course && <span className="lmc-notification-course">{content.course}</span>}<span>{sourceLabels[item.source] ?? '学校通知'}</span>{content.author && <span>{content.author}</span>}<time dateTime={item.createdAt ?? undefined}>{updatedAt(item.createdAt)}</time></div>
    {expanded ? <div className="lmc-notification-body">{content.body.split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div> : <p className="lmc-notification-preview">{content.preview || '这条通知未提供正文。'}</p>}
    {item.attachments?.map(file => <div className="lmc-file" key={file.fileId}>
      <strong>{file.name}</strong><button disabled={attachmentsDisabled || downloadBusy} onClick={() => onDownload(file.fileId)}>下载</button>
    </div>)}
    {item.attachments?.length === 0 && <p className="lmc-notification-preview">学校未提供附件。</p>}
    {(content.canExpand || item.hasSource) && <div className="lmc-notification-actions">
      {content.canExpand && <button className="text-button" aria-expanded={expanded} onClick={onToggle}>{expanded ? '收起详情 ↑' : '展开详情 ↓'}</button>}
      {item.canListAttachments && !item.attachments && <button className="text-button" disabled={attachmentsDisabled} onClick={onAttachments}>查看附件</button>}
      {item.hasSource && <button className="text-button" disabled={disabled} onClick={onSource}>学校原文 ↗</button>}
    </div>}
  </article>
}

function DownloadRow({ item, disabled, reveal, cancel }: { item: LmcDownload; disabled: boolean; reveal: () => void; cancel: () => void }): React.JSX.Element {
  return <div className="lmc-download"><div><strong>{item.name}</strong><small>{item.message}{item.received > 0 ? ` · ${bytes(item.received)}${item.total > 0 ? ` / ${bytes(item.total)}` : ''}` : ''}</small>{item.phase === 'downloading' && item.total > 0 && <progress value={item.received} max={item.total} />}</div>{item.phase === 'completed' ? <button disabled={disabled} onClick={reveal}>显示文件</button> : item.phase === 'preparing' || item.phase === 'downloading' ? <button disabled={disabled} onClick={cancel}>取消</button> : null}</div>
}
