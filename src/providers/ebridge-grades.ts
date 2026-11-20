import { z } from 'zod'
import type { EbridgeGradeModule, EbridgeGradeView } from '../shared/ebridge.ts'
import type { PortalLink } from './ebridge.ts'

export function selectGradeLinks(links: PortalLink[]): { overview?: PortalLink; records?: PortalLink; components: PortalLink[] } {
  return {
    overview: links.find(link => /^academic records$/i.test(link.text.trim())),
    records: links.find(link => /^full academic records$/i.test(link.text.trim())),
    components: [...new Map(links.filter(link => /^component marks(?:\s*\(20\d{2}\/\d{2}\))?$/i.test(link.text.trim())).map(link => [link.href, link])).values()].slice(0, 10)
  }
}

const text = z.string().max(2000).transform(value => value.replace(/https?:\/\/[^\s<>"']+/gi, '[学校链接]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim())
const component = z.object({ title: text, type: text, weight: text, mark: text.nullable() })
const module = z.object({ code: text.refine(value => /^[A-Z]{2,6}\s?\d{2,4}[A-Z]?$/i.test(value)), title: text, year: text, period: text, credits: text, moduleType: text, mark: text.nullable(), grade: text.nullable(), attempt: text, components: z.array(component).max(1000) })
const report = z.object({ recognized: z.boolean(), valid: z.boolean(), auth: z.boolean(), modules: z.array(module).max(1000) })
export function parseEbridgeGrades(input: unknown, kind: EbridgeGradeView): EbridgeGradeModule[] | null {
  const parsed = report.safeParse(input)
  if (!parsed.success || !parsed.data.recognized || !parsed.data.valid || parsed.data.auth) return null
  return parsed.data.modules.map((item, index) => ({ ...item, mark: item.mark === '' ? null : item.mark, grade: item.grade === '' ? null : item.grade, components: item.components.map(row => ({ ...row, mark: row.mark === '' ? null : row.mark })), id: `${kind}:${item.year}:${item.period}:${item.code}:${index}` }))
}

// Inspect only the observed grade panels and their direct table rows. In the
// academic record, each module row contains a nested component table; descendant
// headers must not make the outer module row disappear or contaminate its cells.
export function ebridgeGradeInspection(kind: EbridgeGradeView, year = ''): string {
  const academicYear = /^20\d{2}\/\d{2}$/.test(year) ? year : ''
  return String.raw`(() => {
    if(location.origin!=='https://ebridge.xjtlu.edu.cn')return null;
    const kind=${JSON.stringify(kind)},defaultYear=${JSON.stringify(academicYear)};
    const clean=value=>(value||'').replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim().slice(0,1800);
    const ownText=el=>{if(!el)return '';const copy=el.cloneNode(true);copy.querySelectorAll('table,script,style').forEach(n=>n.remove());return clean(copy.textContent)};
    const rows=table=>[...table.rows].filter(row=>row.closest('table')===table);
    const header=table=>rows(table).find(row=>[...row.cells].some(c=>c.tagName==='TH'));
    const columns=table=>header(table)?[...header(table).cells].map(ownText):[];
    const index=(headers,pattern)=>headers.findIndex(h=>pattern.test(h));
    const cell=(row,n)=>n<0?'':ownText(row.cells[n]);
    const codePattern=/^[A-Z]{2,6}\s?\d{2,4}[A-Z]?$/i;
    const empty=value=>/^(?:no (?:records?|results?|marks?|data|assessments?)(?:\b|\.)|暂无|没有)/i.test(value);
    const panelHeading=table=>{const panel=table.closest('.sv-panel');return clean(panel?[...panel.children].find(el=>el.classList.contains('sv-panel-heading'))?.textContent:'')};
    const componentHeaders=headers=>({title:index(headers,/^(?:assessment title|component title)$/i),type:index(headers,/^assessment type$/i),weight:index(headers,/^(?:percentage|weight)$/i),mark:index(headers,/^marks?$/i)});
    let valid=true,recognized=false;const modules=[];
    const readComponents=table=>{
      const fields=componentHeaders(columns(table));if(Object.values(fields).some(n=>n<0)){valid=false;return []}
      const result=[],head=header(table);
      for(const row of rows(table)){
        if(row===head)continue;const all=clean(row.textContent);if(!all||empty(all))continue;
        if(row.cells.length<=Math.max(...Object.values(fields))){valid=false;continue}
        const title=cell(row,fields.title);if(!title){valid=false;continue}
        result.push({title,type:cell(row,fields.type),weight:cell(row,fields.weight),mark:cell(row,fields.mark)||null});
      }return result;
    };
    for(const table of document.querySelectorAll('table')){
      const headers=columns(table),code=index(headers,/^module code\b/i),mark=index(headers,/^mark$/i);
      if(kind==='components'){
        const fields=componentHeaders(headers);if(code>=0||Object.values(fields).some(n=>n<0))continue;
        recognized=true;const heading=panelHeading(table),found=heading.match(/\b[A-Z]{2,6}\s?\d{2,4}[A-Z]?\b/i);
        if(!found){valid=false;continue}
        const title=clean(heading.startsWith(found[0])?heading.slice(found[0].length).replace(/^[\s:|\-–—]+/,''):heading);
        modules.push({code:found[0],title,year:defaultYear,period:'',credits:'',moduleType:'',mark:null,grade:null,attempt:'',components:readComponents(table)});
      }else{
        if(code<0||mark<0)continue;recognized=true;
        const title=index(headers,/^module title$/i),period=index(headers,/^period$/i),grade=index(headers,/^grade$/i);
        if([title,period,grade].some(n=>n<0)){valid=false;continue}
        const heading=panelHeading(table),year=heading.match(/\b20\d{2}\/\d{2}\b/)?.[0]||'',head=header(table);
        for(const row of rows(table)){
          if(row===head)continue;const all=ownText(row);if(!all||empty(all))continue;
          const moduleCode=cell(row,code).replace(/\*$/,'').trim();
          if(!codePattern.test(moduleCode)||row.cells.length<=Math.max(code,title,period,mark,grade)){valid=false;continue}
          const componentTable=[...row.querySelectorAll('table')].find(t=>Object.values(componentHeaders(columns(t))).every(n=>n>=0));
          modules.push({code:moduleCode,title:cell(row,title),year,period:cell(row,period),credits:cell(row,index(headers,/^credits?$/i)),moduleType:cell(row,index(headers,/^module type$/i)),mark:cell(row,mark)||null,grade:cell(row,grade)||null,attempt:cell(row,index(headers,/^attempt$/i)),components:componentTable?readComponents(componentTable):[]});
        }
      }
      if(modules.length>1000){valid=false;break}
    }
    const body=document.body?.innerText||'';
    if(!recognized&&/(?:component marks|full academic records)/i.test(document.title+' '+[...document.querySelectorAll('h1,h2')].map(h=>h.textContent).join(' '))&&/no (?:records|results|marks|assessments)(?: available| found| to display)?\b/i.test(body))recognized=true;
    return {recognized,valid,auth:!!document.querySelector('input[type="password"],#OpenIDButton'),modules};
  })()`
}
