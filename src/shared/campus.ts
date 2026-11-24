import type { AmsBridge } from './ams'
import type { AccountBridge } from './credentials'
import type { EbridgeBridge } from './ebridge'
import type { LibraryBridge } from './library'
import type { McpBridge } from './mcp'
import type { LmcBridge } from './lmc'
import type { SettingsBridge } from './auto-relogin'
export interface CampusBridge { ams: AmsBridge; account: AccountBridge; ebridge: EbridgeBridge; library:LibraryBridge; mcp: McpBridge; lmc: LmcBridge; settings: SettingsBridge }
