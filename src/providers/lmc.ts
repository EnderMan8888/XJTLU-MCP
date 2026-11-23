import { z } from 'zod'
import { isAuthenticationOrigin } from '../security/login-policy.ts'
import { LMC_ORIGIN, type LmcAssignmentDates, type LmcCourse, type LmcNotification } from '../shared/lmc.ts'

export const lmcId = z.string().regex(/^[1-9]\d{0,11}$/)
export function lmcSchoolUrl(raw: string): boolean { try { const u = new URL(raw); return isAuthenticationOrigin(raw) || (u.origin === LMC_ORIGIN && !u.username && !u.password) } catch { return false } }
export function lmcAcademicUrl(raw: string): boolean { try { return lmcSchoolUrl(raw) && new URL(raw).origin === LMC_ORIGIN } catch { return false } }
export function lmcFileUrl(raw: string): boolean {
  if (!lmcAcademicUrl(raw)) return false
  try {
    const u = new URL(raw)
    if ([...u.searchParams.keys()].some(key => !['file', 'forcedownload'].includes(key))) return false
    const path = u.pathname === '/pluginfile.php' ? u.searchParams.get('file') : u.pathname.startsWith('/pluginfile.php/') ? decodeURIComponent(u.pathname.slice('/pluginfile.php'.length)) : null
    return !!path && /^\/[1-9]\d*\/mod_(?:resource|folder)\/content\/[^/]+\/.+/.test(path) && !path.split('/').some(part => part === '..' || part === '.') && !/[\u0000-\u001f\\]/.test(path) && !/%(?:2e|2f|5c)/i.test(path)
  } catch { return false }
}
export function lmcResourceUrl(raw: string): boolean { try { const u = new URL(raw); return lmcAcademicUrl(raw) && ['/mod/resource/view.php', '/mod/folder/view.php'].includes(u.pathname) && lmcId.safeParse(u.searchParams.get('id')).success && [...u.searchParams.keys()].every(key => key === 'id' || key === 'forceview') } catch { return false } }
export function lmcDownloadAllowed(expected: Set<string>, chain: string[], initiator: string): boolean { return chain.length > 0 && chain.length <= 8 && (!initiator || initiator === LMC_ORIGIN) && chain.some(url => expected.has(url)) && chain.every(url => lmcFileUrl(url) || lmcResourceUrl(url)) }
export function safeLmcFilename(name: string): string {
  const value = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 180).replace(/[. ]+$/g, '')
  return !value || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? `LMC-${value || 'file'}` : value
}
export function lmcText(text: string, limit = 20_000): string { return text.replace(/https?:\/\/[^\s<>"']+/gi, '[学校链接]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit) }

const courseSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String).pipe(lmcId), fullname: z.string().max(5000), shortname: z.string().max(2000).optional() })
export function parseLmcCourses(input: unknown): LmcCourse[] {
  const data = z.object({ courses: z.array(courseSchema).max(50) }).parse(input)
  return data.courses.map(course => ({ id: course.id, title: lmcText(course.fullname, 500), shortName: lmcText(course.shortname ?? '', 300) }))
}
export function parseLmcNotifications(input: unknown): { items: (LmcNotification & { privateUrl: string | null })[]; unreadCount: number } {
  const data = z.object({ notifications: z.array(z.object({ id: z.union([z.string(), z.number()]), subject: z.string(), body: z.string(), timecreated: z.number().nonnegative(), read: z.union([z.boolean(), z.literal(0), z.literal(1)]), component: z.string().nullish(), contexturl: z.string().nullish() })).max(20), unreadcount: z.number().int().nonnegative() }).parse(input)
  return { unreadCount: data.unreadcount, items: data.notifications.map(item => {
    const url = item.contexturl && lmcAcademicUrl(item.contexturl) ? new URL(item.contexturl) : null
    // Opening a notification may only navigate to observed read-only school pages.
    const privateUrl = url && /^\/(?:course\/view\.php|mod\/[a-z0-9_]+\/(?:view|discuss)\.php|my\/|calendar\/view\.php|grade\/report\/[a-z]+\/index\.php)$/.test(url.pathname) && ![...url.searchParams.keys()].some(key => /sesskey|token|delete|action|submit/i.test(key)) ? url.href : null
    return { id: `${item.id}:${item.timecreated}:${item.component ?? ''}`, title: lmcText(item.subject, 1000), body: lmcText(item.body), createdAt: Number.isFinite(new Date(item.timecreated * 1000).getTime()) ? new Date(item.timecreated * 1000).toISOString() : null, read: !!item.read, source: lmcText(item.component ?? '', 100), hasSource: !!privateUrl, privateUrl }
  }) }
}

// Runs in the school main world. Session keys and the original response stay there.
export function lmcAjaxScript(kind: 'courses' | 'notifications', offset = 0): string {
  const method = kind === 'courses' ? 'core_course_get_enrolled_courses_by_timeline_classification' : 'message_popup_get_popup_notifications'
  const args = kind === 'courses' ? { classification: 'all', limit: 50, offset, sort: 'ul.timeaccess desc' } : { useridto: 0, newestfirst: true, limit: 20, offset }
  return `(async () => {
    if (location.origin !== ${JSON.stringify(LMC_ORIGIN)} || !globalThis.M?.cfg?.sesskey) return {ok:false,reason:'auth'};
    const plain=value=>{const doc=new DOMParser().parseFromString(String(value||''),'text/html');doc.querySelectorAll('script,style').forEach(el=>el.remove());return doc.body.textContent||''};
    try {
      const url=new URL('/lib/ajax/service.php',location.origin);url.searchParams.set('sesskey',M.cfg.sesskey);url.searchParams.set('info',${JSON.stringify(method)});
      const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify([{index:0,methodname:${JSON.stringify(method)},args:${JSON.stringify(args)}}]),signal:AbortSignal.timeout(20000)});
      if(!response.ok)return {ok:false,reason:response.status===401||response.status===403?'auth':'request'};
      const text=await response.text();if(text.length>4000000)return {ok:false,reason:'format'};
      const payload=JSON.parse(text);if(!Array.isArray(payload)||payload[0]?.error){const code=payload?.[0]?.exception?.errorcode||'';return {ok:false,reason:/invalidsesskey|requirelogin|notloggedin/.test(code)?'auth':'request'}};
      const data=payload[0]?.data;
      if(${JSON.stringify(kind)}==='courses')return {ok:true,data:{courses:Array.isArray(data?.courses)?data.courses.map(c=>({id:c.id,fullname:plain(c.fullname),shortname:plain(c.shortname)})):null}};
      return {ok:true,data:{notifications:Array.isArray(data?.notifications)?data.notifications.map(n=>({id:n.id,subject:plain(n.subject),body:plain(n.fullmessagehtml||n.fullmessage||n.text||n.smallmessage),timecreated:n.timecreated,read:n.read,component:n.component,contexturl:n.contexturl})):null,unreadcount:data?.unreadcount}};
    }catch{return {ok:false,reason:'request'}}
  })()`
}

// Moodle renders these labels with the student's display settings. Keep the date text as shown.
const readAssignmentDates = String.raw`(root => {
  const dates = { opens: null, due: null };
  for (const region of root.querySelectorAll('[data-region="activity-dates"], .activity-dates')) {
    for (const row of region.children) {
      const label = row.querySelector('.date-item-label, strong, b');
      const labelText = label?.textContent.trim() || '';
      const key = labelText.replace(/\s*[:：]$/, '').replace(/\s+/g, ' ').toLowerCase();
      const value = row.textContent.trim().slice(labelText.length).trim().replace(/\s+/g, ' ');
      if (!/\d/.test(value) || value.length > 160) continue;
      if (/^(?:opens?|opened|allow submissions from|开放|开放时间|开启|开始提交|允许提交的起始时间)$/.test(key)) dates.opens ??= value;
      if (/^(?:due|due date|截止|截止时间|截止日期|到期|到期时间)$/.test(key)) dates.due ??= value;
    }
  }
  return dates;
})`

interface LmcPageActivity { cmid: string; title: string; section: string; type: string; fileType: string; assignmentDates?: LmcAssignmentDates }
export interface LmcPageDocument { recognized: boolean; auth: boolean; indexReady: boolean; title: string; activities: LmcPageActivity[] }
export const lmcCourseInspection = String.raw`(() => {
  if(location.origin!=='https://core.xjtlu.edu.cn')return null;
  const readDates = ${readAssignmentDates};
  const root=document.querySelector('#region-main')||document.body;
  const clean=el=>{if(!el)return '';const copy=el.cloneNode(true);copy.querySelectorAll('.accesshide,.sr-only,.visually-hidden,script,style').forEach(el=>el.remove());return (copy.textContent||'').replace(/\s+/g,' ').trim()};
  const seen=new Map(),activities=[];
  // Tiles load only the top section into region-main; the course index still
  // contains the available activities from every section, including weekly files.
  const links=[...document.querySelectorAll('#courseindex a[href]'),...root.querySelectorAll('.activity a[href]')];
  for(const a of links){
    try{const u=new URL(a.href),parts=u.pathname.split('/');if(u.origin!==location.origin||parts.length!==4||parts[1]!=='mod'||parts[3]!=='view.php'||!/^[1-9]\d*$/.test(u.searchParams.get('id')||''))continue;
    const type=parts[2],cmid=u.searchParams.get('id'),key=type+':'+cmid;
    const activity=a.closest('.activity'),section=activity?.closest('li.section,[data-for="section"]');const image=activity?.querySelector('img.activityicon,img.icon');const iconPath=image?new URL(image.src).pathname:'',fileType=iconPath.split('/f/')[1]?.split('-')[0]||'';
    const card = type === 'assign' ? activity || a.closest('[data-for="cmitem"]') : null;
    const assignmentDates = card ? readDates(card) : undefined;
    const previous = seen.get(key);
    if (previous) {
      if (fileType) previous.fileType = fileType;
      if (assignmentDates) previous.assignmentDates = {
        opens: assignmentDates.opens ?? previous.assignmentDates?.opens ?? null,
        due: assignmentDates.due ?? previous.assignmentDates?.due ?? null
      };
      continue;
    }
    const indexSection=a.closest('[id^="course-index-section-"],.courseindex-section');
    const sectionTitle=clean(indexSection?.querySelector('a[href*="/course/section.php"],.courseindex-section-title .courseindex-link'))||clean(section?.querySelector('.sectionname,[data-for="section_title"],h3'))||'课程内容';
    const row={cmid,type,title:clean(a.querySelector('.instancename')||a)||type,section:sectionTitle,fileType};
    if (assignmentDates) row.assignmentDates = assignmentDates;
    seen.set(key,row);activities.push(row);
    }catch{}if(activities.length>=5000)break;
  }
  const indexReady=!document.querySelector('#courseindex')||!!document.querySelector('#courseindex [data-for="section"],#courseindex [id^="course-index-section-"]');
  return {recognized:document.body.id.startsWith('page-course-view-'),auth:!!document.querySelector('input[type="password"]')||document.body.id==='page-login-index',indexReady,title:clean(document.querySelector('h1')),activities};
})()`

export function lmcAssignmentCardsScript(moduleIds: string[]): string {
  // A tile can list an assignment without rendering its card. Request only those known cards.
  const requests = moduleIds.slice(0, 30).map((id, index) => ({ index, methodname: 'core_course_get_module', args: { id: Number(lmcId.parse(id)) } }))
  return `(async () => {
    if (location.origin !== ${JSON.stringify(LMC_ORIGIN)} || !globalThis.M?.cfg?.sesskey) return [];
    const readDates = ${readAssignmentDates};
    const requests = ${JSON.stringify(requests)};
    try {
      const url = new URL('/lib/ajax/service.php', location.origin);
      url.searchParams.set('sesskey', M.cfg.sesskey);
      url.searchParams.set('info', 'core_course_get_module');
      const response = await fetch(url, { method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requests), signal: AbortSignal.timeout(5000) });
      if (!response.ok) return [];
      const text = await response.text();
      if (text.length > 2000000) return [];
      const payload = JSON.parse(text);
      if (!Array.isArray(payload)) return [];
      const template = document.createElement('template');
      const dates = [];
      for (const { index, args: { id } } of requests) {
        const item = payload[index];
        if (item?.error !== false || typeof item.data !== 'string') continue;
        template.innerHTML = item.data;
        const card = template.content.querySelector('#module-' + id + '.modtype_assign');
        if (card) dates.push([String(id), readDates(card)]);
      }
      return dates;
    } catch { return []; }
  })()`
}

export const lmcAssignmentPageInspection = String.raw`(() => {
  if (location.origin !== ${JSON.stringify(LMC_ORIGIN)} || document.body.id !== 'page-mod-assign-view') return null;
  return (${readAssignmentDates})(document.querySelector('#region-main') || document.body);
})()`

export function cleanLmcAssignmentDates(value: LmcAssignmentDates | null | undefined): LmcAssignmentDates | undefined {
  const clean = (text: string | null | undefined): string | null => typeof text === 'string' ? lmcText(text, 160) || null : null
  const opens = clean(value?.opens), due = clean(value?.due)
  return opens || due ? { opens, due } : undefined
}

export interface LmcFilesDocument { recognized: boolean; auth: boolean; ready: boolean; files: { url: string; name: string; path: string }[] }
export const lmcFileInspection = String.raw`(() => {
  if(location.origin!=='https://core.xjtlu.edu.cn')return null;
  const root=document.querySelector('#region-main')||document.body,files=[],seen=new Set();
  for(const el of root.querySelectorAll('a[href],iframe[src],embed[src],object[data]')){
    try{const u=new URL(el.getAttribute('href')||el.getAttribute('src')||el.getAttribute('data'),location.href);if(u.origin!==location.origin||!(u.pathname.startsWith('/pluginfile.php/')||u.pathname==='/pluginfile.php')||seen.has(u.href))continue;seen.add(u.href);
    const path=decodeURIComponent(u.searchParams.get('file')||u.pathname.slice('/pluginfile.php'.length));const match=path.match(/^\/[1-9]\d*\/mod_(?:resource|folder)\/content\/[^/]+\/(.+)$/);if(!match)continue;
    const relative=match[1],name=relative.split('/').pop()||'';files.push({url:u.href,name,path:relative});}catch{}if(files.length>=3000)break;
  }
  const recognized=document.body.id==='page-mod-folder-view'||document.body.id==='page-mod-resource-view';
  const empty=/folder is empty|no files|empty folder|文件夹为空|没有文件/i.test(root.innerText||'');
  const initialized=!!root.querySelector('.foldertree .ygtvitem,.foldertree [role="treeitem"],.foldertree .fp-file,.foldertree .fp-folder');
  return {recognized,auth:!!document.querySelector('input[type="password"]')||document.body.id==='page-login-index',ready:files.length>0||empty||initialized&&!root.querySelector('.fp-loading,.loading-icon,.ygtvloading'),files};
})()`
