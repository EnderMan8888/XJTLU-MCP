import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { CodexPairingStatus } from '../shared/mcp.ts'

const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const name = 'XJTLU_MCP_TOKEN'
const pairingStates = ['paired', 'unpaired', 'outdated', 'stored'] as const

function runPairingCommand(command: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // The secret only crosses stdin, never the process arguments or stdout.
    const child = execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
        if (error) reject(new Error('无法写入 Agent 配对密钥。'))
        else resolve(stdout.trim())
      })
    child.stdin?.on('error', () => { /* execFile reports a failed child. */ })
    child.stdin?.end(token + '\n')
  })
}

export async function inspectAgentKey(token: string): Promise<CodexPairingStatus> {
  const command = [
    "$ErrorActionPreference='Stop'",
    '$key=[Console]::In.ReadLine()',
    `$stored=[Environment]::GetEnvironmentVariable('${name}',[EnvironmentVariableTarget]::User)`,
    "if (!$stored) { 'unpaired' } elseif (!$key) { 'stored' } elseif ($stored -ceq $key) { 'paired' } else { 'outdated' }"
  ].join('; ')
  try {
    const result = await runPairingCommand(command, token)
    return (pairingStates as readonly string[]).includes(result) ? result as CodexPairingStatus : 'unknown'
  } catch { return 'unknown' }
}

export async function saveAgentKey(token: string): Promise<void> {
  const command = [
    "$ErrorActionPreference='Stop'",
    '$key=[Console]::In.ReadLine()',
    "if ($key -cnotmatch '\\A[0-9a-f]{64}\\z') { exit 2 }",
    `[Environment]::SetEnvironmentVariable('${name}',$key,[EnvironmentVariableTarget]::User)`
  ].join('; ')
  await runPairingCommand(command, token)
}
