import type { AmsBridge } from './ams'
import type { AccountBridge } from './credentials'
import type { EbridgeBridge } from './ebridge'
import type { LibraryBridge } from './library'
export interface CampusBridge { ams: AmsBridge; account: AccountBridge; ebridge: EbridgeBridge; library:LibraryBridge }
