import { z } from 'zod'
import { LMC_GRADE_COLUMNS, LMC_ORIGIN } from '../shared/lmc.ts'
import { lmcId } from './lmc.ts'

export const lmcActivityId = z.string().regex(/^activity:[1-9]\d{0,11}:[a-z][a-z0-9_]{0,40}:[1-9]\d{0,11}$/)
const gradeColumn = z.enum(LMC_GRADE_COLUMNS)
const nullableText = z.string().max(1000).nullable()
export const lmcGradeReport = z.object({
  columns: z.array(z.object({ key: gradeColumn, label: z.string().max(160) })).max(LMC_GRADE_COLUMNS.length),
  rows: z.array(z.object({
    title: z.string().min(1).max(1000),
    kind: z.enum(['category', 'total', 'item']),
    activityId: lmcActivityId.nullable(),
    values: z.partialRecord(gradeColumn, z.string().max(5000).nullable())
  })).max(5000)
})
export const lmcAssessmentResult = z.object({
  submissionStatus: nullableText,
  gradingStatus: nullableText,
  grade: nullableText,
  attempts: z.array(z.object({
    number: nullableText, status: z.string().max(1000), submittedAt: nullableText, lastModifiedAt: nullableText.optional(),
    score: nullableText, scale: nullableText, scoreSource: z.enum(['submission_page', 'activity_page']).nullable().optional()
  })).max(200),
  assessmentGrades: z.array(z.string().max(1000)).max(200).optional()
})

// Fetch the existing student pages without rendering the response or submitting its forms.
function schoolPage(path: string, query: string, read: string): string {
  return String.raw`(async () => {
    if (location.origin !== ${JSON.stringify(LMC_ORIGIN)} || !globalThis.M?.cfg?.sesskey) return {ok:false,reason:'auth'};
    const url = new URL(${JSON.stringify(path)}, location.origin);
    ${query}
    const text = (element, limit = 1000) => {
      if (!element) return null;
      const copy = element.cloneNode(true);
      copy.querySelectorAll('script,style,.accesshide,.sr-only,.visually-hidden,.gradestatus,[hidden]').forEach(node => node.remove());
      copy.querySelectorAll('br').forEach(node => node.replaceWith(' '));
      const value = copy.textContent.replace(/https?:\/\/[^\s<>"']+/gi, '[学校链接]')
        .replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
      return !value || /^[-–—]$/.test(value) ? null : value.slice(0, limit);
    };
    const signal = AbortSignal.timeout(15000);
    const readPage = async (target) => {
      try {
        const response = await fetch(target, {credentials:'same-origin', redirect:'manual', signal});
        if (response.type === 'opaqueredirect' || response.status === 401) return {ok:false,reason:'auth'};
        if (!response.ok) return {ok:false};
        const body = await response.text();
        if (body.length > 6000000) return {ok:false};
        const template = document.createElement('template');
        template.innerHTML = body;
        const root = template.content;
        if (root.querySelector('#page-login-index, form#login input[type="password"]')) return {ok:false,reason:'auth'};
        return {ok:true,root};
      } catch { return {ok:false}; }
    };
    try {
      const page = await readPage(url);
      if (!page.ok) return page;
      const root = page.root;
      ${read}
    } catch { return {ok:false}; }
  })()`
}

export function lmcCourseGradesScript(courseId: string): string {
  const id = lmcId.parse(courseId)
  return schoolPage('/grade/report/user/index.php', String.raw`
    const user = String(M.cfg.userId ?? M.cfg.userid ?? '');
    if (!/^[1-9]\d{0,11}$/.test(user)) return {ok:false};
    url.searchParams.set('id', ${JSON.stringify(id)});
    url.searchParams.set('userid', user);
  `, String.raw`
    const table = [...root.querySelectorAll('table.user-grade')].find(table =>
      table.querySelector('thead .column-itemname')?.id === 'itemname' + user
    );
    if (!table) return {ok:false};
    const keys = ${JSON.stringify(LMC_GRADE_COLUMNS)};
    const columns = [...table.querySelectorAll('thead th')].flatMap(th => {
      const key = keys.find(key => th.classList.contains('column-' + key));
      return key ? [{key, label:text(th, 160) ?? key}] : [];
    });
    const rows = [];
    for (const row of table.querySelectorAll(':scope > tbody > tr')) {
      const heading = row.querySelector(':scope > .column-itemname');
      if (!heading) continue;
      const kind = heading.classList.contains('category') ? 'category'
        : heading.matches('.categoryitem, .courseitem') || heading.querySelector('.categoryitem, .courseitem') ? 'total' : 'item';
      let activityId = null, title = null;
      for (const anchor of heading.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href');
        if (!URL.canParse(href, url)) continue;
        const target = new URL(href, url);
        const type = target.pathname.match(/^\/mod\/([a-z][a-z0-9_]{0,40})\/view\.php$/)?.[1];
        const id = target.searchParams.get('id');
        if (target.origin !== location.origin || !type || !/^[1-9]\d{0,11}$/.test(id ?? '')) continue;
        activityId = 'activity:' + ${JSON.stringify(id)} + ':' + type + ':' + id;
        title = text(anchor);
        break;
      }
      title ??= text(heading.querySelector('.rowtitle') ?? heading);
      if (!title) continue;
      const values = kind === 'category' ? {} : Object.fromEntries(columns.map(({key}) => {
        const cell = row.querySelector(':scope > .column-' + key);
        if (key === 'grade' && cell?.matches('.datesubmitted, .gradingerror')) return [key, null];
        return [key, text(cell, key === 'feedback' ? 5000 : 240)];
      }));
      rows.push({title, kind, activityId, values});
      if (rows.length >= 5000) return {ok:false};
    }
    return {ok:true,data:{columns,rows}};
  `)
}

export function lmcActivityResultScript(type: 'assign' | 'quiz' | 'workshop', cmid: string): string {
  return schoolPage('/mod/' + type + '/view.php',
    'const cmid = ' + JSON.stringify(lmcId.parse(cmid)) + '; url.searchParams.set("id", cmid);',
    activityReaders[type])
}

const readTableCell = String.raw`
  const findCell = (section, label) => {
    for (const row of section?.querySelectorAll('tr') ?? []) {
      if (label.test(text(row.cells[0]) ?? '')) return row.cells[1] ?? null;
    }
    return null;
  };
  const gradeLabel = /^(grade|成绩|分数|评分|成績|評分)$/i;
`

const readOnlyLink = String.raw`
  const readLink = (anchor, path, keys) => {
    const href = anchor?.getAttribute('href');
    if (!href || !URL.canParse(href, url)) return null;
    const target = new URL(href, url);
    if (target.origin !== url.origin || target.username || target.password || target.pathname !== path) return null;
    const params = [...target.searchParams.keys()];
    if (params.some(key => !keys.includes(key)) || new Set(params).size !== params.length) return null;
    target.hash = '';
    return target;
  };
  const isId = value => /^[1-9]\d{0,11}$/.test(value ?? '');
`

const assignment = String.raw`
  ${readTableCell}
  const submission = root.querySelector('#region-main .submissionstatustable');
  const feedback = root.querySelector('#region-main .feedbacktable');
  const history = root.querySelector('#region-main .attempthistory');
  if (!submission && !feedback && !history) return {ok:false};
  const submissionLabel = /^(submission status|提交状态|繳交狀態|提交狀態)$/i;
  const statusCell = findCell(submission, submissionLabel)
    ?? submission?.querySelector('.submissionstatus,.submissionstatussubmitted,.submissionstatusdraft,.submissionstatusreopened,.submissionstatusnew');
  const statusCopy = statusCell?.cloneNode(true);
  statusCopy?.querySelectorAll('div,a').forEach(node => node.remove());
  const gradingCell = findCell(submission, /^(grading status|批改状态|评分状态|評分狀態)$/i)
    ?? submission?.querySelector('.submissiongraded,.submissionnotgraded');
  const attempts = [];
  for (const table of history?.querySelectorAll(':scope > table') ?? []) {
    const heading = text(table.caption) ?? text(table.previousElementSibling) ?? '';
    const attempt = heading.match(/^(?:attempt\s+|第\s*)(\d+)(?:\s*次)?\s*[:：]\s*/i);
    const status = text(findCell(table, submissionLabel));
    const score = text(findCell(table, gradeLabel));
    if (status || score) attempts.push({
      number:attempt?.[1] ?? null, status:status ?? '', submittedAt:null,
      lastModifiedAt:attempt ? heading.slice(attempt[0].length) || null : null,
      score, scale:null, scoreSource:score === null ? null : 'submission_page'
    });
    if (attempts.length === 200) break;
  }
  const grade = text(findCell(feedback, gradeLabel));
  return {ok:true,data:{submissionStatus:text(statusCopy),gradingStatus:text(gradingCell),grade,attempts}};
`

const quiz = String.raw`
  ${readTableCell}
  ${readOnlyLink}
  const rootMain = root.querySelector('#region-main');
  if (!rootMain) return {ok:false};
  const table = rootMain.querySelector('table.quizattemptsummary');
  const headers = [...(table?.querySelectorAll('thead th') ?? [])].map(th => text(th) ?? '');
  const attemptColumn = headers.findIndex(label => /^(attempt|尝试|作答|作答次数|試答|次數)$/i.test(label));
  const stateColumn = headers.findIndex(label => /^(state|status|状态|狀態)$/i.test(label));
  const gradeColumn = headers.findIndex(label => /^(grade|成绩|成績|評分)(?:\s*\/|$)/i.test(label));
  const marksColumn = headers.findIndex(label => /^(marks?|分数|得分)(?:\s*\/|$)/i.test(label));
  const scoreColumn = gradeColumn >= 0 ? gradeColumn : marksColumn;
  const scale = headers[scoreColumn]?.split('/').slice(1).join('/').trim() || null;
  const attempts = [], reviews = [];
  for (const row of table?.querySelectorAll(':scope > tbody > tr') ?? []) {
    const number = text(row.cells[attemptColumn]);
    if (number && !/^\d+$/.test(number)) continue;
    const stateCell = row.cells[stateColumn];
    const statusCopy = stateCell?.cloneNode(true);
    statusCopy?.querySelector('.statedetails')?.remove();
    const status = text(statusCopy);
    if (!status) continue;
    const finished = /^(finished|已完成|已提交)$/i.test(status);
    const submittedAt = finished ? text(stateCell.querySelector('.statedetails')) : null;
    const score = text(row.cells[scoreColumn]);
    const attempt = {number, status, submittedAt, score, scale, scoreSource:score === null ? null : 'activity_page'};
    attempts.push(attempt);
    for (const anchor of row.querySelectorAll('a[href]')) {
      const target = readLink(anchor, '/mod/quiz/review.php', ['attempt', 'cmid', 'page', 'showall']);
      if (!target || !isId(target.searchParams.get('attempt'))
        || target.searchParams.has('cmid') && target.searchParams.get('cmid') !== cmid) continue;
      // Only the first page has the full grade summary on standard Moodle.
      target.searchParams.delete('page');
      target.searchParams.set('showall', '0');
      reviews.push({attempt, target});
      break;
    }
    if (attempts.length >= 200) return {ok:false};
  }
  // Avoid fetching every historical review during a single activity read.
  for (const {attempt, target} of reviews.slice(-6).reverse()) {
    if (signal.aborted) break;
    const review = await readPage(target);
    if (!review.ok) continue;
    const summary = review.root.querySelector('#region-main .quizreviewsummary');
    if (!summary) continue;
    const scoreCell = findCell(summary, gradeLabel) ?? findCell(summary, /^(marks?|得分|分数)$/i);
    attempt.status = text(findCell(summary, /^(state|status|状态|狀態)$/i)) ?? attempt.status;
    attempt.submittedAt = text(findCell(summary, /^(completed(?: on)?|submitted(?: on)?|完成时间|完成時間|提交时间|提交時間|完成于|完成於)$/i))
      ?? attempt.submittedAt;
    if (scoreCell) {
      const reviewScore = text(scoreCell);
      attempt.score = /^(not yet graded|未评分|尚未评分|尚未評分)$/i.test(reviewScore ?? '') ? null : reviewScore;
      attempt.scale = null;
      attempt.scoreSource = attempt.score === null ? null : 'submission_page';
    }
  }
  const result = [...rootMain.querySelectorAll('#feedback h3')].map(h => text(h)).find(label =>
    label && /^(your (final grade|grade so far)|你的最终成绩|您的最终成绩|你的当前成绩|您的当前成绩)/i.test(label)
  );
  const latest = attempts.at(-1)?.status ?? null;
  const start = text(rootMain.querySelector('.quizstartbuttondiv button'));
  const submissionStatus = latest && /^(finished|completed|已完成|已提交)$/i.test(latest) ? '已提交'
    : latest ?? (start && /^(attempt quiz(?: now)?|开始测验|开始作答|参与测验)$/i.test(start) ? '未作答' : null);
  return {ok:true,data:{submissionStatus,gradingStatus:null,grade:result ?? null,attempts}};
`

const workshop = String.raw`
  ${readOnlyLink}
  const own = root.querySelector('#region-main .ownsubmission');
  const summary = own?.querySelector('.submission-summary');
  const submissionStatus = summary ? '已提交'
    : own && /^(you have not submitted|尚未提交|你还没有提交)/i.test(text(own) ?? '') ? '未提交' : null;
  const target = readLink(summary?.querySelector('a.title[href]'), '/mod/workshop/submission.php', ['cmid', 'id']);
  const assessmentGrades = [];
  if (target && target.searchParams.get('cmid') === cmid && isId(target.searchParams.get('id'))) {
    const submission = await readPage(target);
    if (submission.ok && submission.root.querySelector('#region-main .submission-full')) {
      for (const grade of submission.root.querySelectorAll('#region-main .assessment-full > .header > .grade:not(.nograde)')) {
        const score = text(grade);
        if (score !== null) assessmentGrades.push(score);
        if (assessmentGrades.length === 200) break;
      }
    }
  }
  return {ok:true,data:{submissionStatus,gradingStatus:text(summary?.querySelector('.grade-status')),grade:null,attempts:[],assessmentGrades}};
`

const activityReaders: Record<'assign' | 'quiz' | 'workshop', string> = { assign: assignment, quiz, workshop }
