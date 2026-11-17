import type { EbridgeCourse, EbridgeExam, EbridgeSession, EbridgeTerm } from '../shared/ebridge'

export interface PortalLink { text: string; href: string }
export interface PortalTable { headers: string[]; rows: string[][]; caption: string }
export interface PortalEvent { day: string; name: string; staff: string; location: string; weeks: string; time: string }
export interface PortalDocument { title: string; academicYear: string; links: PortalLink[]; tables: PortalTable[]; events: PortalEvent[]; calendar: boolean; frames: string[]; login: boolean; sso: boolean; empty: boolean }

export function selectPortalLink(links:PortalLink[],kind:'courses'|'timetable'|'calendar'):PortalLink|undefined {
  // The overview contains exams; the personal calendar only contains classes.
  const patterns=kind==='timetable'?[/^timetables?$/i]:kind==='calendar'?[/^my personal class timetable(?:\s*-.*)?$/i,/^(?:my timetable|personal timetable)$/i]:[/^(?:programme and module|my modules?|my module list|my module taking list|module taking list|module enrolments?|modules taken|view modules)$/i]
  for(const pattern of patterns){const found=links.find(link=>pattern.test(link.text));if(found)return found}
  return undefined
}

// Only DOM data needed for the academic views crosses into the main
// process. Session-bearing links stay in the connector, never in renderer IPC.
export const portalInspectionScript = `(() => {
  const allowed = ['https://ebridge.xjtlu.edu.cn', 'https://timetableplus.xjtlu.edu.cn'];
  if (!allowed.includes(location.origin)) return null;
  const clean = s => (s || '').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g, ' ').trim().slice(0, 600);
  const visible = e => !e.hidden && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const relevant = /timetable|my module|module taking|module enrol|programme and module|exam|assessment|academic calendar|课程|课表|考试|校历/i;
  const links = [...document.querySelectorAll('a[href]')].map(a => ({text:clean(a.innerText || a.textContent || a.getAttribute('title')), href:a.href})).filter(a => relevant.test(a.text));
  const tables = [...document.querySelectorAll('table')].map(table => {
    const allRows = [...table.rows];
    const headerRow = allRows.find(row => row.querySelector('th')) || allRows[0];
    const headers = headerRow ? [...headerRow.cells].map(c => clean(c.innerText || c.textContent)) : [];
    const exam = headers.some(h => /exam(?:ination)?\\s*(?:start\\s*time|date|duration|room)|考试(?:时间|日期|时长|地点)/i.test(h));
    if (!visible(table) && !exam) return null;
    return {headers, rows:allRows.filter(row => row !== headerRow && !row.querySelector('th')).slice(0, 2500).map(row => [...row.cells].map(c => clean(c.innerText || c.textContent))), caption:clean(table.caption?.innerText || table.caption?.textContent)};
  }).filter(t => t && /module|course|timetable|start time|activity|exam|assessment|duration|seat|课程|教学|星期|考试/i.test(t.headers.join(' ') + t.caption));
  // Exact selectors from the official Timetable Plus public page script.
  // data-day preserves day placement when parallel classes use extra columns.
  const events = [...document.querySelectorAll('table.timetable td[data-day] .event')].slice(0,2500).map(event => {
    const info = [...event.querySelectorAll('.event-info')].map(e => clean(e.innerText));
    return {day:clean(event.closest('td').dataset.day), name:clean(event.querySelector('.event-name')?.innerText), staff:info[0] || '', location:info[1] || '', weeks:info[2] || '', time:info[3] || ''};
  });
  const body = document.body?.innerText || '';
  return {title:clean(document.title), academicYear:body.match(/\\b20\\d{2}\\/\\d{2}\\b/)?.[0] || '', links, tables, events, calendar:!!document.querySelector('table.timetable'), frames:[...document.querySelectorAll('iframe[src],frame[src]')].map(f => f.src), login:!!document.querySelector('input[type=password]'), sso:!!document.getElementById('OpenIDButton'), empty:/no (?:scheduled timetable|modules|records|events|classes|timetable|data)|没有课程|暂无课程/i.test(body)};
})()`

function at(headers: string[], pattern: RegExp): number { return headers.findIndex(h => pattern.test(h)) }
function cell(row: string[], index: number): string { return index < 0 ? '' : (row[index] || '').trim() }
function isExamTable(table: PortalTable): boolean { return table.headers.some(h => /exam(?:ination)?\s*(?:start\s*time|date|duration|room)|考试(?:时间|日期|时长|地点)/i.test(h)) }

export function parseTimetableTerm(label:string):EbridgeTerm|null {
  const match=label.match(/\b(20\d{2}\/\d{2})\s+S([12])\b/i)
  return match?{year:match[1],semester:Number(match[2]) as 1|2}:null
}

// UK-style school dates are day/month/year. Parse explicitly so Windows locale
// cannot swap January 5 and May 1 or change the displayed UTC+8 exam date.
export function examDateKey(value: string): string | null {
  const text = value.trim().replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b[,\s]*/i, '')
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  let year: number, month: number, day: number
  let match: RegExpMatchArray | null
  if ((match = text.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})$/))) [, year, month, day] = match.map(Number)
  else if ((match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](20\d{2})$/))) [, day, month, year] = match.map(Number)
  else if ((match = text.match(/^(\d{1,2})[\s/-]+([A-Za-z]+)[\s,/-]+(20\d{2})$/))) { day = Number(match[1]); month = months.indexOf(match[2].slice(0,3).toLowerCase()) + 1; year = Number(match[3]) }
  else if ((match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})$/))) { month = months.indexOf(match[1].slice(0,3).toLowerCase()) + 1; day = Number(match[2]); year = Number(match[3]) }
  else return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null
}

export function parseExams(documents: PortalDocument[]): EbridgeExam[] | null {
  const exams: EbridgeExam[] = []
  let recognized = false
  for (const doc of documents) for (const table of doc.tables) {
    if (!isExamTable(table)) continue
    const code = at(table.headers, /^(?:module|course)\s*code$|^课程代码$/i)
    const title = at(table.headers, /^(?:module|course)\s*(?:title|name)$|^课程名称$/i)
    const date = at(table.headers, /^(?:exam(?:ination)?\s*)?date$|^考试日期$/i)
    const start = at(table.headers, /^exam(?:ination)?\s*start\s*time\b|^开考时间$|^考试开始时间$/i)
    // A changed source must be reported as unreadable rather than "no exams".
    if ([code,title,date,start].some(i => i < 0)) return null
    recognized = true
    for (const row of table.rows) {
      const text = row.join(' ').trim()
      if (!text || /^(?:no (?:records?|exams?|examinations?|data)(?:\b|\.)|暂无考试|没有考试)/i.test(text)) continue
      const moduleCode = cell(row,code)
      if (row.length <= Math.max(code,title,date,start) || !/^[A-Z]{2,6}\s?\d{2,4}[A-Z]?(?:[-_/].*)?$/i.test(moduleCode)) return null
      const exam = {
        code: moduleCode, title: cell(row,title), date: cell(row,date), dateKey: examDateKey(cell(row,date)),
        day: cell(row,at(table.headers,/^day$|^星期$/i)),
        admissionTime: cell(row,at(table.headers,/^admission\s*time\b|^入场时间$/i)), startTime: cell(row,start),
        duration: cell(row,at(table.headers,/exam(?:ination)?\s*duration|考试时长/i)),
        room: cell(row,at(table.headers,/exam(?:ination)?\s*(?:room|venue)|考场|考试地点/i)),
        seat: cell(row,at(table.headers,/^seat\s*(?:no\.?|number)?$|^座位号$/i)),
        area: cell(row,at(table.headers,/^area$|^区域$/i)), entrance: cell(row,at(table.headers,/^entrance$|^入口$/i))
      }
      // Keep every published sitting; separate rooms/seats may share a module.
      exams.push({id: JSON.stringify(Object.values(exam)), ...exam})
    }
  }
  return recognized ? [...new Map(exams.map(exam => [exam.id,exam])).values()].sort((a,b) => (a.dateKey || '9999').localeCompare(b.dateKey || '9999') || a.startTime.localeCompare(b.startTime, 'en', {numeric:true}) || a.code.localeCompare(b.code)) : null
}

export function parseCourses(documents: PortalDocument[]): EbridgeCourse[] | null {
  const courses: EbridgeCourse[] = []
  let recognized = false
  for (const doc of documents) for (const table of doc.tables) {
    if (isExamTable(table)) continue
    const code = at(table.headers, /(?:module|course)\s*(?:code|id)|^code$|课程代码/i)
    const title = at(table.headers, /(?:module|course)\s*(?:title|name)|^title$|课程名称/i)
    if (code < 0 || title < 0) continue
    recognized = true
    for (const row of table.rows) {
      const moduleCode = cell(row, code)
      if (!/^[A-Z]{2,6}\s?\d{2,4}[A-Z]?(?:[-_/].*)?$/i.test(moduleCode)) continue
      courses.push({ code: moduleCode, title: cell(row, title), year: cell(row, at(table.headers, /academic year|^year$|学年/i)) || doc.academicYear, semester: cell(row, at(table.headers, /semester|period|学期/i)), credits: cell(row, at(table.headers, /credit|学分/i)), status: cell(row, at(table.headers, /status|module type|状态/i)) })
    }
  }
  return recognized ? [...new Map(courses.map(c => [`${c.code}:${c.year}:${c.semester}`, c])).values()] : null
}

export function parseTimetable(documents: PortalDocument[]): EbridgeSession[] | null {
  const sessions: EbridgeSession[] = []
  let recognized = false
  for (const doc of documents) {
    if (!doc.calendar || (!doc.events.length && !doc.empty)) continue
    recognized = true
    for (const [index, event] of doc.events.entries()) {
      if (!/^(MON|TUE|WED|THU|FRI|SAT|SUN)$/.test(event.day)) continue
      const match = event.name.match(/^([A-Z]{2,6}\d{2,4}[A-Z]?)-(.*?)-(D\S+)$/i)
      if (!match || !/^\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}$/.test(event.time)) continue
      sessions.push({id:`${event.day}:${event.name}:${event.time}:${event.weeks}:${index}`, code:match[1], title:match[1], date:event.day, time:event.time, room:event.location, type:match[2], group:match[3], staff:event.staff, weeks:event.weeks.replace(/^Week:\s*/i,'')})
    }
  }
  for (const doc of documents) for (const table of doc.tables) {
    if (isExamTable(table)) continue
    const date = at(table.headers, /date|day|日期|星期/i)
    const time = at(table.headers, /time|时间/i)
    const title = at(table.headers, /module|course|activity|课程/i)
    if (date < 0 || time < 0 || title < 0) continue
    recognized = true
    table.rows.forEach((row, index) => {
      const name = cell(row, title), day = cell(row, date), start = cell(row, time)
      if (!name || !day || !start) return
      const end = cell(row, at(table.headers, /end time|finish|结束/i))
      const code = cell(row, at(table.headers, /(?:module|course)\s*code|课程代码/i)) || name.match(/\b[A-Z]{2,6}\s?\d{2,4}[A-Z]?\b/)?.[0] || ''
      sessions.push({ id: `${day}:${start}:${code}:${index}`, code, title: cell(row, at(table.headers, /(?:module|course)\s*(?:title|name)|课程名称/i)) || name, date: day, time: end && end !== start ? `${start} – ${end}` : start, room: cell(row, at(table.headers, /room|location|venue|教室|地点/i)), type: cell(row, at(table.headers, /type|类型/i)), staff: cell(row, at(table.headers, /staff|lecturer|teacher|tutor|教师/i)), weeks:'', group:'' })
    })
  }
  return recognized ? sessions.sort((a,b) => ['MON','TUE','WED','THU','FRI','SAT','SUN'].indexOf(a.date) - ['MON','TUE','WED','THU','FRI','SAT','SUN'].indexOf(b.date) || a.time.localeCompare(b.time)) : null
}
