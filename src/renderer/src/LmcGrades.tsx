import { LMC_SUBMISSION_TYPES, type LmcActivityResult, type LmcGradeReport, type LmcReadSnapshot } from '../../shared/lmc'
import { updatedAt } from './presentation'
import './lmc-grades.css'

function GradeTable({ report }: { report: LmcGradeReport }): React.JSX.Element {
  return <div className="table-scroll"><table className="lmc-grades-table">
    <thead><tr><th scope="col">成绩项目</th>{report.columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
    <tbody>{report.rows.map((item, index) => <tr key={index} className={`lmc-grade-${item.kind}`}>
      <th scope="row" colSpan={item.kind === 'category' ? report.columns.length + 1 : undefined}>{item.title}</th>
      {item.kind !== 'category' && report.columns.map(({ key }) => <td key={key}>{item.values[key] ?? '—'}</td>)}
    </tr>)}</tbody>
  </table></div>
}

export function CourseGrades({ snapshot }: { snapshot: LmcReadSnapshot<LmcGradeReport> | undefined }): React.JSX.Element {
  return <>
    {snapshot?.issue && <div className="notice" role="status">{snapshot.issue}</div>}
    {snapshot?.data?.rows.length ? <GradeTable report={snapshot.data} /> : <div className="empty"><h3>{
      snapshot?.loading ? '正在读取课程成绩…' : snapshot?.data ? '学校成绩表暂无记录' : '课程成绩尚未读取'
    }</h3></div>}
    <div className="lmc-updated">上次更新：{updatedAt(snapshot?.fetchedAt ?? null)}</div>
  </>
}

export function ActivityResult({ snapshot, report, activityId, type, loading, onRefresh, disabled }: {
  snapshot: LmcReadSnapshot<LmcActivityResult> | undefined
  report: LmcReadSnapshot<LmcGradeReport> | undefined
  activityId: string
  type: string
  loading: boolean
  onRefresh(): void
  disabled: boolean
}): React.JSX.Element {
  const hasSubmissionPage = LMC_SUBMISSION_TYPES.some(item => item === type)
  const courseGrades = hasSubmissionPage ? undefined : report
  const rows = courseGrades?.data?.rows.filter(row => row.activityId === activityId) ?? []
  const result = snapshot?.data
  return <div className="lmc-activity-result">
    <div className="lmc-activity-result-heading"><dl>
      {hasSubmissionPage && <div><dt>提交状态</dt><dd>{result?.submissionStatus ?? (loading ? '读取中…' : '学校未提供')}</dd></div>}
      {result?.gradingStatus && <div><dt>评分状态</dt><dd>{result.gradingStatus}</dd></div>}
      {(!rows.length && !result?.assessmentGrades?.length) && <div>
        <dt>{type === 'quiz' ? '测验总成绩' : hasSubmissionPage ? '提交成绩' : '课程 Grades'}</dt><dd>{result?.grade ?? '—'}</dd>
      </div>}
    </dl><button className="text-button" disabled={disabled} onClick={onRefresh}>刷新结果</button></div>
    {snapshot?.issue && <div className="notice" role="status">{snapshot.issue}</div>}
    {rows.length > 0 && courseGrades?.data && <GradeTable report={{ ...courseGrades.data, rows }} />}
    {courseGrades?.issue && <div className="notice" role="status">{courseGrades.issue}</div>}
    {!!result?.assessmentGrades?.length && <div className="lmc-assessment-grades">
      <h4>本次提交的互评分数</h4>
      <ul>{result.assessmentGrades.map((grade, index) => <li key={index}>{grade}</li>)}</ul>
    </div>}
    {!!result?.attempts.length && <div className="table-scroll"><table className="lmc-grades-table">
      <thead><tr><th scope="col">{type === 'quiz' ? '作答' : '历史提交'}</th><th scope="col">状态</th><th scope="col">时间</th><th scope="col">得分</th></tr></thead>
      <tbody>{result.attempts.map((attempt, index) => <tr key={index}>
        <th scope="row">{attempt.number ?? '—'}</th><td>{attempt.status || '—'}</td>
        <td>{attempt.submittedAt ?? (attempt.lastModifiedAt ? `${attempt.lastModifiedAt}（最后修改）` : '—')}</td>
        <td>{attempt.score === null ? '—' : attempt.scale ? `${attempt.score} / ${attempt.scale}` : attempt.score}
          {type === 'quiz' && attempt.scoreSource && <small className="lmc-attempt-source">
            {attempt.scoreSource === 'submission_page' ? '单次回顾页' : '作答列表'}
          </small>}
        </td>
      </tr>)}</tbody>
    </table></div>}
  </div>
}
