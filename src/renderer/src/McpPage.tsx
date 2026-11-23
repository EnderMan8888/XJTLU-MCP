import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MCP_TOOLS, type AgentClient, type AgentInstallStatus, type CodexPairingStatus, type McpBridge, type McpConfigFormat, type McpStatus } from '../../shared/mcp'

const pairingLabels: Record<CodexPairingStatus, string> = {
  paired: '已配对', unpaired: '尚未配对', outdated: '密钥已变更，请重新配对', stored: '已保存，开启本机连接后可核对', unknown: '无法确认'
}
const agentInstallationLabels: Record<AgentInstallStatus['installation'], string> = {
  installed: '已安装', disabled: '已安装，当前已停用', partial: '安装待处理', 'not-installed': '尚未安装', unknown: '无法确认'
}
const unknownAgent: AgentInstallStatus = { installation: 'unknown', locations: [], removable: false }

interface AgentCardProps {
  client: AgentClient
  name: string
  summary: ReactNode
  api: McpBridge | undefined
  ready: boolean
  busy: boolean
  children: ReactNode
}

function AgentClientCard({ client, name, summary, api, ready, busy, children }: AgentCardProps): React.JSX.Element {
  const [status, setStatus] = useState<AgentInstallStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [action, setAction] = useState<'install' | 'uninstall' | 'open' | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const request = useRef(0)
  const refresh = useCallback(async () => {
    if (!api) return
    const current = ++request.current
    setChecking(true)
    const result = await api.getAgentInstallStatus(client).catch(() => unknownAgent)
    if (current === request.current) {
      setStatus(result)
      setChecking(false)
    }
  }, [api, client])
  useEffect(() => {
    void refresh()
    window.addEventListener('focus', refresh)
    return () => { request.current++; window.removeEventListener('focus', refresh) }
  }, [refresh, ready])

  const change = async (operation: 'install' | 'uninstall' | 'open'): Promise<void> => {
    if (!api) return
    const verb = { install: '安装', uninstall: '卸载', open: '打开插件页' }[operation]
    setAction(operation)
    setNotice(null)
    try {
      if (operation === 'open') {
        await api.openCodexPlugin()
        return
      }
      if (operation === 'install') await api.installAgent(client)
      else await api.uninstallAgent(client)
      setNotice({ text: `${verb}完成。请重新打开 ${name}。` })
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : ''
      setNotice({ text: message || `${verb}未完成，请检查配置后重试。`, error: true })
    } finally {
      if (operation !== 'open') await refresh()
      setAction(null)
    }
  }

  const disabled = !api || busy || Boolean(action) || checking
  return <section className="card mcp-card" id={`${client}-connection`}>
    <h2>{name}</h2>
    <p>{summary}</p>
    <div className="mcp-tools" aria-live="polite" aria-busy={checking || Boolean(action)}>
      <div><strong>安装状态</strong><span>{status ? agentInstallationLabels[status.installation] : api ? '正在检查…' : '无法确认'}{status?.version && ` · v${status.version}`}</span></div>
      {status?.pairing && <div><strong>访问密钥</strong><span>{pairingLabels[status.pairing]}</span></div>}
      {status?.locations.map(({ label, path }) => <div key={path}><strong>{label}</strong><code className="mcp-location">{path}</code></div>)}
      {status?.detail && <div><strong>连接说明</strong><span>{status.detail}</span></div>}
    </div>
    <div className="actions mcp-actions">
      <button className="primary" disabled={disabled || !ready} onClick={() => void change('install')}>{action === 'install' ? '正在安装…' : status?.removable ? '重新安装' : '安装'}</button>
      <button disabled={disabled || !status?.removable} onClick={() => void change('uninstall')}>{action === 'uninstall' ? '正在卸载…' : '卸载'}</button>
      <button disabled={disabled} onClick={() => void refresh()}>{checking ? '正在检查…' : '刷新状态'}</button>
      {client === 'codex' && <button disabled={!api || busy || Boolean(action)} onClick={() => void change('open')}>打开插件页</button>}
    </div>
    {notice && <div className={`notice${notice.error ? ' error' : ''}`} role="status">{notice.text}</div>}
    <p>{children}</p>
  </section>
}

export function McpPage({ api }: { api: McpBridge | undefined }): React.JSX.Element {
  const [state, setState] = useState<McpStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!api) return
    let live = true
    const stop = api.onState(next => { if (live) setState(next) })
    void api.getStatus().then(next => { if (live) setState(next) }).catch(() => { if (live) setNotice('连接状态暂时无法读取。') })
    return () => { live = false; stop() }
  }, [api])
  const ready = state?.phase === 'ready'
  const run = async (operation: () => Promise<void>, success = '', failure = '操作未能完成，请检查连接状态后重试。'): Promise<void> => {
    setBusy(true); setNotice('')
    try { await operation(); setNotice(success) } catch { setNotice(failure) } finally { setBusy(false) }
  }
  const copy = (format: McpConfigFormat): void => { if (api) void run(() => api.copyConfig(format), '已复制。配置或访问密钥仅提供给你信任的本机 Agent。') }
  return <>
    <div className="heading"><div><div className="eyebrow">CONNECT YOUR AGENT</div><h1>Agent 连接</h1><p>让本机 AI 助手通过 MCP 查询你的校园信息。</p></div><div className="ams-icon">↗</div></div>
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="card mcp-card">
      <div className="mcp-title"><h2>{ready ? '已开启本机连接' : state?.phase === 'starting' ? '正在开启连接…' : '本机连接未开启'}</h2><span className={`status ${ready ? 'status-connected' : 'status-idle'}`}><span />{ready ? '可连接' : state?.phase === 'error' ? '需要检查' : '未就绪'}</span></div>
      <p>{state?.message ?? '正在读取连接状态…'}</p>
      {state?.url && <div className="mcp-endpoint"><span>服务地址</span><code>{state.url}</code></div>}
      <div className="actions mcp-actions">
        <button disabled={!ready || busy} onClick={() => copy('codex')}>复制 Codex 配置</button>
        <button disabled={!ready || busy} onClick={() => copy('deepseek')}>复制 DeepSeek Harness 配置</button>
        <button disabled={!ready || busy} onClick={() => copy('workbuddy')}>复制 WorkBuddy 配置</button>
        <button disabled={!ready || busy} onClick={() => copy('mimocode')}>复制 MiMo Code 配置</button>
        <button disabled={!ready || busy} onClick={() => copy('kimi')}>复制 Kimi Code 配置</button>
        <button disabled={!ready || busy} onClick={() => copy('json')}>复制通用配置</button>
        <button disabled={!ready || busy} onClick={() => copy('token')}>复制访问密钥</button>
      </div>
      <p className="muted">在支持 Streamable HTTP 的本机 Agent 中添加此服务。配置包含访问密钥；学校账号密码和会话不会提供给 Agent。</p>
      <div className="actions"><button disabled={!api || busy || state?.phase === 'starting'} onClick={() => { if (api) void run(() => api.setEnabled(!ready)) }}>{ready ? '关闭本次连接' : '开启连接'}</button><button disabled={!api || busy || state?.phase === 'starting'} onClick={() => { if (api) void run(() => api.rotateKey(), '访问密钥已重置。请重新安装已连接的插件或更新客户端配置。') }}>重置访问密钥</button></div>
    </section>
    <AgentClientCard client="codex" name="ChatGPT" api={api} busy={busy} ready={ready} summary="本机 ChatGPT 桌面端的 Codex 插件">
      安装时会登记本机插件目录并配对访问密钥。「打开插件页」可以在 ChatGPT 查看 XJTLU-MCP 插件。安装或更新后，请完全退出并重新打开 ChatGPT，再新建本地 Codex 会话。重置密钥后再点一次安装即可重新配对。
    </AgentClientCard>
    <AgentClientCard client="deepseek" name="DeepSeek Harness" api={api} busy={busy} ready={ready}
      summary={<>安装、更新或卸载插件前，从托盘完全退出 DeepSeek Harness。操作完成后重新打开客户端。已有同名 <code>xjtlu</code> 连接器时，优先使用原配置。</>}>
      在新会话调用 <code>mcp__xjtlu__get_connection_status</code> 验证。重置密钥后再点一次安装，已加载插件的客户端会自动重连。
    </AgentClientCard>
    <AgentClientCard client="workbuddy" name="腾讯 WorkBuddy" api={api} busy={busy} ready={ready} summary="WorkBuddy 桌面端的本机 MCP 接入">
      点一下即把 <code>mcpServers.xjtlu</code> 写入 WorkBuddy 的 <code>%USERPROFILE%\.workbuddy\mcp.json</code>（streamableHttp、本机地址、Authorization 头），同一文件里的其他连接器保持不变，首次写入前留备份。首次连接仍需在 WorkBuddy「连接器」页对 xjtlu 点一次「信任」。信任按服务地址记录，重置访问密钥后不用再点。之后在新会话调用 <code>mcp__xjtlu__get_connection_status</code> 验证。
    </AgentClientCard>
    <section className="card mcp-card" id="doubao-connection">
      <h2>豆包</h2>
      <p>「在豆包中配置」会打开豆包电脑版并复制服务地址。在豆包的「插件 · 技能 · 伙伴」里点击「添加」→「新建自定义连接器」。如果已有同一地址的连接器，可以直接启用或编辑原条目。</p>
      <div className="mcp-tools">
        <div><strong>名称</strong><span>XJTLU-MCP</span></div>
        <div><strong>传输类型</strong><span>HTTP</span></div>
        <div><strong>服务器 URL</strong><span>{state?.url ?? '开启本机连接后显示'}</span></div>
        <div><strong>自定义 Headers</strong><span>名称填 <code>Authorization</code>，值用「复制授权值」获取。</span></div>
      </div>
      <div className="actions mcp-actions">
        <button className="primary" disabled={!api || !ready || busy} onClick={() => {
          if (api) void run(() => api.openDoubaoSetup(), '已复制服务地址。请在豆包的连接器表单中粘贴。', '无法打开豆包配置。可从开始菜单打开豆包，再用下方按钮复制配置。')
        }}>在豆包中配置</button>
        <button disabled={!ready || busy} onClick={() => copy('url')}>复制服务地址</button>
        <button disabled={!ready || busy} onClick={() => copy('bearer')}>复制授权值</button>
      </div>
      <p>保存并启用连接器后，在豆包的本地电脑会话中调用 <code>get_connection_status</code>。密钥重置后，在豆包中更新 <code>Authorization</code> 的值。</p>
    </section>
    <AgentClientCard client="mimo" name="Xiaomi MiMo Code" api={api} busy={busy} ready={ready} summary="MiMo Desktop（MiMo Code）的本机 MCP 接入">
      一键安装会把访问密钥写入用户环境变量 <code>XJTLU_MCP_TOKEN</code>、把 <code>mcp.xjtlu</code> 写入 mimocode 配置，并把 XJTLU 登记进 MiMo 插件列表（本机注册表，可回退）。完全退出并重启 MiMo Desktop 后生效，新会话调用 <code>xjtlu_get_connection_status</code> 验证。密钥重置后再点一次即可重新配对。
    </AgentClientCard>
    <AgentClientCard client="kimi" name="Kimi Code" api={api} busy={busy} ready={ready}
      summary={<>一键安装将 <code>xjtlu</code> 合并到 Kimi Code 的用户配置并保存访问密钥。</>}>
      完全退出并重启 Kimi Code 后，新建本地会话验证 <code>mcp__xjtlu__get_connection_status</code>。重置密钥后再点一次安装。
    </AgentClientCard>
    <section className="card mcp-card"><h2>可用工具</h2><div className="mcp-tools">{Object.entries(MCP_TOOLS).map(([name, description]) => <div key={name}><code>{name}</code><span>{description}</span></div>)}</div></section>
    <div className="account-explanation"><h2>使用方式</h2><ol><li>在应用中连接 AMS、eBridge 等需要查询的学校服务。</li><li>打开 ChatGPT 安装插件，或复制配置到其他本机 Agent。</li><li>保持本程序运行，再向 Agent 询问课程、考试或出勤。</li></ol><p>最小化窗口时，Agent 连接继续运行。Windows 上点右上角 × 会收起到系统托盘。需要停止时，可点「关闭本次连接」，或在托盘菜单中退出程序。</p><p>日期按北京时间处理。缺少考勤记录时会保留未知状态。本连接只供本机使用。</p></div>
  </>
}
