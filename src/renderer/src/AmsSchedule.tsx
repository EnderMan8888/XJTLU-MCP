import {useEffect,useState} from 'react'
import type {AmsBridge,AmsState} from '../../shared/ams'
import type {EbridgeState} from '../../shared/ebridge'
import {ebridgeTimetableForDate} from '../../shared/ebridge-timetable'
import {amsRelativeDays,matchModuleAttendance,moduleAttendanceLabels} from '../../shared/module-attendance'
import {updatedAt} from './presentation'

export function AmsSchedule({state,ebridge,api,busy,run}:{state:AmsState;ebridge:EbridgeState;api:AmsBridge;busy:boolean;run:(operation:()=>Promise<void>)=>Promise<void>}):React.JSX.Element {
  const [selected,setSelected]=useState(0)
  const [now,setNow]=useState(Date.now)
  const [error,setError]=useState('')
  const days=amsRelativeDays(now),active=days.find(day=>day.offset===selected)??days[0],date=active.date
  const timetable=ebridgeTimetableForDate(ebridge,date)
  const entries=timetable.rows.map(session=>({id:session.id,moduleCode:session.code,moduleTitle:session.title,date,time:session.time,room:session.room,teachingGroup:[session.type,session.group].filter(Boolean).join(' ')}))
  const snapshot=state.scheduleAttendance[date],term=ebridge.timetableTerm
  const source=snapshot&&term&&snapshot.term.academicYear===term.year&&snapshot.term.semester===`SEM${term.semester}`?snapshot:undefined
  const known=timetable.known
  const matched=matchModuleAttendance(entries,source?.records??[])
  useEffect(()=>{const update=():void=>setNow(Date.now());const timer=setInterval(update,60_000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update)}},[])

  useEffect(()=>{
    if(!api||!date||!known||!ebridge.timetableTerm||state.phase!=='connected')return
    let live=true
    setError('')
    void api.loadScheduleAttendance(date).catch(()=>{if(live)setError('单节考勤读取未完成，请刷新 AMS 数据后重试。')})
    return()=>{live=false}
  },[api,date,state.fetchedAt,state.phase,known,ebridge.timetableAt,ebridge.timetableTerm?.year,ebridge.timetableTerm?.semester])

  return <>
    {ebridge.issues.timetable&&<div className="notice" role="status">{ebridge.issues.timetable}{ebridge.timetableAt&&' 以下保留上次读取的 Timetable。'}</div>}
    {timetable.message&&<div className="notice" role="status">{timetable.message}</div>}
    {source?.issue&&<div className="notice" role="status">{source.issue}{source.fetchedAt&&' 读取失败的课程保留上次核对结果。'}</div>}
    {error&&<div className="notice" role="alert">{error}</div>}
    <div className="section-heading"><div><h2>{active.label}的课程</h2><span>{date} · 课程与教室：eBridge Timetable · 签到：AMS Module</span></div><button className="text-button" disabled={!api||busy} onClick={()=>void run(()=>api.openModuleSource())}>打开 Module 原页 ↗</button></div>
    <section className="schedule card">
      <div className="schedule-toolbar"><div className="day-tabs" role="group" aria-label="课表日期">{days.map(day=><button key={day.offset} className={selected===day.offset?'day active':'day'} aria-pressed={selected===day.offset} onClick={()=>setSelected(day.offset)}>{day.label}<span>{day.date.slice(5)}</span></button>)}</div><span className="count">{known? `共 ${entries.length} 节`:'等待读取'}</span></div>
      {!known?<div className="empty"><div className="empty-icon">▤</div><h3>{ebridge.phase==='error'?`${active.label}的课表读取未完成`:`等待读取${active.label}的 Timetable`}</h3><p>刷新课程后，从 eBridge Timetable 提取课程、时间和教室。</p></div>
        :!entries.length?<div className="empty"><div className="empty-icon">✓</div><h3>{timetable.message?.includes('无法识别')?`${active.label}的课表需要核对`:`${active.label}没有课程安排`}</h3></div>
        :<div className="table-scroll"><table><thead><tr><th>时间 / 日期</th><th>课程 · Timetable</th><th>教室 / 教学组</th><th>签到状态 · Module</th></tr></thead><tbody>{entries.map((entry,index)=>{
          const record=matched[index]
          const status=record?.attendance??(source?.fetchedAt?'unmatched':'unavailable')
          const label=status==='unavailable'&&source?.loading?'正在核对…':status==='unavailable'&&source?.issue?'暂不可用':moduleAttendanceLabels[status]
          return <tr key={entry.id}>
            <td><strong>{entry.time||'时间未提供'}</strong><small>{entry.date}</small></td><td><strong>{entry.moduleTitle}</strong><small>{entry.moduleCode||'课程代码未提供'}</small></td>
            <td><strong>{entry.room||'Timetable 未提供教室'}</strong><small>{entry.teachingGroup||'—'}</small></td>
            <td><span className={`attendance attendance-${status}`} title={record?.statusName||undefined}>{label}</span>{record?.attendance==='present'&&record.signTime&&<small>签到：{record.signTime}</small>}</td>
          </tr>
        })}</tbody></table></div>}
      <div className="schedule-footer"><span>eBridge Timetable：{updatedAt(ebridge.timetableAt)}</span><span>Module 单节考勤核对：{updatedAt(source?.fetchedAt??null)}</span></div>
    </section>
  </>
}
