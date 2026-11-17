import { useEffect, useState } from 'react'
import type { AmsBridge, AmsState } from '../../shared/ams'
import { percent, updatedAt } from './presentation'

export function ModulesView({ state, api, busy, run }: { state: AmsState; api: AmsBridge; busy: boolean; run: (operation: () => Promise<void>) => Promise<void> }): React.JSX.Element {
  const snapshot = state.moduleSnapshot
  const [academicYear, setAcademicYear] = useState('')
  const [semester, setSemester] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => { if (snapshot) { setAcademicYear(snapshot.term.academicYear); setSemester(snapshot.term.semester) } }, [snapshot?.term.academicYear, snapshot?.term.semester])
  const years = [...new Set([...state.termOptions.academicYears, ...(snapshot ? [snapshot.term.academicYear] : [])])]
  const semesters = [...new Set([...state.termOptions.semesters, ...(snapshot ? [snapshot.term.semester] : [])])]
  const modules = snapshot?.modules.filter((module) => `${module.code} ${module.title}`.toLowerCase().includes(query.trim().toLowerCase())) ?? []

  return <>
    {state.issues.modules && <div className="notice" role="status">{state.issues.modules} {snapshot && `当前保留 ${snapshot.term.academicYear} ${snapshot.term.semester} 的上次结果。`}</div>}
    <div className="module-stats"><section className="card"><span>Module 课程</span><strong>{snapshot ? snapshot.modules.length : '—'}<small>门</small></strong></section><section className="card"><span>总体签到率 · 学校原值</span><strong>{snapshot ? percent(snapshot.overallAttendanceRate) : '—'}</strong></section><section className="card"><span>当前显示的学年 / 学期</span><strong className="term-value">{snapshot ? `${snapshot.term.academicYear} · ${snapshot.term.semester}` : '等待学校数据'}</strong></section></div>
    <div className="section-heading"><div><h2>课程列表与签到率</h2><span>来自 AMS → Module → My Module</span></div><button className="text-button" disabled={!api || busy} onClick={() => void run(() => api.openModuleSource())}>打开 Module 原页 ↗</button></div>
    <section className="modules card">
      <form className="module-filters" onSubmit={(event) => { event.preventDefault(); void run(() => api.setTerm({ academicYear, semester })) }}>
        <label>学年<select value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} disabled={busy || !years.length}>{!years.length && <option value="">等待读取</option>}{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>学期<select value={semester} onChange={(event) => setSemester(event.target.value)} disabled={busy || !semesters.length}>{!semesters.length && <option value="">等待读取</option>}{semesters.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="submit" disabled={busy || !academicYear || !semester || !state.termOptions.academicYears.length}>查询学期</button>
        <label className="course-search"><span className="visually-hidden">筛选课程</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选课程代码或名称" /></label>
      </form>
      {!snapshot ? <div className="empty"><div className="empty-icon">▦</div><h3>等待 Module 课程数据</h3><p>连接成功后自动读取当前学期的课程列表和签到率。</p></div> : !modules.length ? <div className="empty"><h3>{query ? '没有匹配的课程' : '学校未返回该学期的课程'}</h3><p>{query ? '可以尝试其他课程代码或名称。' : '可切换学年学期，或打开学校原页核对。'}</p></div> : <div className="table-scroll"><table><thead><tr><th>课程代码</th><th>课程名称</th><th>签到率 · Attendance%</th></tr></thead><tbody>{modules.map((module, index) => <tr key={`${module.code}:${index}`}><td><strong className="module-code">{module.code}</strong></td><td><strong>{module.title}</strong></td><td><div className="module-rate"><strong>{percent(module.attendanceRate)}</strong>{module.attendanceRate !== null && <progress max={100} value={module.attendanceRate} aria-label={`${module.code} 签到率`} />}</div></td></tr>)}</tbody></table></div>}
      <div className="schedule-footer"><span>{snapshot ? `显示 ${modules.length} / ${snapshot.modules.length} 门 · AMS Module` : '来源：AMS Module'} · “暂无统计”与 0% 分别显示</span><span>读取时间：{updatedAt(snapshot?.fetchedAt ?? null)}{snapshot && ' · 北京时间'}</span></div>
    </section>
  </>
}
