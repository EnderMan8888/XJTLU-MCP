import { useEffect, useRef, useState } from 'react'
import type { AccountBridge, CredentialStatus } from '../../shared/credentials'

export function CredentialPanel({ api, disabled, onError }: { api: AccountBridge; disabled: boolean; onError: (message: string) => void }): React.JSX.Element {
  const [status, setStatus] = useState<CredentialStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  // Keep the password outside React state. Clear the actual input on cancel,
  // save, and unmount; never request a saved password back over IPC.
  const password = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    const stop = api?.onChanged((next) => { if (live) setStatus(next) })
    if (api) void api.getStatus().then((next) => { if (live) setStatus(next) }).catch(() => { if (live) onError('无法读取账号保存状态。') })
    return () => { live = false; stop?.() }
  }, [api, onError])

  const close = (): void => {
    if (password.current) password.current.value = ''
    setOpen(false); setError('')
  }
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const value = password.current?.value ?? ''
    if (!username.trim() || !value) { setError('请输入学校账号和密码。'); return }
    setBusy(true); setError('')
    try {
      const result = await api.save({ username: username.trim(), password: value })
      setStatus(result.status)
      if (result.ok) close()
      else setError(result.message)
    } catch { setError('保存失败，请重试。') } finally { setBusy(false) }
  }
  const forget = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.forget()
      setStatus(result.status)
      if (!result.ok) onError(result.message)
    } catch { onError('删除失败，请重试。') } finally { setBusy(false); setConfirmForget(false) }
  }

  return <>
    <div className="credential-panel">
      <div><strong>{status?.saved ? '学校账号已保存' : '设置学校账号'}</strong><span>{status?.saved ? status.username ? `已保存：${status.username} · 用于学校服务自动登录` : status.message : '在首页统一管理，已接入服务按需使用'}</span></div>
      <div className="credential-actions">
        <button className="text-button" disabled={disabled || busy || !api || !status?.available} onClick={() => { setUsername(status?.username ?? ''); setError(''); setOpen(true) }}>{status?.saved ? '更新账号密码' : '设置'}</button>
        {status?.saved && <button className="text-button" disabled={disabled || busy} onClick={() => setConfirmForget(true)}>删除已保存密码</button>}
      </div>
    </div>
    {status && !status.available && <div className="credential-unavailable">{status.message}</div>}
    {open && <div className="modal-backdrop"><form className="modal credential-modal" role="dialog" aria-modal="true" aria-labelledby="credential-title" onSubmit={(event) => void save(event)} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) close() }}>
      <h2 id="credential-title">在本机记住账号密码</h2>
      <p>账号和密码会加密保存在本机。程序会在西浦官方页面自动填入并点击登录，只有需要验证码、二次验证或额外确认时才提示你处理。</p>
      <label htmlFor="school-username">学校账号</label><input id="school-username" name="username" autoComplete="username" maxLength={256} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入学校账号" autoFocus disabled={busy} />
      <label htmlFor="school-password">学校密码</label><input ref={password} id="school-password" name="password" type="password" autoComplete="off" maxLength={1024} placeholder="输入学校密码" disabled={busy} />
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="actions"><button type="button" disabled={busy} onClick={close}>取消</button><button className="primary" type="submit" disabled={busy}>{busy ? '正在加密保存…' : '保存并启用自动登录'}</button></div>
    </form></div>}
    {confirmForget && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="forget-title"><h2 id="forget-title">删除已保存的账号密码？</h2><p>当前学校会话仍可继续使用，下一次需要输入密码时将由你手动填写。</p><div className="actions"><button disabled={busy} onClick={() => setConfirmForget(false)}>取消</button><button className="primary" disabled={busy} onClick={() => void forget()}>删除密码</button></div></div></div>}
  </>
}
