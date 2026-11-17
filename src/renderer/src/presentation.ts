import type { ConnectionPhase } from '../../shared/ams'

export const phases: Record<ConnectionPhase, string> = {
  idle: '等待连接', authenticating: '自动连接中', loading: '正在读取', connected: '已连接',
  'verification-required': '需要验证', 'credentials-required': '需要设置账号', expired: '需要重新连接', error: '连接异常'
}
export function updatedAt(value: string | null): string {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : '尚未读取'
}
export function percent(value: number | null): string { return value === null ? '暂无统计' : `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)}%` }
