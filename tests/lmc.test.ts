import { it } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { cleanLmcAssignmentDates, lmcAcademicUrl, lmcAjaxScript, lmcAssignmentCardsScript, lmcAssignmentPageInspection, lmcCourseInspection, lmcDownloadAllowed, lmcFileInspection, lmcFileUrl, lmcResourceUrl, lmcSchoolUrl, lmcText, parseLmcCourses, parseLmcNotifications, safeLmcFilename } from '../src/providers/lmc.ts'
import { LMC_ORIGIN } from '../src/shared/lmc.ts'

const file = `${LMC_ORIGIN}/pluginfile.php/42/mod_resource/content/1/example.pdf`
const folderFile = `${LMC_ORIGIN}/pluginfile.php/43/mod_folder/content/0/Week%201/example.pdf?forcedownload=1`
const resource = `${LMC_ORIGIN}/mod/resource/view.php?id=12`

it('LMC restricts school navigation and files to observed official course routes', () => {
  assert.ok(lmcSchoolUrl(`${LMC_ORIGIN}/my/`))
  assert.ok(lmcSchoolUrl('https://uim.xjtlu.edu.cn/esc-sso/login/page'))
  assert.ok(lmcSchoolUrl('https://sso.xjtlu.edu.cn/bind'))
  assert.equal(lmcAcademicUrl('https://uim.xjtlu.edu.cn/'), false)
  assert.equal(lmcAcademicUrl('https://sso.xjtlu.edu.cn/bind'), false)
  for (const url of ['http://core.xjtlu.edu.cn/', 'https://core.xjtlu.edu.cn.evil.invalid/', 'https://user:pass@core.xjtlu.edu.cn/', 'https://core.xjtlu.edu.cn:8443/']) assert.equal(lmcSchoolUrl(url), false)
  assert.ok(lmcFileUrl(file)); assert.ok(lmcFileUrl(folderFile))
  assert.ok(lmcFileUrl(`${LMC_ORIGIN}/pluginfile.php?file=%2F43%2Fmod_folder%2Fcontent%2F0%2Fexample.pdf`))
  for (const url of [`${LMC_ORIGIN}/pluginfile.php/1/user/icon/example.png`, `${file}?token=private`, `${LMC_ORIGIN}/pluginfile.php?file=%2F43%2Fmod_folder%2Fcontent%2F0%2F..%2Fexample.pdf`, `${LMC_ORIGIN}/pluginfile.php/43/mod_folder/content/0/%252e%252e/example.pdf`, 'https://example.invalid/file.pdf']) assert.equal(lmcFileUrl(url), false)
  assert.ok(lmcResourceUrl(resource))
  assert.equal(lmcResourceUrl(`${resource}&redirect=https://example.invalid`), false)
})

it('LMC accepts only the explicitly requested download chain and school initiator', () => {
  const expected = new Set([resource])
  assert.equal(lmcDownloadAllowed(expected, [resource, file], LMC_ORIGIN), true)
  assert.equal(lmcDownloadAllowed(new Set([folderFile]), [folderFile], ''), true)
  assert.equal(lmcDownloadAllowed(expected, [file], LMC_ORIGIN), false)
  assert.equal(lmcDownloadAllowed(expected, [resource, 'https://example.invalid/file.pdf'], LMC_ORIGIN), false)
  assert.equal(lmcDownloadAllowed(expected, [resource, file], 'https://uim.xjtlu.edu.cn'), false)
  assert.equal(lmcDownloadAllowed(expected, [], ''), false)
})

it('LMC preserves filename extensions while removing Windows path and device-name hazards', () => {
  assert.equal(safeLmcFilename('Example notes.pdf'), 'Example notes.pdf')
  for (const input of ['../example.pdf', 'C:\\file.txt:stream', 'CON.pdf', 'NUL', '..', 'a'.repeat(179) + '.more']) {
    const value = safeLmcFilename(input)
    assert.doesNotMatch(value, /[\\/:*?"<>|]|[. ]$/)
    assert.doesNotMatch(value, /^(?:con|nul)(?:\.|$)/i)
  }
})

it('LMC distinguishes an empty course list from a failed or malformed response', () => {
  assert.deepEqual(parseLmcCourses({ courses: [] }), [])
  assert.deepEqual(parseLmcCourses({ courses: [{ id: 12, fullname: 'Synthetic course', shortname: 'DEMO101' }] }), [{ id: '12', title: 'Synthetic course', shortName: 'DEMO101' }])
  for (const input of [{}, { courses: null }, { courses: [{ id: 0, fullname: 'Invalid' }] }]) assert.throws(() => parseLmcCourses(input))
})

it('LMC keeps notification read state and dates while hiding session links', () => {
  const sample = { id: 1, subject: 'Synthetic notification', body: 'Details https://core.xjtlu.edu.cn/example?sesskey=PRIVATE', timecreated: 1_795_000_000, read: 0, component: 'mod_forum', contexturl: `${LMC_ORIGIN}/mod/forum/discuss.php?d=12` }
  const result = parseLmcNotifications({ notifications: [sample, { ...sample, id: 2, read: true, contexturl: `${LMC_ORIGIN}/login/logout.php?sesskey=PRIVATE` }], unreadcount: 7 })
  assert.equal(result.unreadCount, 7)
  assert.equal(result.items[0].read, false)
  assert.equal(result.items[1].read, true)
  assert.equal(result.items[0].hasSource, true)
  assert.equal(result.items[1].privateUrl, null)
  assert.match(result.items[0].createdAt!, /^2026-/)
  const publicItems = result.items.map(({ privateUrl: _url, ...item }) => item)
  assert.doesNotMatch(JSON.stringify(publicItems), /PRIVATE|https:/)
  assert.deepEqual(parseLmcNotifications({ notifications: [], unreadcount: 0 }).items, [])
  assert.equal(parseLmcNotifications({ notifications: [{ ...sample, component: null, contexturl: null }], unreadcount: 1 }).items[0].hasSource, false)
  assert.throws(() => parseLmcNotifications({ notifications: null, unreadcount: 0 }))
  assert.equal(lmcText('https://uim.xjtlu.edu.cn/?Signature=PRIVATE'), '[学校链接]')
})

it('LMC AJAX uses the current-user read method and keeps credentials inside the school context', async () => {
  let call: any
  class Parser { parseFromString(value: string): any { return { querySelectorAll: () => [], body: { textContent: value } } } }
  const context = {
    location: { origin: LMC_ORIGIN }, M: { cfg: { sesskey: 'SYNTHETIC-SECRET' } }, DOMParser: Parser, URL, AbortSignal,
    fetch: async (url: URL, options: any) => { call = { url, options }; return { ok: true, text: async () => JSON.stringify([{ error: false, data: { notifications: [], unreadcount: 0 } }]) } }
  }
  const response = await runInNewContext(lmcAjaxScript('notifications', 20), context)
  assert.equal(response.ok, true)
  const request = JSON.parse(call.options.body)[0]
  assert.equal(request.methodname, 'message_popup_get_popup_notifications')
  assert.deepEqual(request.args, { useridto: 0, newestfirst: true, limit: 20, offset: 20 })
  assert.equal(call.options.credentials, 'same-origin')
  assert.doesNotMatch(JSON.stringify(response), /SYNTHETIC-SECRET/)
  assert.doesNotMatch(call.options.body, /mark.*read|delete|update/)
})

it('LMC inspection scripts parse as JavaScript without adding any document-extraction endpoint', () => {
  assert.doesNotThrow(() => new Function(lmcCourseInspection))
  assert.doesNotThrow(() => new Function(lmcFileInspection))
})

it('LMC asks Core for last-access order and preserves that order across a course page', async () => {
  let args: any
  class Parser { parseFromString(value: string): any { return { querySelectorAll: () => [], body: { textContent: value } } } }
  const result = await runInNewContext(lmcAjaxScript('courses', 50), {
    location: { origin: LMC_ORIGIN }, M: { cfg: { sesskey: 'SYNTHETIC-SECRET' } }, DOMParser: Parser, URL, AbortSignal,
    fetch: async (_url: URL, options: any) => { args = JSON.parse(options.body)[0].args; return { ok: true, text: async () => JSON.stringify([{ error: false, data: { courses: [{ id: 2, fullname: 'Zeta' }, { id: 1, fullname: 'Alpha' }] } }]) } }
  })
  assert.deepEqual(args, { classification: 'all', limit: 50, offset: 50, sort: 'ul.timeaccess desc' })
  assert.deepEqual(parseLmcCourses(result.data).map(course => course.title), ['Zeta', 'Alpha'])
})

it('LMC includes weekly files outside the tiles main region and waits for the course index', () => {
  const label = (text: string): any => ({ textContent: text, cloneNode: () => ({ textContent: text, querySelectorAll: () => [] }) })
  const section = { querySelector: () => label('Weekly notes') }
  const activity = { querySelector: () => ({ src: `${LMC_ORIGIN}/theme/image.php/theme/core/1/f/pdf` }), closest: () => null }
  const link = (id: number, main = false): any => ({ ...label(`File ${id}`), href: `${LMC_ORIGIN}/mod/resource/view.php?id=${id}`, querySelector: () => null, closest: (selector: string) => selector === '.activity' ? main ? activity : null : section })
  let ready = false
  const root = { querySelectorAll: () => [link(1, true)] }
  const document = { body: { id: 'page-course-view-tiles' }, querySelectorAll: () => [link(1), link(2)], querySelector: (selector: string) => selector === '#region-main' ? root : selector === '#courseindex' ? {} : selector.startsWith('#courseindex ') ? ready ? section : null : null }
  assert.equal(runInNewContext(lmcCourseInspection, { document, location: { origin: LMC_ORIGIN }, URL }).indexReady, false)
  ready = true
  const result = runInNewContext(lmcCourseInspection, { document, location: { origin: LMC_ORIGIN }, URL })
  assert.equal(result.indexReady, true)
  assert.deepEqual(Array.from(result.activities, (row: any) => [row.cmid, row.section, row.fileType]), [['1', 'Weekly notes', 'pdf'], ['2', 'Weekly notes', '']])
})

it('LMC uses only assignment opening and due labels in the rendered activity card', () => {
  const row = (label: string, value: string) => ({ textContent: `${label} ${value}`, querySelector: () => ({ textContent: label }) })
  const dates = { children: [row('Opened:', 'Monday, 2 November 2026, 9:00 AM'), row('截止日期：', '16 November 2026, 11:55 PM'), row('Cut-off date:', '17 November 2026, 11:55 PM')] }
  const activity = { querySelector: () => null, querySelectorAll: () => [dates], closest: () => null }
  const link = (type: string, id: number, hasCard: boolean) => ({
    href: `${LMC_ORIGIN}/mod/${type}/view.php?id=${id}`,
    textContent: `Activity ${id}`,
    cloneNode: () => ({ textContent: `Activity ${id}`, querySelectorAll: () => [] }),
    querySelector: () => null,
    closest: (selector: string) => selector === '.activity' && hasCard ? activity : null
  })
  const root = { querySelectorAll: () => [link('assign', 1, true), link('quiz', 2, true)] }
  const document = {
    body: { id: 'page-course-view-tiles' },
    querySelectorAll: () => [link('assign', 1, false), link('quiz', 2, false), link('assign', 3, false)],
    querySelector: (selector: string) => selector === '#region-main' ? root : null
  }
  const result = runInNewContext(lmcCourseInspection, { document, location: { origin: LMC_ORIGIN }, URL })
  assert.deepEqual(cleanLmcAssignmentDates(result.activities[0].assignmentDates), {
    opens: 'Monday, 2 November 2026, 9:00 AM', due: '16 November 2026, 11:55 PM'
  })
  assert.equal(result.activities[1].assignmentDates, undefined)
  assert.equal(result.activities[2].assignmentDates, undefined)
})

it('LMC reads a tile assignment card without navigating to an assignment', async () => {
  const row = { textContent: 'Due: 16 November 2026, 11:55 PM', querySelector: () => ({ textContent: 'Due:' }) }
  const card = { querySelectorAll: () => [{ children: [row] }] }
  const template = { innerHTML: '', content: { querySelector: (selector: string) => selector === '#module-30.modtype_assign' ? card : null } }
  const response = await runInNewContext(lmcAssignmentCardsScript(['30', '31']), {
    document: { createElement: () => template }, location: { origin: LMC_ORIGIN }, URL, AbortSignal, M: { cfg: { sesskey: 'test' } },
    fetch: async (url: URL, options: RequestInit) => {
      assert.equal(url.pathname, '/lib/ajax/service.php')
      assert.equal(options.redirect, 'error')
      assert.deepEqual(JSON.parse(String(options.body)), [
        { index: 0, methodname: 'core_course_get_module', args: { id: 30 } },
        { index: 1, methodname: 'core_course_get_module', args: { id: 31 } }
      ])
      return { ok: true, text: async () => JSON.stringify([{ error: false, data: '<li id="module-30"></li>' }, { error: true }]) }
    }
  })
  assert.equal(response.length, 1)
  assert.equal(response[0][0], '30')
  assert.deepEqual(cleanLmcAssignmentDates(response[0][1]), { opens: null, due: '16 November 2026, 11:55 PM' })

  const opened = runInNewContext(lmcAssignmentPageInspection, {
    document: { body: { id: 'page-mod-assign-view' }, querySelector: () => card }, location: { origin: LMC_ORIGIN }
  })
  assert.deepEqual(cleanLmcAssignmentDates(opened), { opens: null, due: '16 November 2026, 11:55 PM' })
})
