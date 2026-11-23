import { useState } from 'react'
import { schoolLoginAction } from '../../shared/ams'
import type { EbridgeBridge, EbridgeExam, EbridgeState, EbridgeView } from '../../shared/ebridge'
import { phases, updatedAt } from './presentation'
import { EbridgeGradesPage } from './EbridgeGradesPage'
const weekdays: Record<string,string> = {MON:'星期一',TUE:'星期二',WED:'星期三',THU:'星期四',FRI:'星期五',SAT:'星期六',SUN:'星期日'}
const dayLabel = (day: string): string => weekdays[day.slice(0,3).toUpperCase()] || day
const views: {key:EbridgeView; label:string; heading:string; source:string}[] = [
  {key:'courses',label:'课程信息',heading:'我的课程',source:'课程信息'},
  {key:'timetable',label:'Timetables',heading:'我的课表',source:'Timetables'},
  {key:'exams',label:'考试安排',heading:'我的考试安排',source:'Timetables · 个人考试安排'},
  {key:'grades',label:'成绩查询',heading:'成绩查询',source:'Academic Records'}
]

export function EbridgePage({state, api, action, run, onAccount}: {state:EbridgeState; api:EbridgeBridge; action:boolean; run:(operation:()=>Promise<void>)=>Promise<void>; onAccount:()=>void}): React.JSX.Element {
  const [view, setView] = useState<EbridgeView>('courses')
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [examDate, setExamDate] = useState('')
  const [semester, setSemester] = useState('')
  const [confirm, setConfirm] = useState(false)
  const busy = action || state.phase === 'authenticating' || state.phase === 'loading' || state.grades.loading
  const loginAction = schoolLoginAction(state.phase)
  const query = search.trim().toLowerCase()
  const semesters = [...new Set(state.courses.map(c => c.semester).filter(Boolean))]
  const courses = state.courses.filter(c => (!semester || c.semester === semester) && `${c.code} ${c.title}`.toLowerCase().includes(query))
  const dates = [...new Set(state.timetable.map(s => s.date))]
  const activeDate = dates.includes(date) ? date : dates[0]
  const entries = state.timetable.filter(s => s.date === activeDate && `${s.code} ${s.title} ${s.room}`.toLowerCase().includes(query))
  const examDates = [...new Set(state.exams.map(e => e.date).filter(Boolean))]
  const activeExamDate = examDates.includes(examDate) ? examDate : ''
  const exams = state.exams.filter(e => (!activeExamDate || e.date === activeExamDate) && `${e.code} ${e.title} ${e.room} ${e.seat} ${e.area} ${e.entrance}`.toLowerCase().includes(query))
  const fetched = {courses:state.coursesAt,timetable:state.timetableAt,exams:state.examsAt,grades:state.grades.componentsAt ?? state.grades.recordsAt}[view]
  const current = views.find(v => v.key === view)!
  return <>
    <div className="heading"><div><div className="eyebrow">EBRIDGE · ACADEMIC INFORMATION</div><h1>课程、课表、考试与成绩</h1><p>从 eBridge 读取教务信息，使用首页统一保存的学校账号。</p></div><div className="ams-icon">eB</div></div>
    <section className="connection card"><div className="connection-top"><div><span className={`status status-${state.phase}`}><span />{phases[state.phase]}</span><h2>eBridge 连接</h2><p>{state.message}</p></div><div className="actions"><button disabled={!api || busy} onClick={() => state.phase === 'credentials-required' ? onAccount() : void run(() => loginAction ? api.showLogin() : api.connect())}>{loginAction ?? (state.phase === 'credentials-required' ? '设置学校账号' : '连接 eBridge')}</button><button className="primary" disabled={!api || busy || state.phase === 'manual-login-required'} onClick={() => void run(() => view === 'grades' && state.phase === 'connected' ? api.loadGrades() : api.refresh())}>{busy ? '正在读取…' : view === 'grades' ? '查询 / 刷新成绩' : '刷新教务信息'}</button></div></div><div className="connection-bottom"><span>◈ 首页统一管理账号</span><span>◈ 学校原始教务信息与成绩</span></div></section>
    <section className="card ebridge-cache-setting" aria-labelledby="ebridge-cache-title">
      <label id="ebridge-cache-title">
        <input type="checkbox" checked={state.localCache.enabled} disabled={!api || action} aria-describedby="ebridge-cache-description" onChange={event => {
          const enabled = event.target.checked
          void run(() => api.setLocalCache(enabled))
        }} />
        <strong>在本机保存课表、课程列表和考试安排</strong>
      </label>
      <p id="ebridge-cache-description">开启后，下次启动可先查看上次读取的结果。关闭后清除本地副本。</p>
      {state.localCache.issue && <div className="notice" role="status">{state.localCache.issue}</div>}
    </section>
    <div className="view-tabs" role="group" aria-label="eBridge 信息视图">{views.map(v => <button key={v.key} className={view === v.key ? 'active' : ''} aria-pressed={view === v.key} onClick={() => {setView(v.key); setSearch(''); if (v.key === 'grades' && state.phase === 'connected' && !state.grades.componentsAt && !state.grades.recordsAt && !state.issues.grades && !busy) void run(() => api.loadGrades())}}>{v.label}</button>)}</div>
    {view === 'grades' && <EbridgeGradesPage data={state.grades} phase={state.phase} api={api} busy={busy} run={run} />}
    {view !== 'grades' && <>
    {state.localCache.restored.includes(view) && <div className="notice" role="status">正在显示本地缓存，最近一次读取于 {updatedAt(fetched)}。</div>}
    {state.issues[view] && <div className="notice" role="status">{state.issues[view]}{fetched && ' 以下保留上次读取的数据。'}</div>}
    <div className="section-heading"><div><h2>{current.heading}</h2><span>{view === 'courses' ? `${state.courses.length} 门课程` : view === 'timetable' ? `${state.timetable.length} 条上课安排 · 按教学周重复` : `${state.exams.length} 场考试 · 时间 UTC+8（北京时间）`}</span></div><button className="text-button" disabled={!api || busy} onClick={() => void run(() => api.openSource(view))}>打开学校原页 ↗</button></div>
    <section className="schedule card"><div className="module-filters">{view === 'courses' && !!semesters.length && <label>学期<select value={semester} onChange={e => setSemester(e.target.value)}><option value="">全部学期</option>{semesters.map(s => <option key={s}>{s}</option>)}</select></label>}{view === 'timetable' && !!dates.length && <label>教学日<select value={activeDate} onChange={e => setDate(e.target.value)}>{dates.map(d=><option key={d} value={d}>{weekdays[d] || d}</option>)}</select></label>}{view === 'exams' && !!examDates.length && <label>考试日期<select value={activeExamDate} onChange={e => setExamDate(e.target.value)}><option value="">全部日期</option>{examDates.map(d => <option key={d} value={d}>{d}</option>)}</select></label>}<label className="course-search">{view === 'exams' ? '查找考试' : '查找课程'}<input value={search} onChange={e => setSearch(e.target.value)} placeholder={view === 'exams' ? '课程代码、名称、考场或座位号' : '课程代码、名称'} /></label></div>
      {view === 'exams' && <ExamSchedule fetched={fetched} exams={exams} filtered={!!query || !!activeExamDate} issue={state.issues.exams} />}
      {view !== 'exams' && <>
      {!fetched ? <div className="empty"><div className="empty-icon">▤</div><h3>等待 eBridge 数据</h3><p>连接后读取学校的课程与课表信息。</p></div> : view === 'courses' ? !courses.length ? <div className="empty"><h3>{query || semester ? '没有匹配的课程' : '学校当前未返回课程'}</h3></div> : <div className="table-scroll"><table><thead><tr><th>课程代码</th><th>课程名称</th><th>学年 / 学期</th><th>学分 / 类型</th></tr></thead><tbody>{courses.map((c,i)=><tr key={`${c.code}:${c.year}:${c.semester}:${i}`}><td className="module-code"><strong>{c.code}</strong></td><td><strong>{c.title}</strong></td><td>{c.year || '—'}<small>{c.semester}</small></td><td>{c.credits || '—'}<small>{c.status}</small></td></tr>)}</tbody></table></div> : !entries.length ? <div className="empty"><h3>{query ? '没有匹配的课程' : '学校当前未返回课表'}</h3></div> : <div className="table-scroll"><table><thead><tr><th>时间 / 星期</th><th>课程</th><th>地点 / 周次</th><th>类型 / 教师</th></tr></thead><tbody>{entries.map(s=><tr key={s.id}><td><strong>{s.time}</strong><small>{weekdays[s.date] || s.date}</small></td><td><strong>{s.title}</strong><small>{s.code} · {s.group}</small></td><td>{s.room || '—'}<small>{s.weeks ? `第 ${s.weeks} 周` : '周次未提供'}</small></td><td>{s.type || '—'}<small>{s.staff}</small></td></tr>)}</tbody></table></div>}
      </>}
      <div className="schedule-footer"><span>来源：eBridge {current.source}</span><span>读取时间：{updatedAt(fetched)}</span></div>
    </section>
    </>}
    <footer className="page-footer"><p>{view === 'grades' ? '分项成绩与课程总评分别来自学校对应页面；刷新失败时保留上次结果。' : view === 'exams' ? '入场时间和开考时间分别展示，均使用学校标注的 UTC+8（北京时间）。' : view === 'timetable' ? '课表按星期与教学周展示；时间采用学校页面已预留课间移动时间的数值。' : '课程信息使用学校页面提供的学年与学期。'}</p><button className="text-button" disabled={!api || busy} onClick={() => setConfirm(true)}>断开 eBridge</button></footer>
    {confirm && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="ebridge-disconnect"><h2 id="ebridge-disconnect">断开 eBridge？</h2><p>清除 eBridge 的会话与页面数据，首页保存的学校账号保留。{state.localCache.enabled && ' 断开后也会关闭并清除本地缓存。'}</p><div className="actions"><button onClick={() => setConfirm(false)}>取消</button><button className="primary" onClick={() => {setConfirm(false); void run(() => api.disconnect())}}>断开 eBridge</button></div></div></div>}
  </>
}

function ExamSchedule({fetched,exams,filtered,issue}: {fetched:string|null; exams:EbridgeExam[]; filtered:boolean; issue:string|null}): React.JSX.Element {
  if (!fetched) return <div className="empty"><div className="empty-icon">▤</div><h3>{issue?'考试安排暂未读取成功':'等待考试安排'}</h3><p>{issue?'请点击“刷新教务信息”重新读取考试总览。':'连接后从学校 Timetables 总览读取个人考试表。'}</p></div>
  if (!exams.length) return <div className="empty"><h3>{filtered ? '没有匹配的考试' : '学校当前没有返回考试安排'}</h3>{!filtered && <p>可通过“打开学校原页”查看最新发布情况。</p>}</div>
  return <div className="table-scroll"><table className="exam-table">
    <thead><tr><th>考试日期</th><th>课程</th><th>开考 / 入场时间</th><th>考试时长</th><th>考场 / 校区</th><th>座位 / 入口</th></tr></thead>
    <tbody>{exams.map(e => <tr key={e.id}>
      <td><strong>{e.date || '待公布'}</strong><small>{dayLabel(e.day)}</small></td>
      <td className="exam-course"><strong>{e.code}</strong><small>{e.title || '课程名称未提供'}</small></td>
      <td><strong>{e.startTime || '待公布'}</strong><small>入场：{e.admissionTime || '未提供'}</small></td>
      <td>{e.duration || '未提供'}</td><td>{e.room || '待公布'}</td>
      <td><strong>座位：{e.seat || '待公布'}</strong>{e.area && <small>区域：{e.area}</small>}{e.entrance && <small>入口：{e.entrance}</small>}</td>
    </tr>)}</tbody>
  </table></div>
}
