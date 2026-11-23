import { contextBridge, ipcRenderer } from 'electron'
import type { AmsState } from '../shared/ams'
import type { CredentialStatus } from '../shared/credentials'
import type { CampusBridge } from '../shared/campus'
import type { EbridgeState } from '../shared/ebridge'
import type { LibraryState } from '../shared/library'
import type { McpStatus } from '../shared/mcp'
import type { LmcState } from '../shared/lmc'

const bridge: CampusBridge = { lmc: {
  getState: () => ipcRenderer.invoke('lmc:get-state'),
  connect: () => ipcRenderer.invoke('lmc:connect'),
  refresh: () => ipcRenderer.invoke('lmc:refresh'),
  showLogin: () => ipcRenderer.invoke('lmc:show-login'),
  disconnect: () => ipcRenderer.invoke('lmc:disconnect'),
  loadCourse: id => ipcRenderer.invoke('lmc:load-course', id),
  loadFolder: id => ipcRenderer.invoke('lmc:load-folder', id),
  loadNotifications: more => ipcRenderer.invoke('lmc:notifications', more),
  download: id => ipcRenderer.invoke('lmc:download', id),
  cancelDownload: id => ipcRenderer.invoke('lmc:cancel-download', id),
  revealDownload: id => ipcRenderer.invoke('lmc:reveal-download', id),
  openSource: source => ipcRenderer.invoke('lmc:open-source', source),
  onState(listener) {
    const callback = (_event: Electron.IpcRendererEvent, state: LmcState): void => listener(state)
    ipcRenderer.on('lmc:state', callback)
    return () => ipcRenderer.removeListener('lmc:state', callback)
  }
}, mcp: {
  getStatus: () => ipcRenderer.invoke('mcp:get-status'),
  openCodexPlugin: () => ipcRenderer.invoke('mcp:open-codex-plugin'),
  getAgentInstallStatus: client => ipcRenderer.invoke('mcp:get-agent-install-status', client),
  installAgent: client => ipcRenderer.invoke('mcp:install-agent', client),
  uninstallAgent: client => ipcRenderer.invoke('mcp:uninstall-agent', client),
  openDoubaoSetup: () => ipcRenderer.invoke('mcp:open-doubao-setup'),
  copyConfig: format => ipcRenderer.invoke('mcp:copy-config', format),
  setEnabled: enabled => ipcRenderer.invoke('mcp:set-enabled', enabled),
  rotateKey: () => ipcRenderer.invoke('mcp:rotate-key'),
  onState(listener) {
    const callback = (_event: Electron.IpcRendererEvent, state: McpStatus): void => listener(state)
    ipcRenderer.on('mcp:state', callback)
    return () => ipcRenderer.removeListener('mcp:state', callback)
  }
}, ams: {
  getState: () => ipcRenderer.invoke('ams:get-state'),
  openLogin: () => ipcRenderer.invoke('ams:open-login'),
  refresh: () => ipcRenderer.invoke('ams:refresh'),
  clearSession: () => ipcRenderer.invoke('ams:clear-session'),
  openSource: () => ipcRenderer.invoke('ams:open-source'),
  openModuleSource: () => ipcRenderer.invoke('ams:open-module-source'),
  reconnect: () => ipcRenderer.invoke('ams:reconnect'),
  showLogin: () => ipcRenderer.invoke('ams:show-login'),
  setTerm: (term) => ipcRenderer.invoke('ams:set-term', term),
  loadScheduleAttendance: (date) => ipcRenderer.invoke('ams:load-schedule-attendance',date),
  onState(listener) {
    const callback = (_event: Electron.IpcRendererEvent, state: AmsState): void => listener(state)
    ipcRenderer.on('ams:state', callback)
    return () => ipcRenderer.removeListener('ams:state', callback)
  }
}, account: {
  getStatus: () => ipcRenderer.invoke('account:get-status'),
  save: (credentials) => ipcRenderer.invoke('account:save', credentials),
  forget: () => ipcRenderer.invoke('account:forget'),
  onChanged(listener) {
    const callback = (_event: Electron.IpcRendererEvent, status: CredentialStatus): void => listener(status)
    ipcRenderer.on('account:changed', callback)
    return () => ipcRenderer.removeListener('account:changed', callback)
  }
}, ebridge: {
  getState: () => ipcRenderer.invoke('ebridge:get-state'),
  connect: () => ipcRenderer.invoke('ebridge:connect'),
  refresh: () => ipcRenderer.invoke('ebridge:refresh'),
  setLocalCache: enabled => ipcRenderer.invoke('ebridge:local-cache', enabled),
  loadGrades: () => ipcRenderer.invoke('ebridge:grades'),
  openGradeSource: (view) => ipcRenderer.invoke('ebridge:grade-source', view),
  showLogin: () => ipcRenderer.invoke('ebridge:show-login'),
  openSource: (view) => ipcRenderer.invoke('ebridge:open-source', view),
  disconnect: () => ipcRenderer.invoke('ebridge:disconnect'),
  onState(listener) {
    const callback = (_event: Electron.IpcRendererEvent, state: EbridgeState): void => listener(state)
    ipcRenderer.on('ebridge:state', callback)
    return () => ipcRenderer.removeListener('ebridge:state', callback)
  }
}, library: {
  getState: () => ipcRenderer.invoke('library:get-state'),
  refresh: () => ipcRenderer.invoke('library:refresh'),
  connect: () => ipcRenderer.invoke('library:connect'),
  showLogin: () => ipcRenderer.invoke('library:show-login'),
  searchSeats: (query) => ipcRenderer.invoke('library:search',query),
  prepareBooking: (selection) => ipcRenderer.invoke('library:prepare',selection),
  submitBooking: (id,acceptedNotice,captcha) => ipcRenderer.invoke('library:submit',{id,acceptedNotice,captcha}),
  reviewAgentBooking: id => ipcRenderer.invoke('library:agent-review',id),
  submitAgentBooking: (requestId,draftId,acceptedNotice,captcha) => ipcRenderer.invoke('library:agent-submit',{requestId,draftId,acceptedNotice,captcha}),
  cancelAgentBooking: id => ipcRenderer.invoke('library:agent-cancel',id),
  getCaptcha: () => ipcRenderer.invoke('library:captcha'),
  getReservations: () => ipcRenderer.invoke('library:reservations'),
  openSource: () => ipcRenderer.invoke('library:open-source'),
  onState(listener) {
    const callback=(_event:Electron.IpcRendererEvent,state:LibraryState):void=>listener(state)
    ipcRenderer.on('library:state',callback)
    return ()=>ipcRenderer.removeListener('library:state',callback)
  }
} }
contextBridge.exposeInMainWorld('campus', bridge)
