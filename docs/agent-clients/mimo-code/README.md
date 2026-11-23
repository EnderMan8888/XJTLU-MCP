# Xiaomi MiMo Code 接入说明

以 XJTLU-MCP V2.0 的 16 项 MCP 工具为目标，记录 MiMo Code 客户端在 Windows 上的接入方式、实测结果和「Agent 连接」页建议。验证全程使用虚构数据与随机本机端口，未连接学校、未提交预约、未下载文件。日期：2026-11-22。

## 1. 客户端核对

| 项目 | 核对结果 |
| --- | --- |
| 实际客户端 | **Xiaomi MiMo Desktop 26.1120.201429**（`D:\Xiaomi MiMo\Xiaomi MiMo.exe`，注册表卸载项版本一致），内嵌 MiMoCode 引擎 |
| 独立 `mimo` CLI | **本机未安装**。已查 PATH、`%APPDATA%\npm`、`%LOCALAPPDATA%\Programs`、scoop/bun 目录、WindowsApps 别名与卸载注册表，均无 `mimo`/`mimocode` 可执行文件。官方安装入口为 `powershell -ep Bypass -c "irm https://mimo.xiaomi.com/install.ps1 | iex"`；按用户要求不安装 CLI，验证以 MiMo Desktop 为客户端 |
| 可用命令 | 装有 CLI 时为 `mimo mcp list`、`mimo mcp auth <名称>`、`mimo mcp debug <名称>`、`mimo mcp logout <名称>`（`mimo` 无子命令时进入 TUI，`/mcps` 查看 MCP 状态）。MiMo Desktop 的等效查看方式：会话内 MCP 工具面（工具以 `xjtlu_<工具名>` 注册，命名规则为服务名前缀）或设置界面的服务状态 |
| 用户级配置路径 | `%USERPROFILE%\.config\mimocode\mimocode.jsonc`（本机实测存在；同目录还接受 `config.json`、`mimocode.json`，按此顺序合并，后者覆盖前者） |
| 项目级配置 | `.mimocode/mimocode.json` 或 `mimocode.jsonc`，从当前目录向上检索到工作区根，父级先、当前后逐层深合并；同名 `mcp` 条目后者覆盖前者 |
| 配置覆盖（隔离测试） | `MIMOCODE_HOME=<绝对路径>` 整体切换 profile 根（其下 `config/`、`data/`、`state/`、`cache/`）；或 `MIMOCODE_CONFIG` / `MIMOCODE_CONFIG_DIR` / `MIMOCODE_CONFIG_CONTENT` 直接指定配置源。**没有** `--config` 命令行参数 |
| 保留检查 | 根目录 `AGENTS.md` 未改动；用户级配置写入前已备份为 `mimocode.jsonc.bak-before-xjtlu`，原有 `provider` 与 `playwright-mcp:playwright` 条目原样保留 |

## 2. 无密钥配置示例

放入 `mimocode.jsonc` 的 `mcp` 对象（与其它条目并列；完整可合并示例见 [mcp.xjtlu.example.json](mcp.xjtlu.example.json)）：

```json
{
  "mcp": {
    "xjtlu": {
      "type": "remote",
      "url": "http://127.0.0.1:39527/mcp",
      "oauth": false,
      "enabled": true,
      "headers": {
        "Authorization": "Bearer {env:XJTLU_MCP_TOKEN}"
      }
    }
  }
}
```

要点：

- `type: "remote"` 连接 Streamable HTTP 端点，`url` 固定为本机 `http://127.0.0.1:39527/mcp`。
- **`oauth: false` 必须显式设置。** 服务端只认 Bearer 访问密钥，不是 OAuth；缺省时客户端会把 401 当作 OAuth 发现信号，走错误的认证流程。
- `{env:XJTLU_MCP_TOKEN}` 是 MiMo Code 的配置变量替换：值取自**启动 MiMo Desktop 的进程**环境。密钥由 XJTLU-MCP 工作台「Agent 连接」页复制，配置、命令行、聊天和日志只放占位符。
- 可选 `"timeout": 30000`（毫秒，拉取工具清单超时，缺省 5000）；本机服务一般用不到，学校查询慢时可加。

## 3. 添加、移除单个 xjtlu 条目

**一键安装（推荐，程序内已完成）：** XJTLU-MCP 工作台「Agent 连接」页的「Xiaomi MiMo Code」卡片点「在 MiMo Code 中安装」。应用会：

1. 把当前访问密钥写入用户环境变量 `XJTLU_MCP_TOKEN`（主进程经标准输入传递，不经渲染器、命令行或日志）。
2. 把 `mcp.xjtlu`（`{env:XJTLU_MCP_TOKEN}` 占位符形态）写入 `~/.config/mimocode/mimocode.json`；若任一 mimocode 配置文件已有 `xjtlu` 条目则不重复写。
3. 把 `xjtlu-campus` 扩展登记进 MiMo Desktop 插件注册表 `%APPDATA%\Xiaomi MiMo\extensions.json`（`kind: plugin`、`placements.mcpKeys: ["xjtlu"]`，写前备份 `extensions.json.bak-before-xjtlu`），使 XJTLU 出现在 MiMo「插件列表」并显示连接状态。
4. 卡片内显示配对、配置与插件列表三项状态；密钥重置后点「重新安装」即可再配对，配置不用改。

之后完全退出并重启 MiMo Desktop，在新会话调用 `xjtlu_get_connection_status` 验证。

**手动添加（配对）：**

1. 打开 XJTLU-MCP 工作台，进入「Agent 连接」，复制访问密钥（密钥由主进程写剪贴板，不经界面回显）。
2. 写入当前用户的环境变量（密钥只在此处出现一次）：

   ```powershell
   [Environment]::SetEnvironmentVariable('XJTLU_MCP_TOKEN', '<粘贴访问密钥>', 'User')
   ```

   或 `setx XJTLU_MCP_TOKEN <粘贴访问密钥>`。
3. 把示例片段合并进 `%USERPROFILE%\.config\mimocode\mimocode.jsonc`（或 `mimocode.json`）的 `mcp` 对象，不要删除其它条目；也可用「复制 MiMo Code 配置」按钮取得带密钥的整段配置。
4. 完全退出并重启 MiMo Desktop。
5. 在**新会话**里让 Agent 调用 `xjtlu_get_connection_status`，或查看 MCP 状态确认 16 项 `xjtlu_*` 工具。

**移除：**

1. 从 `mimocode.jsonc` 的 `mcp` 中删除 `xjtlu` 条目（临时停用可改为 `"enabled": false`）。
2. 彻底清理时再删除环境变量：`[Environment]::SetEnvironmentVariable('XJTLU_MCP_TOKEN', $null, 'User')`。
3. 重启 MiMo Desktop。

## 4. 配置变更生效时机

实测结论（2026-11-22，MiMo Desktop 26.1120.201429）：

- `mimocode.jsonc` 写入后，**正在运行的实例不会热加载 MCP 连接**：当轮会话内 `mcp_tool_search` 未出现 `xjtlu` 工具。退出并**重启 MiMo Desktop** 后生效。
- `XJTLU_MCP_TOKEN` 属于进程环境：Windows 修改用户环境变量不影响已运行进程，必须**在启动之前**设置好，由启动进程继承（`{env:...}` 解析取自该进程环境）。
- 建议配对完成后开**新会话**验证（工具面在会话建立时注入）。
- 有 CLI 的机器可用 `MIMOCODE_HOME=<临时绝对路径> mimo mcp list` 做隔离 profile 查看连接与鉴权状态；本机无 CLI，等效查看是会话内 `xjtlu_*` 工具或设置界面。

## 5. 密钥重置后的重新配对

1. 工作台「Agent 连接」页点「重置访问密钥」：旧连接立即失效，旧配置按 Bearer 认证错误拒绝（实测错误为 401 `MCP access key required`）。
2. 重新复制新密钥，更新 `XJTLU_MCP_TOKEN` 环境变量，重启 MiMo Desktop。
3. `mimocode.jsonc` 无需改动（占位符不变）。

## 6. 实测结果

### 三个状态

| 状态 | 结果 |
| --- | --- |
| 配置已保存 | ✅ 已写入 `%USERPROFILE%\.config\mimocode\mimocode.jsonc`（`mcp.xjtlu`，`type: remote`、`oauth: false`、`{env:XJTLU_MCP_TOKEN}`），原有 provider 与 playwright 条目保留 |
| MCP 已连通 | ✅ 重启 MiMo Desktop 后，会话内 `xjtlu` 服务已连接，16 项 `xjtlu_*` 工具注册；`xjtlu_get_connection_status` 会话内实际调用成功（2026-11-22） |
| 学校服务已登录 | 部分——AMS、eBridge 已连接（`needsLogin: false`）；图书馆、LMC 为 `idle`，`needsLogin: true`，需在桌面应用内连接。与 MCP 配对互相独立 |

### 协议层验证（verify-mcp.ts，2026-11-22）

用同一 MCP 实现（仓库 `src/mcp/server.ts`，随机本机端口）+ 虚构 64 位十六进制密钥 + 测试夹具数据，以官方 `@modelcontextprotocol/client` 2.4.0 按配置形态 `Authorization: Bearer {env:XJTLU_MCP_TOKEN}` 发起 Streamable HTTP 连接（脚本从启动进程环境解析占位符，验证环境变量继承语义）。结果全部通过，只记录脱敏状态与数量：

| 核对项 | 结果 |
| --- | --- |
| 环境变量缺失 | ✅ 占位符解析为空，按 Bearer 认证错误拒绝 |
| 继承正确密钥后工具发现 | ✅ 16 项，与服务端 `MCP_TOOL_NAMES` 逐名一致 |
| `get_connection_status` 真实调用 | ✅ 成功（`isError=false`，含 `data`） |
| 错误密钥 | ✅ 拒绝：401 `MCP access key required`（不进入 OAuth） |
| 换回正确密钥 | ✅ 恢复连接，仍为 16 项工具 |

16 项工具名（客户端发现顺序）：`get_connection_status`、`refresh_source`、`get_modules`、`get_timetable`、`get_exams`、`get_grades`、`get_attendance_summary`、`get_attendance_records`、`get_library_overview`、`get_library_seats`、`reserve_library_seat`、`get_library_reservations`、`get_lmc_notification`、`list_lmc_modules`、`get_module_contents`、`download_lmc_file`。在 MiMo Code 中按服务名前缀注册为 `xjtlu_get_connection_status` 等（对齐 `mijia-connector_mijia_*` 的命名规则）。

复现（在仓库根目录）：

```powershell
$env:XJTLU_MCP_TOKEN = '<64 位十六进制虚构密钥>'
node --experimental-strip-types docs/agent-clients/mimo-code/verify-mcp.ts
```

### 客户端内验证（2026-11-22，重启 MiMo Desktop 后）

- 会话内 `mcp_tool_search` 可见全部 16 项 `xjtlu_*` 工具（服务名前缀注册，命名规则与 `mijia-connector_mijia_*` 一致）。
- `xjtlu_get_connection_status` 会话内实际调用成功：`ok: true`、`complete: true`、`stale: false`，返回 AMS / eBridge 已连接、图书馆与 LMC 待登录（附更新时间戳，无账号、密钥或学校链接）。
- 配对生效路径实测：「在 MiMo Code 中安装」写入用户环境变量 → 完全重启 MiMo Desktop → 引擎进程继承 `XJTLU_MCP_TOKEN` → `Bearer {env:...}` 解析通过 → 服务连接、工具注册。错误密钥阶段表现为服务 `unavailable (401)`、工具不注册，与第 6 节协议层结论一致。

### 客户端未验证部分（及阻碍）

- **独立 `mimo` CLI 未验证**：本机无此可执行文件（阻碍见第 1 节）；按用户要求不安装。`mimo mcp list` 的结果以文档命令形态记录，待装有 CLI 的机器补充。
- 区分口径：**配置已保存 ✅ / MCP 已连通 ✅ / 客户端内工具调用 ✅ / 学校服务登录按需进行**。

## 7. 「Agent 连接」页入口（已实现）

程序内已实现「Xiaomi MiMo Code」卡片（位于 XJTLU 校园助手 Codex 卡片之后），含：

- 状态行：访问密钥（已配对 / 尚未配对 / 密钥已变更，请重新配对…）与客户端配置（已写入 mimocode 配置 / 尚未写入配置）。
- 按钮：**「在 MiMo Code 中安装」**（一键完成配对 + 写配置，密钥重置后变「重新安装」）、「刷新安装状态」。
- 主卡片动作行新增**「复制 MiMo Code 配置」**（`mcp.xjtlu` 整段 JSON，含访问密钥，由主进程写剪贴板）。

建议文案（已采用）：

> 一键安装会把访问密钥写入用户环境变量 XJTLU_MCP_TOKEN，并把 mcp.xjtlu 写入 mimocode 配置。完全退出并重启 MiMo Desktop 后生效，新会话调用 xjtlu_get_connection_status 验证。密钥重置后再点一次即可重新配对。

按汇总约定，五个客户端入口最终按 DeepSeek Harness、腾讯 WorkBuddy、豆包、Xiaomi MiMo Code、Kimi Code 排列；本卡先落在 Codex 卡片之后，汇总时调整顺序并补其余四个入口，保留 Codex 插件与通用配置入口。

**关于 MiMo「插件列表」：** 列表展示的是扩展（connector 插件）——`extensions.json` 注册表与平台内置目录（Figma MCP、北大法宝、playwright-mcp 等）；MCP 服务配置不进该列表。官方插件安装只接受内置目录或带签名的货架清单（清单签名、包指纹、防降级），第三方未签名插件无法通过官方入口安装。因此一键安装采用**本机登记**：把 `xjtlu-campus` 条目写入 `extensions.json`（与 mijia/playwright 同一注册表同一 schema），效果为列表出现条目、按 `mcpKeys` 显示连接状态、可停用/卸载（卸载会撤销登记；配置条目由 mimocode 配置管理）。显示名称以客户端实际渲染为准（名称解析走内置目录，未收录的条目可能显示 ID）。

## 8. 交付文件

| 文件 | 说明 |
| --- | --- |
| `README.md` | 本文 |
| `mcp.xjtlu.example.json` | 无密钥、可直接合并的配置示例 |
| `verify-mcp.ts` | 虚构数据验证脚本（用法见文件头注释） |

## 9. 共享文件改动（MiMo 入口已实现，其余留待汇总）

已在本任务实现（构建与 16 项定向测试通过）：

- `src/shared/mcp.ts`：`McpConfigFormat` 增加 `mimocode`；新增 `MimoInstallStatus`；`McpBridge` 增加 `getMimoStatus` / `installMimo`。
- `src/main/mimo-code.ts`（新增）：`saveMimoInstall` / `inspectMimoInstall`——密钥经标准输入写入用户环境变量 `XJTLU_MCP_TOKEN`；`mcp.xjtlu` 写入 `~/.config/mimocode/mimocode.json`（已有条目则不重复写）；`xjtlu-campus` 登记进 `%APPDATA%\Xiaomi MiMo\extensions.json`（写前备份、原子替换、幂等 upsert）。
- `src/main/mcp-service.ts`：`pairMimo` / `inspectMimo`；`copyConfig('mimocode')` 输出 `mcp.xjtlu` JSON。
- `src/preload/index.ts`、`src/main/index.ts`：对应 IPC（`mcp:get-mimo-status`、`mcp:install-mimo`，`mcp:copy-config` 接受 `mimocode`）。
- `src/renderer/src/McpPage.tsx`：「Xiaomi MiMo Code」卡片与「复制 MiMo Code 配置」按钮。

留待汇总：其余四个客户端入口按固定顺序插入；统一各入口的复制格式与状态口径；如有官方安装入口再接安装动作。
