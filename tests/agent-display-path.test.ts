import assert from 'node:assert/strict'
import { it } from 'node:test'
import { agentDisplayPath } from '../src/main/agent-display-path.ts'

const roots = {
  appPath: 'C:\\Users\\CurrentUser\\Downloads\\XJTLU-MCP\\resources\\app',
  appData: 'C:\\Users\\CurrentUser\\AppData\\Roaming',
  localAppData: 'C:\\Users\\CurrentUser\\AppData\\Local',
  userProfile: 'C:\\Users\\CurrentUser'
}

it('shows paths relative to the installation and current profile without showing the account name', () => {
  assert.equal(agentDisplayPath(`${roots.appPath}\\codex-plugin`, roots), '程序目录\\codex-plugin')
  assert.equal(agentDisplayPath(`${roots.appData}\\XJTLU-MCP-AMS\\agent-plugins\\codex`, roots), '%APPDATA%\\XJTLU-MCP-AMS\\agent-plugins\\codex')
  assert.equal(agentDisplayPath(roots.localAppData, roots), '%LOCALAPPDATA%')
  assert.equal(agentDisplayPath('c:/users/currentuser/.workbuddy/mcp.json', roots), '%USERPROFILE%\\.workbuddy\\mcp.json')
})

it('does not show a copied profile path or a directory with a similar prefix', () => {
  assert.equal(agentDisplayPath('C:\\Users\\PreviousUser\\old-plugin', roots), '自定义位置')
  assert.equal(agentDisplayPath('C:\\Users\\CurrentUser2\\old-plugin', roots), '自定义位置')
  assert.equal(agentDisplayPath('D:\\ArchivedProfiles\\PreviousUser', roots), '自定义位置')
})
