import {useEffect,useState} from 'react'
import {schoolLoginAction} from '../../shared/ams'
import type {BookingDraft,LibraryBridge,LibraryBookingResult,LibraryReservation,LibraryState,SeatSearch} from '../../shared/library'
import {phases,updatedAt} from './presentation'
import {libraryNowWindow} from '../../shared/library-time'
import {beijingDate} from '../../shared/academic-calendar'

function defaultTime():{date:string;start:string;end:string}{return libraryNowWindow()??{date:beijingDate(),start:'22:00',end:'22:00'}}
const campusName=(name:string):string=>name==='SIP Campus'?'园区':'太仓'
function errorMessage(error:unknown):string{return error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''):'操作未完成，请重试。'}

export function LibraryPage({state,api,autoRelogin,onAccount}:{state:LibraryState;api:LibraryBridge;autoRelogin:boolean;onAccount:()=>void}):React.JSX.Element{
  const [view,setView]=useState<'booking'|'records'>('booking')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const [floorId,setFloorId]=useState(0),[times,setTimes]=useState(defaultTime)
  const [automatic,setAutomatic]=useState(true)
  const [seatId,setSeatId]=useState(0),[seatFilter,setSeatFilter]=useState(''),[onlyFree,setOnlyFree]=useState(false)
  const [title,setTitle]=useState(''),[memo,setMemo]=useState('')
  const [draft,setDraft]=useState<BookingDraft|null>(null),[accepted,setAccepted]=useState(false),[captcha,setCaptcha]=useState(''),[captchaImage,setCaptchaImage]=useState('')
  const [agentRequestId,setAgentRequestId]=useState<string|null>(null)
  const [result,setResult]=useState<LibraryBookingResult|null>(null),[records,setRecords]=useState<LibraryReservation[]|null>(null)
  useEffect(()=>{if(!floorId&&state.floors.length)setFloorId(state.floors.find(f=>f.campus==='SIP Campus')?.id??state.floors[0].id)},[floorId,state.floors])
  useEffect(()=>{if(state.booking.phase!=='connected'){setRecords(null);setDraft(null)}},[state.booking.phase])
  useEffect(()=>{if(agentRequestId&&state.agentBooking?.id!==agentRequestId){setDraft(null);setAgentRequestId(null)}},[agentRequestId,state.agentBooking?.id])
  const run=async(operation:()=>Promise<void>):Promise<void>=>{setBusy(true);setError('');try{await operation()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  useEffect(()=>{if(!api)return;let live=true;void api.refresh().catch(()=>{if(live)setError('楼层列表读取失败，请点击“更新楼层”。')});return()=>{live=false}},[api])
  const query:SeatSearch={floorId,...times,...(automatic?{startMode:'now' as const}:{})}
  const matching=state.search&&state.search.floorId===floorId&&state.search.date===times.date&&state.search.start===times.start&&state.search.end===times.end
  const floorSeats=state.seats.filter(s=>s.floorId===floorId)
  const seats=matching?floorSeats.filter(s=>(!onlyFree||s.available)&&s.name.toLowerCase().includes(seatFilter.toLowerCase())):[]
  const seat=matching?floorSeats.find(s=>s.id===seatId):undefined
  const ready=state.booking.phase==='connected'
  const canRead=ready || autoRelogin && state.booking.phase==='expired'
  const needsCredentials=state.booking.phase==='credentials-required'
  const loginAction=schoolLoginAction(state.booking.phase)
  const connectAccount=():void=>{
    if(needsCredentials){onAccount();return}
    void run(()=>loginAction?api.showLogin():api.connect())
  }
  const connectLabel=loginAction??(needsCredentials?'设置学校账号':ready?'重新连接':'连接学校账号')
  const loadRecords=():void=>{setView('records');void run(async()=>setRecords(await api.getReservations()))}
  const querySeats=():void=>{void run(async()=>{
    const window=automatic?libraryNowWindow():times
    if(!window)throw new Error('今天已无可预约到 22:00 的时段，请修改日期或时间。')
    setSeatId(0);setResult(null);setTimes(window)
    await api.searchSeats({floorId,...window,...(automatic?{startMode:'now' as const}:{})})
    const latest=await api.getState()
    if(latest.search?.floorId===floorId)setTimes({date:latest.search.date,start:latest.search.start,end:latest.search.end})
  })}
  const review=(requestId?:string):void=>{void run(async()=>{
    const value=requestId?await api.reviewAgentBooking(requestId):await api.prepareBooking({...query,seatId,title,memo})
    setAgentRequestId(requestId??null);setDraft(value);setAccepted(false);setCaptcha('');setCaptchaImage('')
    if(value.captchaMode==='1')setCaptchaImage(await api.getCaptcha())
  })}
  const dismissDraft=():void=>{if(agentRequestId)void run(()=>api.cancelAgentBooking(agentRequestId));setDraft(null);setAgentRequestId(null)}
  const submitDraft=(value:BookingDraft):void=>{void run(async()=>{
    const reply=agentRequestId?await api.submitAgentBooking(agentRequestId,value.id,accepted,captcha):await api.submitBooking(value.id,accepted,captcha)
    setResult(reply);setDraft(null);setAgentRequestId(null);setSeatId(0)
  })}
  const chooseFloor=(id:number):void=>{setFloorId(id);setSeatId(0);setView('booking');setError('')}
  const changeTime=(field:'date'|'start'|'end',value:string):void=>{setTimes(t=>({...t,[field]:value}));setSeatId(0)}
  return <>
    <div className="heading"><div><div className="eyebrow">LIBRARY · SEATS & RESERVATIONS</div><h1>找个座位，安排学习。</h1><p>选择楼层、具体座位、日期和时段，确认后提交预约。</p></div><div className="ams-icon">▥</div></div>
    <section className="card connection">
      <div className="connection-top">
        <div>
          <span className={`status status-${state.booking.phase}`}><span />{phases[state.booking.phase]}</span>
          <h2>图书馆学校账号</h2>
          <p>{state.booking.message}</p>
        </div>
        <div className="actions">
          <button disabled={!api||busy||state.booking.phase==='authenticating'} onClick={connectAccount}>{connectLabel}</button>
          <button className="primary" disabled={!api||busy} onClick={()=>setView('booking')}>选座预约 ↗</button>
        </div>
      </div>
    </section>
    <div className="view-tabs" role="group" aria-label="图书馆功能"><button className={view==='booking'?'active':''} onClick={()=>setView('booking')}>选座预约</button><button className={view==='records'?'active':''} disabled={!canRead||busy} onClick={loadRecords}>我的预约</button></div>
    {state.agentBooking?.phase==='pending'&&<div className="attention-banner" role="status"><div><strong>Agent 请求预约 {state.agentBooking.seat}</strong><p>{state.agentBooking.selection.date} · {state.agentBooking.selection.startMode==='now'?'现在起':state.agentBooking.selection.start}–{state.agentBooking.selection.end}</p></div><div className="actions"><button disabled={busy} onClick={()=>void run(()=>api.cancelAgentBooking(state.agentBooking!.id))}>拒绝</button><button className="primary" disabled={busy||!ready} onClick={()=>review(state.agentBooking!.id)}>核对预约</button></div></div>}
    {error&&<div className="notice error" role="alert">{error}</div>}
    {result&&<div className={`notice ${result.ok?'success':result.uncertain?'':'error'}`} role="status"><strong>{result.message}</strong><div><button className="text-button" disabled={!canRead||busy} onClick={loadRecords}>查看我的预约</button></div></div>}
    {view==='booking'&&<>
      <div className="section-heading"><div><h2>选座预约</h2><span>{state.message}</span></div><button className="text-button" disabled={busy||state.phase==='loading'} onClick={()=>void run(()=>api.refresh())}>{state.phase==='loading'?'正在读取楼层…':'更新楼层'}</button></div>
      <section className="card"><div className="module-filters library-search">
        <label>校区 / 楼层<select value={floorId||''} disabled={busy} onChange={e=>chooseFloor(Number(e.target.value))}><option value="" disabled>请选择楼层</option>{state.floors.map(f=><option key={f.key} value={f.id}>{campusName(f.campus)} · {f.name}（空位 {f.free}/{f.total}）</option>)}</select></label>
        {automatic?<div className="library-now-window"><strong>今天 · 现在起 — 22:00</strong><small>查询和提交时自动更新开始时间</small></div>:<>
          <label>日期<input type="date" value={times.date} disabled={busy} onChange={e=>changeTime('date',e.target.value)}/></label>
          <label>开始<input type="time" step="60" value={times.start} disabled={busy} onChange={e=>changeTime('start',e.target.value)}/></label>
          <label>结束<input type="time" step="60" value={times.end} disabled={busy} onChange={e=>changeTime('end',e.target.value)}/></label>
        </>}
        <button className="text-button" disabled={busy} onClick={()=>{setAutomatic(!automatic);setSeatId(0);setTimes(defaultTime());setError('')}}>{automatic?'修改日期 / 时段':'恢复现在至 22:00'}</button>
        <button className="primary" disabled={busy||!canRead||!floorId} onClick={querySeats}>{busy?'正在查询…':'查询可预约座位'}</button>
      </div></section>
      {!state.floors.length&&<div className="notice">点击“更新楼层”读取学校可预约的楼层列表。</div>}
      {<div className="notice">上次更新时间：{updatedAt(state.seatsAt)}</div>}
      {!ready&&<div className="notice">请先连接学校账号，再查询具体座位。</div>}
      {state.seatIssue&&<div className="notice">{state.seatIssue}</div>}
      <div className="section-heading"><div><h2>选择具体座位</h2><span>{matching?`${floorSeats.filter(s=>s.available).length} 个在所选时段可预约 · ${state.seats.length} 个座位`:'选择日期和时段后查询'}</span></div></div>
      <section className="card library-seats"><div className="module-filters"><label className="seat-checkbox"><input type="checkbox" checked={onlyFree} onChange={e=>setOnlyFree(e.target.checked)}/>仅显示可预约</label><label className="course-search">座位号<input value={seatFilter} onChange={e=>setSeatFilter(e.target.value)} placeholder="查找座位号"/></label></div>{!matching?<div className="empty"><h3>等待所选时段的座位数据</h3><p>修改楼层或时间后，需重新查询。</p></div>:!seats.length?<div className="empty"><h3>没有匹配的座位</h3><p>可更换楼层、日期或时段。</p></div>:<div className="seat-grid">{seats.map(s=><button key={s.id} type="button" className={`seat-choice ${s.available?'available':'unavailable'} ${seatId===s.id?'selected':''}`} aria-pressed={seatId===s.id} disabled={busy} onClick={()=>setSeatId(s.id)}><strong>{s.name}</strong><span>{s.onlyView?'仅现场预约':s.available?'可预约':'该时段不可预约'}</span></button>)}</div>}<div className="schedule-footer"><span>可预约状态以提交时学校校验为准</span><span>上次更新时间：{updatedAt(state.seatsAt)}</span></div></section>
      {seat&&<section className="card booking-selection"><h2>已选 {seat.name}</h2><p>{times.date} · {times.start}–{times.end}</p><div className="booking-time-info"><span>开放：{seat.open.map(t=>`${t.start}–${t.end}`).join('；')||'未提供'}</span><span>已有占用：{seat.occupied.map(t=>`${t.start}–${t.end}`).join('；')||'无'}{seat.minMinutes?` · 最短 ${seat.minMinutes} 分钟`:''}{seat.maxMinutes?` · 最长 ${seat.maxMinutes} 分钟`:''}</span></div><div className="module-filters"><label>预约主题<input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label><label className="booking-memo">备注<input value={memo} maxLength={500} onChange={e=>setMemo(e.target.value)} disabled={busy}/></label><button className="primary" disabled={busy||!ready||!seat.available} onClick={()=>review()}>{busy?'正在核对…':'核对并预约'}</button></div></section>}
    </>}
    {view==='records'&&<><div className="section-heading"><div><h2>我的预约</h2><span>今日记录 · 学校当前返回的预约状态</span></div><button className="text-button" disabled={busy||!canRead} onClick={loadRecords}>刷新记录</button></div><section className="card schedule">{records===null?<div className="empty"><h3>等待读取预约记录</h3></div>:!records.length?<div className="empty"><h3>学校当前未返回今日预约</h3></div>:<div className="table-scroll"><table><thead><tr><th>座位</th><th>开始</th><th>结束</th><th>学校状态</th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td>{r.seat||'请打开学校原页核对'}</td><td>{r.begin}</td><td>{r.end}</td><td>{r.status||'—'}</td></tr>)}</tbody></table></div>}</section></>}
    <footer className="page-footer"><p>学校账号由首页统一管理，预约请求只在你确认后提交。</p><button className="text-button" disabled={busy} onClick={()=>void run(()=>api.openSource())}>打开学校预约原页 ↗</button></footer>
    {draft&&<div className="modal-backdrop"><section className="modal booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-review"><h2 id="booking-review">确认本次座位预约</h2><div className="booking-review"><strong>{draft.floor} · {draft.seat}</strong><p>{draft.date} · {draft.startMode==='now'?`现在起（约 ${draft.start}）`:draft.start}–{draft.end}</p>{draft.title&&<p>主题：{draft.title}</p>}{draft.memo&&<p>备注：{draft.memo}</p>}</div>{draft.requiresNotice&&<><h3>学校预约须知</h3><div className="booking-notice">{draft.notice}</div><label className="seat-checkbox"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/>我已阅读并同意本次预约须知</label></>}{draft.captchaMode==='1'&&<div className="booking-captcha">{captchaImage&&<img src={captchaImage} alt="学校预约验证码"/>}<button disabled={busy} onClick={()=>void run(async()=>setCaptchaImage(await api.getCaptcha()))}>更换验证码</button><label>验证码<input value={captcha} onChange={e=>setCaptcha(e.target.value)} autoComplete="off"/></label></div>}{draft.captchaMode==='2'&&<p>学校要求滑块验证，确认后会打开官方窗口供你继续。</p>}{draft.startMode==='now'&&<p>即时预约的开始时间会在提交时按当前时间更新，结束时间为 22:00。</p>}<p className="muted">确认有效期两分钟。提交时会再次校验座位状态。</p><div className="actions"><button disabled={busy} onClick={dismissDraft}>{agentRequestId?'取消请求':'返回修改'}</button><button className="primary" disabled={busy||(draft.requiresNotice&&!accepted)||(draft.captchaMode==='1'&&!captcha.trim())} onClick={()=>submitDraft(draft)}>{busy?'正在提交，请等待…':draft.captchaMode==='2'?'继续学校验证':'确认提交预约'}</button></div></section></div>}
  </>
}
