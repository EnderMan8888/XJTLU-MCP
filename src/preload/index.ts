import { contextBridge, ipcRenderer } from 'electron'
import type { AmsState } from '../shared/ams'
import type { CredentialStatus } from '../shared/credentials'
import type { CampusBridge } from '../shared/campus'
import type { EbridgeState } from '../shared/ebridge'
import type { LibraryState } from '../shared/library'

const bridge: CampusBridge = { ams: {
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
