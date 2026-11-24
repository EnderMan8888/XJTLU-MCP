import type { ConnectionPhase } from './ams'

export const LMC_ORIGIN = 'https://core.xjtlu.edu.cn'
export interface LmcCourse { id: string; title: string; shortName: string }
export interface LmcAssignmentDates { opens: string | null; due: string | null }
export interface LmcActivity { id: string; title: string; section: string; type: string; fileType: string; downloadable: boolean; assignmentDates?: LmcAssignmentDates }
export interface LmcFile { id: string; name: string; path: string; extension: string }
export interface LmcFolder { files: LmcFile[]; fetchedAt: string | null; loading: boolean; issue: string | null }
export interface LmcModule { courseId: string; activities: LmcActivity[]; folders: Record<string, LmcFolder>; fetchedAt: string | null; loading: boolean; issue: string | null }
export interface LmcNotificationAttachment { fileId: string; name: string }
export interface LmcNotification { id: string; title: string; body: string; createdAt: string | null; read: boolean | null; source: string; hasSource: boolean; canListAttachments?: boolean; attachments?: LmcNotificationAttachment[] }
export interface LmcNotificationRange { notifications: LmcNotification[]; fetchedAt: string | null; complete: boolean; issue: string | null }
export function isSignInNotice(title: string): boolean {
  return title.trim().replace(/\s+/g, ' ').toLowerCase() === 'new sign in to your learning mall core account'
}
export interface LmcDownload { id: string; name: string; phase: 'preparing' | 'downloading' | 'completed' | 'cancelled' | 'error'; received: number; total: number; message: string }
export interface LmcState {
  phase: ConnectionPhase
  message: string
  courses: LmcCourse[]
  coursesAt: string | null
  coursesComplete: boolean
  modules: Record<string, LmcModule>
  notifications: LmcNotification[]
  notificationsAt: string | null
  unreadCount: number | null
  moreNotifications: boolean
  notificationsLoading: boolean
  downloads: LmcDownload[]
  issues: { courses: string | null; notifications: string | null }
}
export type LmcSource = { kind: 'home' } | { kind: 'course' | 'activity' | 'notification'; id: string }
export interface LmcBridge {
  getState(): Promise<LmcState>
  connect(): Promise<void>
  refresh(): Promise<void>
  showLogin(): Promise<void>
  disconnect(): Promise<void>
  loadCourse(id: string): Promise<void>
  loadFolder(id: string): Promise<void>
  loadNotifications(more: boolean): Promise<void>
  loadNotificationAttachments(notificationId: string): Promise<LmcNotificationAttachment[] | null>
  download(id: string, notificationId?: string): Promise<void>
  cancelDownload(id: string): Promise<void>
  revealDownload(id: string): Promise<void>
  openSource(source: LmcSource): Promise<void>
  onState(listener: (state: LmcState) => void): () => void
}
export function initialLmcState(): LmcState {
  return { phase: 'idle', message: '连接 Learning Mall Core，查看课程资料和通知。', courses: [], coursesAt: null, coursesComplete: false, modules: {}, notifications: [], notificationsAt: null, unreadCount: null, moreNotifications: false, notificationsLoading: false, downloads: [], issues: { courses: null, notifications: null } }
}
