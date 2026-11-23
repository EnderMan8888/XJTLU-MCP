import { useEffect, useRef, useState } from 'react'
import { version } from '../../../package.json'
import { initialState, schoolLoginAction, type AmsState } from '../../shared/ams'
import type { CredentialStatus } from '../../shared/credentials'
import { CredentialPanel } from './CredentialPanel'
import { AmsPage } from './AmsPage'
import { phases } from './presentation'
import { initialEbridgeState, type EbridgeState } from '../../shared/ebridge'
import { EbridgePage } from './EbridgePage'
import { LibraryPage } from './LibraryPage'
import { TodayCourses } from './TodayCourses'
import { initialLibraryState,type LibraryState } from '../../shared/library'
import { McpPage } from './McpPage'
import { LmcPage } from './LmcPage'
import { initialLmcState, type LmcState } from '../../shared/lmc'

type Page = 'home' | 'account' | 'ams' | 'ebridge' | 'library' | 'lmc' | 'mcp'
const labels: Record<Page, string> = { home: '首页', account: '账号与登录', ams: 'AMS 出勤', ebridge: 'eBridge 教务', library:'图书馆座位', lmc: 'Learning Mall Core', mcp: 'Agent 连接' }

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('home')
  const pageScroll = useRef<HTMLDivElement>(null)
  const [ams, setAms] = useState<AmsState>(initialState)
  const [ebridge, setEbridge] = useState<EbridgeState>(initialEbridgeState)
  const [library,setLibrary]=useState<LibraryState>(initialLibraryState)
  const [lmc, setLmc] = useState<LmcState>(initialLmcState)
  const [account, setAccount] = useState<CredentialStatus | null>(null)
  const [action, setAction] = useState(false)
  const [error, setError] = useState('')
  const api = window.campus

  useEffect(() => {
    if (!api) { setError('请从 Electron 桌面应用打开此界面。'); return }
    let live = true
    const stopAms = api.ams.onState((state) => { if (live) setAms(state) })
    const stopAccount = api.account.onChanged((state) => { if (live) setAccount(state) })
    const stopEbridge = api.ebridge.onState((state) => { if (live) setEbridge(state) })
    const stopLibrary=api.library.onState(state=>{if(live)setLibrary(state)})
    const stopLmc = api.lmc.onState(state => { if (live) setLmc(state) })
    void api.lmc.getState().then(state => { if (live) setLmc(state) }).catch(() => { if (live) setError('无法读取 LMC 状态。') })
    void api.library.getState().then(state=>{if(live)setLibrary(state)}).catch(()=>{if(live)setError('无法读取图书馆状态。')})
    void api.ebridge.getState().then((state) => { if (live) setEbridge(state) }).catch(() => { if (live) setError('无法读取 eBridge 状态。') })
    void api.ams.getState().then((state) => { if (live) setAms(state) }).catch(() => { if (live) setError('无法读取 AMS 状态。') })
    void api.account.getStatus().then((state) => { if (live) setAccount(state) }).catch(() => { if (live) setError('无法读取学校账号状态。') })
    return () => { live = false; stopAms(); stopAccount(); stopEbridge(); stopLibrary(); stopLmc() }
  }, [api])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setAction(true); setError('')
    try { await operation() } catch { setError('操作未能完成，请重试。') } finally { setAction(false) }
  }
  const navigate = (target: Page): void => { setError(''); setPage(target); pageScroll.current?.scrollTo(0, 0) }
  const modules = ams.moduleSnapshot
  const schoolConnections = [
    { page: 'ams', name: 'AMS', state: ams, showLogin: api?.ams.showLogin },
    { page: 'ebridge', name: 'eBridge', state: ebridge, showLogin: api?.ebridge.showLogin },
    { page: 'library', name: '图书馆', state: library.booking, showLogin: api?.library.showLogin },
    { page: 'lmc', name: 'LMC', state: lmc, showLogin: api?.lmc.showLogin }
  ] as const

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">X</span><span>XJTLU<span className="brand-sub">CAMPUS CONNECTOR</span></span></div>
      <div className="nav-label">校园工作台</div>
      <nav aria-label="主要功能">{(['home', 'account', 'ams', 'ebridge','library', 'lmc', 'mcp'] as Page[]).map((item) => <button type="button" key={item} className={`nav-item ${page === item ? '' : 'nav-secondary'}`} aria-current={page === item ? 'page' : undefined} onClick={() => navigate(item)}><span>{item === 'home' ? '⌂' : item === 'account' ? '◈' : item === 'ebridge' ? '▤' : item==='library'?'▥':item==='mcp'?'↗':item==='lmc'?'▣':'▦'}</span>{labels[item]}{page === item && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-note"><span className="small-dot" /> 本机运行<div>学校账号统一管理，服务独立连接。</div></div>
      <div className="version">XJTLU-MCP · v{version}</div>
    </aside>

    <main>
      <header className="topbar"><span>校园工作台 <span className="separator">/</span><strong>{labels[page]}</strong></span></header>
      <div className="page-scroll" ref={pageScroll}>
      <div className="content">
        {schoolConnections.map(({ page: modulePage, name, state, showLogin }) => {
          const label = schoolLoginAction(state.phase)
          const needsVerification = state.phase === 'verification-required'
          if (!label || !needsVerification && page !== 'home') return null
          return <div key={modulePage} className="attention-banner" role="status">
            <div><strong>{name} {needsVerification ? '需要学校验证' : '需要手动登录'}</strong><p>{state.message}</p></div>
            <button className="primary" disabled={!showLogin || action} onClick={() => { if (showLogin) void run(showLogin) }}>{needsVerification ? '打开学校验证窗口' : label}</button>
          </div>
        })}
        {page!=='library'&&library.agentBooking?.phase==='pending'&&<div className="attention-banner" role="status"><div><strong>Agent 请求图书馆预约</strong><p>请查看座位和时段，再决定是否提交。</p></div><button className="primary" onClick={()=>navigate('library')}>查看预约请求</button></div>}
        {error && <div className="notice error" role="alert">{error}</div>}

        {page === 'home' && <>
          <div className="heading"><div><div className="eyebrow">YOUR CAMPUS, CONNECTED</div><h1>校园信息，从这里连接。</h1><p>统一管理学校账号，在一个工作台查看不同服务的信息。</p></div><div className="ams-icon">X</div></div>
          <TodayCourses ebridge={ebridge} ams={ams} busy={action||!api} onAccount={()=>navigate('account')} onRefresh={()=>void run(async()=>{await Promise.all([api.ebridge.refresh(),api.ams.refresh()])})}/>
          <div className="home-section-title"><h2>功能区</h2><span>4 项学校服务已接入</span></div>
          <div className="feature-grid">
            <button type="button" className="feature-card card" onClick={() => navigate('account')}><span className="feature-icon account-icon">◈</span><span className="feature-status">{account ? account.saved ? '已保存学校账号' : '尚未设置' : '检查中'}</span><h2>账号与登录</h2><p>在本机加密保存学校账号，为已接入的服务提供自动登录。</p><span className="feature-link">{account?.username ? `${account.username} · 管理账号` : '设置学校账号'} <span>↗</span></span></button>
            <button type="button" className="feature-card card" onClick={() => navigate('ams')}><span className="feature-icon">▦</span><span className={`feature-status ${ams.phase === 'connected' ? 'green' : ''}`}>{phases[ams.phase]}</span><h2>AMS 出勤</h2><p>查看 Module 课程列表、每门课的签到率，以及近期课表。</p><span className="feature-link">{modules ? `${modules.modules.length} 门课程 · ${modules.term.academicYear} ${modules.term.semester}` : '进入 AMS'} <span>↗</span></span></button>
            <button type="button" className="feature-card card" onClick={() => navigate('ebridge')}><span className="feature-icon">▤</span><span className={`feature-status ${ebridge.phase === 'connected' ? 'green' : ''}`}>{phases[ebridge.phase]}</span><h2>eBridge 教务</h2><p>查看课程、课表、考试安排与学校公布的成绩。</p><span className="feature-link">{ebridge.coursesAt || ebridge.timetableAt || ebridge.examsAt ? `${ebridge.courses.length} 门课程 · ${ebridge.exams.length} 场考试` : '进入 eBridge'} <span>↗</span></span></button>
            <button type="button" className="feature-card card" onClick={()=>navigate('library')}><span className="feature-icon library-icon">▥</span><span className={`feature-status ${library.booking.phase==='connected'?'green':''}`}>{library.booking.phase==='connected'?'已连接学校账号':'选座预约'}</span><h2>图书馆座位</h2><p>选择具体座位和时段，确认后提交图书馆预约。</p><span className="feature-link">{library.fetchedAt?`${library.floors.length} 个楼层 · 选座预约`:'进入图书馆'}<span>↗</span></span></button>
            <button type="button" className="feature-card card" onClick={() => navigate('lmc')}><span className="feature-icon lmc-icon">▣</span><span className={`feature-status ${lmc.phase === 'connected' ? 'green' : ''}`}>{phases[lmc.phase]}</span><h2>Learning Mall Core</h2><p>查看 Module 课程资料、下载原文件，并读取学校通知。</p><span className="feature-link">{lmc.coursesAt ? `${lmc.courses.length} 门课程 · ${lmc.unreadCount ?? '—'} 条未读通知` : '进入 Learning Mall'}<span>↗</span></span></button>
          </div>
          <div className="home-footnote">保存账号后，程序会尝试自动登录。登录失败时可选择手动登录，学校要求验证时会打开官方窗口。</div>
        </>}

        {page === 'account' && <>
          <div className="heading"><div><div className="eyebrow">CAMPUS ACCOUNT</div><h1>账号与登录</h1><p>学校账号在这里统一管理，AMS 等服务按需使用。</p></div><div className="ams-icon">◈</div></div>
          <section className="card account-card"><div className="account-intro"><h2>学校统一认证账号</h2><p>账号密码使用 Windows 的加密能力保存在本机，供程序在学校官方页面自动登录。</p></div><CredentialPanel api={api?.account} disabled={false} onError={setError} /></section>
          <div className="account-explanation"><h2>自动登录怎样工作</h2><ol><li>优先恢复仍有效的学校会话。</li><li>需要重新登录时，程序填写已保存的账号密码并点击学校的登录按钮。</li><li>自动登录失败后，可点击对应模块的「手动登录」继续。</li><li>遇到验证码、二次验证或页面确认时，打开官方窗口提醒你完成。</li></ol><p>可以随时更新或删除保存的信息。断开某个服务不会删除这里的学校账号。</p></div>
        </>}

        {page === 'ams' && <AmsPage state={ams} ebridge={ebridge} refresh={async()=>{await Promise.all([api.ams.refresh(),api.ebridge.refresh()])}} api={api?.ams} action={action} run={run} onAccount={() => navigate('account')} />}
        {page === 'ebridge' && <EbridgePage state={ebridge} api={api?.ebridge} action={action} run={run} onAccount={() => navigate('account')} />}
        {page==='library'&&<LibraryPage state={library} api={api?.library} onAccount={()=>navigate('account')}/>}
        {page === 'mcp' && <McpPage api={api?.mcp} />}
        {page === 'lmc' && <LmcPage state={lmc} api={api?.lmc} onAccount={() => navigate('account')} />}
      </div>
      </div>
    </main>
  </div>
}
