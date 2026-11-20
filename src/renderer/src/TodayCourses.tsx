import {useEffect,useState} from 'react'
import type {AmsState} from '../../shared/ams'
import {moduleAttendanceLabels as attendance} from '../../shared/module-attendance'
import type {EbridgeState} from '../../shared/ebridge'
import {todayCourses} from '../../shared/today-courses'
import {updatedAt} from './presentation'


export function TodayCourses({ebridge,ams,busy,onRefresh,onAccount}:{ebridge:EbridgeState;ams:AmsState;busy:boolean;onRefresh:()=>void;onAccount:()=>void}):React.JSX.Element {
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{const update=():void=>setNow(Date.now());const timer=setInterval(update,60_000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update)}},[])
  const today=todayCourses(ebridge,ams,now)
  const connecting=busy||ams.moduleAttendance?.loading||[ebridge.phase,ams.phase].some(p=>p==='authenticating'||p==='loading')
  const dateLabel=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'}).format(new Date(now))
  const credentials=ebridge.phase==='credentials-required'||ams.phase==='credentials-required'
  return <section className="today-section" aria-labelledby="today-heading">
    <div className="section-heading"><div><h2 id="today-heading">今天的课程</h2><span>{dateLabel}{today.week?` · 第 ${today.week} 教学周`:''} · 北京时间</span></div><button className="primary" disabled={connecting} onClick={credentials?onAccount:onRefresh}>{credentials?'设置学校账号':connecting?'正在读取…':'刷新今日课程'}</button></div>
    {ebridge.issues.timetable&&<div className="notice" role="status">{ebridge.issues.timetable}{ebridge.timetableAt&&' 以下保留上次读取的 eBridge 课表。'}</div>}
    {ams.moduleAttendance?.issue&&<div className="notice" role="status">{ams.moduleAttendance.issue}{ams.moduleAttendance.fetchedAt&&' 读取失败的课程保留上次核对结果。'}</div>}
    {ebridge.timetableAt&&today.message&&<div className="notice" role="status">{today.message}</div>}
    <section className="schedule card">
      {!ebridge.timetableAt?<div className="empty today-empty"><h3>{ebridge.phase==='error'?'今日课程读取失败':'等待读取今天的课程'}</h3><p>{ebridge.phase==='error'?ebridge.message:'自动连接 eBridge 后显示课程，AMS Module 提供单节签到记录。'}</p></div>
        :!today.known&&!today.rows.length?<div className="empty today-empty"><h3>暂时无法确认今天的课程</h3><p>可进入 eBridge 查看原始课表。</p></div>
        :!today.rows.length?<div className="empty today-empty"><h3>{today.message?.includes('无法识别')?'暂时无法确认今天的课程':'今天没有课程安排'}</h3><p>依据 eBridge 课表与学校教学周。</p></div>
        :<div className="table-scroll"><table><thead><tr><th>时间</th><th>课程 · eBridge</th><th>教室 / 类型</th><th>签到状态 · AMS Module</th></tr></thead><tbody>{today.rows.map(course=><tr key={course.id}>
          <td><strong>{course.time}</strong></td><td><strong>{course.title}</strong><small>{course.code}{course.group&&` · ${course.group}`}</small></td>
          <td><strong>{course.room||'教室未提供'}</strong><small>{course.type||'类型未提供'}</small></td>
          <td><span className={`attendance attendance-${course.attendance}`} title={course.attendance==='unmatched'?'Module 中没有唯一匹配的同日、同课程、同上课时间记录。':course.statusName||undefined}>{course.attendance==='unavailable'&&ams.moduleAttendance?.loading?'正在核对…':course.attendance==='unavailable'&&ams.moduleAttendance?.issue?'暂不可用':attendance[course.attendance]}</span>{course.signTime&&<small>签到：{course.signTime}</small>}</td>
        </tr>)}</tbody></table></div>}
      <div className="schedule-footer"><span>eBridge 课表{ebridge.localCache.restored.includes('timetable') ? '（本地缓存）' : ''}：{updatedAt(ebridge.timetableAt)}</span><span>Module 核对：{updatedAt(ams.moduleAttendance?.fetchedAt??null)}</span></div>
    </section>
  </section>
}
