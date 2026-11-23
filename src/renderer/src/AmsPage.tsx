import { useState } from 'react'
import { schoolLoginAction, type AmsBridge, type AmsState } from '../../shared/ams'
import type { EbridgeState } from '../../shared/ebridge'
import { phases } from './presentation'
import { ModulesView } from './ModulesView'
import { AmsSchedule } from './AmsSchedule'


export function AmsPage({ state, ebridge, api, action, run, onAccount, refresh }: { state: AmsState; ebridge:EbridgeState; refresh:()=>Promise<void>; api: AmsBridge; action: boolean; run: (operation: () => Promise<void>) => Promise<void>; onAccount: () => void }): React.JSX.Element {
  const [view, setView] = useState<'modules' | 'schedule'>('modules')
  const [confirmClear, setConfirmClear] = useState(false)
  const busy = action || state.phase === 'loading' || state.phase === 'authenticating'
  const loginAction = schoolLoginAction(state.phase)

  const connect = (): void => {
    if (state.phase === 'credentials-required') onAccount()
    else void run(() => loginAction ? api.showLogin() : state.phase === 'error' || state.phase === 'expired' ? api.reconnect() : api.openLogin())
  }
  return <>
    <div className="heading"><div><div className="eyebrow">ATTENDANCE MANAGEMENT SYSTEM</div><h1>课程与出勤，一处查看。</h1><p>查看课程列表与签到率，按 Module 详情核对每节课的签到状态。</p></div><div className="ams-icon">AM<span>S</span></div></div>
    <section className="connection card"><div className="connection-top"><div><span className={`status status-${state.phase}`}><span />{phases[state.phase]}</span><h2>AMS 连接</h2><p>{state.message}</p></div><div className="actions">{state.phase !== 'connected' && <button disabled={!api || busy} onClick={connect}>{loginAction ?? (state.phase === 'credentials-required' ? '设置学校账号' : '连接 AMS')}</button>}<button className="primary" disabled={!api || busy || state.phase === 'manual-login-required'} onClick={() => void run(refresh)}>{state.phase === 'loading' ? '正在读取…' : '刷新 AMS 数据'}<span>↗</span></button></div></div><div className="connection-bottom"><span>◈ 首页统一管理账号</span><span>◈ 自动登录与会话恢复</span><span>◈ 学校接口直接读取</span></div></section>
    <div className="view-tabs" role="group" aria-label="AMS 信息视图"><button className={view === 'modules' ? 'active' : ''} onClick={() => setView('modules')}>课程与签到率</button><button className={view === 'schedule' ? 'active' : ''} onClick={() => setView('schedule')}>近期课表</button></div>
    {view === 'modules' ? <ModulesView state={state} api={api} busy={busy} run={run} /> : <AmsSchedule state={state} ebridge={ebridge} api={api} busy={busy} run={run} />}
    <footer className="page-footer"><p>签到率和单节考勤均使用学校 Module 记录，分别展示。</p><button className="text-button" disabled={!api || busy} onClick={() => setConfirmClear(true)}>断开 AMS</button></footer>
    {confirmClear && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="clear-title"><h2 id="clear-title">断开 AMS 并清除本地会话？</h2><p>将关闭 AMS 学校窗口，清除该服务的会话和内存数据。首页统一保存的学校账号会保留，之后可再次连接。</p><div className="actions"><button onClick={() => setConfirmClear(false)}>取消</button><button className="primary" onClick={() => { setConfirmClear(false); void run(() => api.clearSession()) }}>断开 AMS</button></div></div></div>}
  </>
}
