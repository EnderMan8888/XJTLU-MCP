export const SCHOOL_SERVICES = ['ams', 'ebridge', 'library', 'lmc'] as const
export type SchoolService = typeof SCHOOL_SERVICES[number]
export type AutoReloginSettings = Record<SchoolService, boolean>

export const defaultAutoRelogin: AutoReloginSettings = {
  ams: false, ebridge: false, library: false, lmc: false
}

export interface SettingsBridge {
  getAutoRelogin(): Promise<AutoReloginSettings>
  setAutoRelogin(service: SchoolService, enabled: boolean): Promise<AutoReloginSettings>
}
