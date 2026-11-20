import { useCallback, useEffect, useRef, useState } from 'react'
import { MCP_TOOLS, type CodexPluginStatus, type McpBridge, type McpConfigFormat, type McpStatus } from '../../shared/mcp'

const installationLabels: Record<CodexPluginStatus['installation'], string> = {
  enabled: '已安装并启用', disabled: '已安装，当前已停用', 'not-installed': '尚未安装', unknown: '无法确认'
}
const marketplaceLabels: Record<CodexPluginStatus['marketplace'], string> = {
  registered: '已登记到 Codex 插件列表', unregistered: '尚未登记到 Codex 插件列表', unknown: '无法确认'
}
const pairingLabels: Record<CodexPluginStatus['pairing'], string> = {
  paired: '已配对', unpaired: '尚未配对', outdated: '密钥已变更，请重新配对', stored: '已保存，开启本机连接后可核对', unknown: '无法确认'
}
const unknownPlugin: CodexPluginStatus = { installation: 'unknown', marketplace: 'unknown', pairing: 'unknown', version: null }

export function McpPage({ api }: { api: McpBridge | undefined }): React.JSX.Element {
  const [state, setState] = useState<McpStatus | null>(null)
  const [plugin, setPlugin] = useState<CodexPluginStatus | null>(null)
  const [checkingPlugin, setCheckingPlugin] = useState(false)
  const pluginRequest = useRef(0)
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
  const refreshPlugin = useCallback(async () => {
    if (!api) return
    const request = ++pluginRequest.current
    setCheckingPlugin(true)
    const result = await api.getCodexPluginStatus().catch(() => unknownPlugin)
    if (request === pluginRequest.current) {
      setPlugin(result)
      setCheckingPlugin(false)
    }
  }, [api])
  useEffect(() => {
    void refreshPlugin()
    window.addEventListener('focus', refreshPlugin)
    return () => { pluginRequest.current++; window.removeEventListener('focus', refreshPlugin) }
  }, [refreshPlugin, ready])
  const run = async (operation: () => Promise<void>, success = '', failure = '操作未能完成，请检查连接状态后重试。'): Promise<void> => {
    setBusy(true); setNotice('')
    try { await operation(); setNotice(success) } catch { setNotice(failure) } finally { setBusy(false) }
  }
  const copy = (format: McpConfigFormat): void => { if (api) void run(() => api.copyConfig(format), '已复制。配置或访问密钥仅提供给你信任的本机 Agent。') }
  const installed = plugin?.installation === 'enabled' || plugin?.installation === 'disabled'
  const openPlugin = (): void => {
    if (api) void run(async () => {
      try { await api.openCodexPlugin() } finally { await refreshPlugin() }
    },
    installed ? '已登记插件目录并核对密钥。重开 ChatGPT 后可在本地 Codex 的插件列表查看。'
      : '已登记插件目录并配对密钥。请在 ChatGPT 点击「安装」，重开后开始本地 Codex 会话。',
    '无法完成配对或打开插件页。请确认本机 Agent 已开启且 ChatGPT 桌面端可用。')
  }
  return <>
    <div className="heading"><div><div className="eyebrow">CONNECT YOUR AGENT</div><h1>Agent 连接</h1><p>让本机 AI 助手通过 MCP 查询你的校园信息。</p></div><div className="ams-icon">↗</div></div>
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="card mcp-card">
      <div className="mcp-title"><h2>{ready ? '已开启本机连接' : state?.phase === 'starting' ? '正在开启连接…' : '本机连接未开启'}</h2><span className={`status ${ready ? 'status-connected' : 'status-idle'}`}><span />{ready ? '可连接' : state?.phase === 'error' ? '需要检查' : '未就绪'}</span></div>
      <p>{state?.message ?? '正在读取连接状态…'}</p>
      {state?.url && <div className="mcp-endpoint"><span>服务地址</span><code>{state.url}</code></div>}
      <div className="actions mcp-actions"><button disabled={!ready || busy} onClick={() => copy('codex')}>复制 Codex 配置</button><button disabled={!ready || busy} onClick={() => copy('json')}>复制通用配置</button><button disabled={!ready || busy} onClick={() => copy('token')}>复制访问密钥</button></div>
      <p className="muted">在支持 Streamable HTTP 的本机 Agent 中添加此服务。配置包含访问密钥；学校账号密码和会话不会提供给 Agent。</p>
      <div className="actions"><button disabled={!api || busy || state?.phase === 'starting'} onClick={() => { if (api) void run(() => api.setEnabled(!ready)) }}>{ready ? '关闭本次连接' : '开启连接'}</button><button disabled={!api || busy || state?.phase === 'starting'} onClick={() => { if (api) void run(() => api.rotateKey(), '访问密钥已重置。请重新打开 ChatGPT 插件页配对，或为其他 Agent 复制新配置。') }}>重置访问密钥</button></div>
    </section>
    <section className="card mcp-card">
      <h2>XJTLU 校园助手</h2>
      <p>本机 ChatGPT 桌面端的 Codex 插件</p>
      <div className="mcp-tools" aria-live="polite" aria-busy={checkingPlugin}>
        <div><strong>安装状态</strong><span>{plugin ? installationLabels[plugin.installation] : '正在检查…'}{plugin?.version && ` · v${plugin.version}`}</span></div>
        <div><strong>插件目录</strong><span>{plugin ? marketplaceLabels[plugin.marketplace] : '正在检查…'}</span></div>
        <div><strong>访问密钥</strong><span>{plugin ? pairingLabels[plugin.pairing] : '正在检查…'}</span></div>
      </div>
      <div className="actions mcp-actions">
        <button className="primary" disabled={!ready || busy} onClick={openPlugin}>{installed ? '打开 ChatGPT 插件页' : '在 ChatGPT 中安装'}</button>
        <button disabled={!api || busy || checkingPlugin} onClick={() => void refreshPlugin()}>{checkingPlugin ? '正在检查…' : '刷新安装状态'}</button>
      </div>
      <p>{installed && plugin?.marketplace === 'unregistered'
        ? '点击「打开 ChatGPT 插件页」即可把本机目录加入 Codex 插件列表。'
        : '打开插件页时，应用会自动配对访问密钥。'}</p>
    </section>
    <section className="card mcp-card"><h2>可用工具</h2><div className="mcp-tools">{Object.entries(MCP_TOOLS).map(([name, description]) => <div key={name}><code>{name}</code><span>{description}</span></div>)}</div></section>
    <div className="account-explanation"><h2>使用方式</h2><ol><li>在应用中连接 AMS、eBridge 等需要查询的学校服务。</li><li>打开 ChatGPT 安装插件，或复制配置到其他本机 Agent。</li><li>保持本程序运行，再向 Agent 询问课程、考试或出勤。</li></ol><p>日期按北京时间处理。缺少考勤记录时会保留未知状态。关闭应用即停止连接；下次启动会重新开启。本连接只供本机使用。</p></div>
  </>
}
