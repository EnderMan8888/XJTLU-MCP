export interface McpStatus { phase: 'starting' | 'ready' | 'stopped' | 'error'; url: string | null; message: string; tools: string[] }
export type CodexPairingStatus = 'paired' | 'unpaired' | 'outdated' | 'stored' | 'unknown'
export type McpConfigFormat = 'json' | 'codex' | 'deepseek' | 'mimocode' | 'workbuddy' | 'kimi' | 'token' | 'url' | 'bearer'
export type WorkbuddyConfigStatus = 'written' | 'missing' | 'invalid' | 'unknown'
export type WorkbuddyTrustStatus = 'approved' | 'pending' | 'unknown'
export interface WorkbuddyInstallStatus { config: WorkbuddyConfigStatus; pairing: CodexPairingStatus; trust: WorkbuddyTrustStatus }
export const AGENT_CLIENTS = ['codex', 'deepseek', 'workbuddy', 'mimo', 'kimi'] as const
export type AgentClient = typeof AGENT_CLIENTS[number]
export interface AgentInstallStatus {
  installation: 'installed' | 'disabled' | 'partial' | 'not-installed' | 'unknown'
  pairing?: CodexPairingStatus
  version?: string
  detail?: string
  locations: { label: string; path: string }[]
  removable: boolean
}
export interface McpBridge {
  getStatus(): Promise<McpStatus>
  openCodexPlugin(): Promise<void>
  getAgentInstallStatus(client: AgentClient): Promise<AgentInstallStatus>
  installAgent(client: AgentClient): Promise<void>
  uninstallAgent(client: AgentClient): Promise<void>
  openDoubaoSetup(): Promise<void>
  copyConfig(format: McpConfigFormat): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  rotateKey(): Promise<void>
  onState(listener: (state: McpStatus) => void): () => void
}
export const MCP_TOOLS = {
  get_connection_status: 'AMS、eBridge、图书馆、LMC 和西浦邮箱的连接与登录状态',
  refresh_source: '刷新指定学校服务',
  get_modules: 'eBridge 当前学年的课程列表',
  get_timetable: '指定日期的课程、时间、教室和教学组',
  get_exams: '考试日期、入场和开考时间、考场及座位',
  get_grades: '当前学期或全部 eBridge 成绩及分项',
  get_attendance_summary: '当前所选学期的单课及总体签到率',
  get_attendance_records: '今天、昨天、明天的单节出勤和签到时间',
  get_library_overview: '各校区和楼层的剩余座位数',
  get_library_seats: '指定楼层和时段的座位可用状态',
  reserve_library_seat: '发起座位预约，由你确认后提交',
  get_library_reservations: '指定日期的个人座位预约',
  get_lmc_notification: '近四个月的 LMC 通知与公告附件',
  list_lmc_modules: 'LMC 当前可见的课程列表',
  get_module_contents: '课程目录、活动类型和文件夹内的文件',
  get_lmc_grades: 'LMC 个人课程成绩、活动成绩与提交状态',
  download_lmc_file: '保存 LMC 资料和公告附件，可指定本机路径',
  get_email_list: '分页读取西浦邮箱的收件箱或已发送邮件',
  get_email_information: '按邮件 ID 或主题读取邮件正文',
  send_email: '发送邮件，需先在桌面应用开启'
} as const

