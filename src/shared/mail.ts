import type { ConnectionPhase } from './ams.ts'

export type MailFolder = 'inbox' | 'sentitems'
export type MailLogin = 'campus' | 'manual'
export interface MailListInput { folder?: MailFolder; offset?: number; limit?: number }
export interface MailLookup { id?: string; name?: string; folder?: MailFolder }
export interface OutgoingMail { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string }
export type MailAddress = { name: string | null; address: string | null }
export type MailSummary = {
  id: string
  subject: string
  from: MailAddress | null
  receivedAt: string | null
  sentAt: string | null
  isRead: boolean | null
  hasAttachments: boolean | null
}
export function mailDate(item: MailSummary, folder: MailFolder): string | null {
  return folder === 'inbox' ? item.receivedAt ?? item.sentAt : item.sentAt ?? item.receivedAt
}
export type MailMessage = MailSummary & {
  body: string
  bodyType: 'text' | 'html'
  to: (MailAddress | null)[]
  cc: (MailAddress | null)[]
  bcc: (MailAddress | null)[]
}
export type MailListPage = { folder: MailFolder; messages: MailSummary[]; total: number; nextOffset: number | null }
export type MailReadResult<T> = { ok: true; value: T } | { ok: false; message: string }
export interface MailArchiveState { enabled: boolean; revision: number; issue: string | null }
export interface MailHistory { revision: number; messages: MailSummary[] }
export interface MailState { phase: ConnectionPhase; message: string; sendEnabled: boolean; sessionRevision: number; archive: MailArchiveState }
export const initialMailState: MailState = { phase: 'idle', message: '请登录学校邮箱。', sendEnabled: false, sessionRevision: 0,
  archive: { enabled: false, revision: 0, issue: null } }
export interface MailBridge {
  getState(): Promise<MailState>
  restore(): Promise<void>
  open(mode: MailLogin): Promise<void>
  list(folder: MailFolder, offset: number): Promise<MailReadResult<MailListPage>>
  read(id: string): Promise<MailReadResult<MailMessage>>
  disconnect(): Promise<void>
  setSendEnabled(enabled: boolean): Promise<MailState>
  history(folder: MailFolder): Promise<MailReadResult<MailHistory>>
  setArchiveEnabled(enabled: boolean): Promise<MailState>
  clearArchive(): Promise<MailState>
  onState(listener: (state: MailState) => void): () => void
}
