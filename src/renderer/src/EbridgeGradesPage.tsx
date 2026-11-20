import { Fragment, useState } from 'react'
import type { EbridgeAssessmentMark, EbridgeBridge, EbridgeGrades, EbridgeGradeView } from '../../shared/ebridge'
import type { ConnectionPhase } from '../../shared/ams'
import { updatedAt } from './presentation'
import './ebridge-grades.css'

export function EbridgeGradesPage({ data, phase, api, busy, run }: { data: EbridgeGrades; phase: ConnectionPhase; api: EbridgeBridge; busy: boolean; run: (operation: () => Promise<void>) => Promise<void> }): React.JSX.Element {
  const [view, setView] = useState<EbridgeGradeView>('components')
  const [year, setYear] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const all = data[view], fetched = view === 'components' ? data.componentsAt : data.recordsAt
  const years = [...new Set(all.map(module => module.year).filter(Boolean))].sort().reverse()
  const activeYear = years.includes(year) ? year : ''
  const query = search.trim().toLowerCase()
  const modules = all.filter(module => (!activeYear || module.year === activeYear) && `${module.code} ${module.title} ${module.components.map(row => row.title).join(' ')}`.toLowerCase().includes(query))
  const assessments = modules.flatMap(module => module.components)
  const disabled = !api || busy || data.loading || phase !== 'connected'
  const issue = data.issues[view]
  return <>
    <section className="card ebridge-grades-toolbar">
      <div className="ebridge-grade-heading"><div><h2>成绩查询</h2><p>分项成绩与课程总评分开查看，以学校公布的结果为准。</p></div><div className="actions"><button className="text-button" disabled={disabled} onClick={() => void run(() => api.openGradeSource(view))}>学校原页 ↗</button><button className="primary" disabled={disabled} onClick={() => void run(() => api.loadGrades())}>{data.loading ? '正在查询…' : fetched ? '刷新成绩' : '查询成绩'}</button></div></div>
      <div className="ebridge-grade-views" role="group" aria-label="成绩类别"><button className={view === 'components' ? 'active' : ''} aria-pressed={view === 'components'} onClick={() => setView('components')}>当学年分项成绩</button><button className={view === 'records' ? 'active' : ''} aria-pressed={view === 'records'} onClick={() => setView('records')}>完整成绩记录</button></div>
      <div className="module-filters"><label>学年<select value={activeYear} onChange={event => setYear(event.target.value)}><option value="">全部学年</option>{years.map(value => <option key={value}>{value}</option>)}</select></label><label className="course-search">查找课程 / 考核<input value={search} onChange={event => setSearch(event.target.value)} placeholder="课程代码、名称或考核项目" /></label></div>
    </section>
    {issue && <div className="notice" role="status">{issue}{fetched && ' 以下保留上次读取的数据。'}</div>}
    {!fetched ? <section className="card empty"><div className="empty-icon">▤</div><h3>{data.loading ? '正在读取学校成绩…' : issue ? '成绩暂未读取成功' : '等待查询成绩'}</h3><p>{phase !== 'connected' ? '请先连接 eBridge，再查询成绩。' : '点击“查询成绩”，读取 Academic Records 下的学校成绩页面。'}</p></section> : <>
      <div className="ebridge-grade-summary"><span><strong>{modules.length}</strong> 门课程</span>{view === 'components' ? <><span><strong>{assessments.length}</strong> 项考核</span><span><strong>{assessments.filter(row => row.mark !== null).length}</strong> 项已有成绩</span></> : <span><strong>{modules.filter(module => module.mark !== null).length}</strong> 门已有总评</span>}<span className="ebridge-grade-updated">上次读取：{updatedAt(fetched)}</span></div>
      {!modules.length ? <section className="card empty"><h3>{query || activeYear ? '没有匹配的成绩记录' : '学校当前没有返回成绩记录'}</h3><p>可打开学校原页确认最新公布情况。</p></section> : view === 'components' ? <div className="ebridge-grade-modules">{modules.map(module => <section className="card ebridge-grade-module" key={module.id}><div className="ebridge-grade-module-heading"><div><span className="ebridge-grade-code">{module.code}</span><h3>{module.title || module.code}</h3></div><span>{module.year || '学年未提供'}</span></div><AssessmentTable rows={module.components} /></section>)}</div> : <section className="card table-scroll"><table className="ebridge-records-table"><thead><tr><th>学年 / 学期</th><th>课程</th><th>学分 / 类型</th><th>总评</th><th>等级</th><th>次数</th><th>分项成绩</th></tr></thead><tbody>{modules.map(module => <Fragment key={module.id}><tr><td>{module.year || '—'}<small>{module.period || '—'}</small></td><td><strong>{module.code}</strong><small>{module.title}</small></td><td>{module.credits || '—'}<small>{module.moduleType}</small></td><td><Mark value={module.mark} /></td><td>{module.grade ?? '—'}</td><td>{module.attempt || '—'}</td><td>{module.components.length ? <button className="text-button" aria-expanded={expanded.has(module.id)} onClick={() => { const next = new Set(expanded); if (next.has(module.id)) next.delete(module.id); else next.add(module.id); setExpanded(next) }}>{expanded.has(module.id) ? '收起' : `查看 ${module.components.length} 项`}</button> : '—'}</td></tr>{expanded.has(module.id) && <tr className="ebridge-grade-detail"><td colSpan={7}><AssessmentTable rows={module.components} /></td></tr>}</Fragment>)}</tbody></table></section>}
    </>}
    <p className="ebridge-grade-note">来源：eBridge Academic Records · {view === 'components' ? 'Component Marks' : 'Full Academic Records'}。空白显示“暂无成绩”，不按分项成绩推算总评或平均分。</p>
  </>
}

function Mark({ value }: { value: string | null }): React.JSX.Element { return value === null ? <span className="ebridge-mark-pending">暂无成绩</span> : <strong className="ebridge-mark-value">{value}</strong> }
function AssessmentTable({ rows }: { rows: EbridgeAssessmentMark[] }): React.JSX.Element {
  if (!rows.length) return <div className="ebridge-assessment-empty">学校未提供分项记录。</div>
  return <div className="table-scroll"><table className="ebridge-assessment-table"><thead><tr><th>考核项目</th><th>类型</th><th>比重</th><th>成绩</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.title}:${index}`}><td>{row.title}</td><td>{row.type || '—'}</td><td>{row.weight || '—'}</td><td><Mark value={row.mark} /></td></tr>)}</tbody></table></div>
}
