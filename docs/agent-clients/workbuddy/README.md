# 腾讯 WorkBuddy 接入说明

以 XJTLU-MCP V2.0 的 16 项 MCP 工具为目标，记录腾讯 WorkBuddy 桌面端在 Windows 上的接入方式、本机配对状态和「Agent 连接」页实现。工作台内已提供**「在 WorkBuddy 中安装」**一键按钮：由主进程把 `mcpServers.xjtlu` 写进客户端的 `mcp.json`，用户只需在 WorkBuddy 里点一次「信任」。协议层核对只用只读请求与脱敏状态，未连接学校业务工具、未提交预约、未下载文件。日期：2026-11-22。

## 1. 客户端核对

| 项目 | 核对结果 |
| --- | --- |
| 实际客户端 | **腾讯 WorkBuddy 5.11.3**（`D:\WorkBuddy\WorkBuddy.exe`，卸载项「WorkBuddy 5.11.3」版本一致，`last-launch.json` 记录 build `ecace0f7028166695994300182295329b8b95449`），界面语言 zh-CN |
| 入口 | 客户端侧：左侧栏 **连接器**（深链接 `workbuddy://connectors`）→ 右上角 **自定义连接器**。工作台侧：**「Agent 连接」→「在 WorkBuddy 中安装」**，一键把配置写入本机 `mcp.json`（本次已实现，见第 3 节） |
| 本机 MCP 配置 | `%USERPROFILE%\.workbuddy\mcp.json`（应用内 `getMcpConfigPath()` 指向该文件，顶层用 `mcpServers` 承载全部服务）。本机接入前**没有**该文件，本次新建 |
| 传输与地址 | `type: "streamableHttp"` + `http://127.0.0.1:39527/mcp`。回环 HTTP 走本机 `mcp.json`（程序内对插件包路径的校验会提示 `use standard mcp.json for HTTPS or loopback HTTP`），官方连接器文档要求的「生产环境必须 HTTPS」针对市场连接器，不适用于本机回环 |
| 首次连接的信任确认 | **需要**。本版本提示文案为「首次连接此 MCP 服务需要您的信任确认。」，按钮为「信任」与「拒绝」（`mcp.approvalRequired` / `mcp.approve` / `mcp.reject`），第三方服务另标「第三方服务，WorkBuddy 未审核」。本机已在客户端点过一次，记录见第 4 节；一键安装只负责写配置，不代为确认 |
| 工具命名 | `mcp__xjtlu__<工具名>`，例如 `mcp__xjtlu__get_connection_status`。自定义 MCP 服务在内部编号为 `custom-mcp:xjtlu`，工具前缀取 `mcp.json` 中的服务键 `xjtlu` |
| 查看工具数 | 会话内工具搜索（服务名前缀 `mcp__xjtlu__`）或工具面板；连接器卡片显示连接状态。列表只显示状态时，以会话内工具搜索的 16 条 `mcp__xjtlu__*` 为工具数依据。本机另有 `%USERPROFILE%\.workbuddy\mcp-tool-list.json` 缓存，仅供核对，不作为界面依据 |
| 其他开关 | 「设置 → 安全中心 → 工具管控 → 自定义 MCP」统一控制用户自行添加的 MCP Server；组织策略也可能禁用「自定义连接器」（禁用时提示「管理员已禁用添加自定义连接器」）。本机未出现禁用迹象 |
| 保留检查 | 接入前 `mcp.json` 不存在、`connector-states.json` 的 `connectors` 为空，本机没有需要保留的其他自定义 MCP 连接器；`settings.json` 的 `enabledPlugins` 未改动 |

## 2. 无密钥配置示例

写入 `%USERPROFILE%\.workbuddy\mcp.json` 的 `mcpServers`（完整可粘贴片段见 [mcp.xjtlu.example.json](mcp.xjtlu.example.json)）：

```json
{
  "mcpServers": {
    "xjtlu": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:39527/mcp",
      "headers": {
        "Authorization": "Bearer <从「Agent 连接」页复制的访问密钥>"
      },
      "timeout": 30000
    }
  }
}
```

要点：

- **`type` 必须是 `streamableHttp`**（本版本支持的三种传输为 `sse` / `streamableHttp` / `stdio`）。校园服务只提供 Streamable HTTP，另有 `type: "http"` 写法的是其他客户端（如 XJTLU-MCP 复制的通用配置），不能直接照抄到本客户端。
- `url` 固定为工作台本机端点，不要改成 `localhost` 之外的地址；服务端只监听 `127.0.0.1:39527`，并校验 `Host` 必须是 `127.0.0.1:39527` / `localhost:39527`。
- `headers` 中的 `Authorization` **按原样发送**，因此整段 `Bearer <访问密钥>` 要写全（与界面表单自填凭证不同，见第 5 节）。
- `timeout` 可选，默认 30000 毫秒；本机服务一般用不到，学校查询偏慢时可加大。
- 服务端只认这一把独立 MCP 访问密钥，不是 OAuth；不要配置任何 OAuth / 交互式授权字段。
- 同一文件如需多个服务，`mcpServers` 下并列写入即可，互不影响；移除时只删 `xjtlu` 这一段。

请求来源：WorkBuddy 桌面端与校园工作台在同一台 Windows 机器上，配置地址是回环地址，服务端只监听 `127.0.0.1`，非本机进程无法建立连接。因此 MCP 请求确实从工作台所在的本机发出，不经过客户端云端中转。

## 3. 添加与移除单个 `xjtlu` 条目

### 一键安装（推荐，已实现）

工作台「Agent 连接」页的「腾讯 WorkBuddy」卡片点 **「在 WorkBuddy 中安装」**。主进程会：

1. 读取 `%USERPROFILE%\.workbuddy\mcp.json`（不存在则新建，父目录一并创建）；
2. 只替换 `mcpServers.xjtlu`，写 `type: streamableHttp`、`url`、`headers.Authorization = Bearer <当前访问密钥>`、`timeout: 30000`，同文件里的其他连接器与其他顶层字段原样保留；
3. 首次写入该服务时先留一份 `mcp.json.bak-before-xjtlu`；写入用临时文件 + 重命名，避免半截文件；
4. 文件无法解析时**不覆盖**，直接报「mcp.json 无法解析，请先手动修正」；
5. 写完后刷新卡片状态：客户端配置 / 访问密钥 / 连接信任。密钥变化后再点一次按钮（此时显示「重新写入配置」）即完成配对更新。

密钥全程只在主进程内使用，不进渲染器、不进命令行、不进剪贴板、不写日志。

之后仍需在 WorkBuddy 侧点一次 **信任**（客户端的安全确认，见第 4 节），再开新会话验证 16 项工具。

### 手动方式（等效）

1. 工作台「Agent 连接」页确认服务就绪，页面显示地址 `http://127.0.0.1:39527/mcp`。
2. 复制访问密钥（密钥由主进程写剪贴板，界面不回显）。
3. 把第 2 节结构写入 `%USERPROFILE%\.workbuddy\mcp.json`（已存在时只新增 `mcpServers.xjtlu`，保留其他条目）。
4. 打开 **连接器**（`workbuddy://connectors`）→ 右上角 **自定义连接器**，在列表中找到 `xjtlu`，点 **信任**。
5. 在**新会话**里让 Agent 搜索 `mcp__xjtlu__` 工具，或调用 `mcp__xjtlu__get_connection_status` 复核。

**界面方式（同样等效）：** 连接器 → 右上角「自定义连接器」→ 名称 `xjtlu`、传输 `streamableHttp`、URL `http://127.0.0.1:39527/mcp`、请求头 `Authorization` 填 `Bearer <访问密钥>` → 保存 → 点「信任」。三条路径最终都落到同一份 `mcp.json`。

**移除：**

1. 从 `mcp.json` 的 `mcpServers` 中删除 `xjtlu` 这一段（临时停用也可在连接器卡片上关闭开关，或把该段改名后保留作备份）。
2. 若同时清过访问密钥，`%USERPROFILE%\.workbuddy\mcp.json` 可整文件删除；本机无其他自定义服务时删文件即等效。
3. 重启 WorkBuddy 会话后确认 `mcp__xjtlu__*` 工具不再出现。
4. 卡片上的「重新写入配置」可随时把条目修复回来，不需要重新找密钥。

## 4. 生效时机与重连

- `mcp.json` 写入后**不会自动完成连接**：首次连接必须点「信任」。这一条是本版本的行为，不是配置错误，一键安装也只负责写配置。
- 信任记录写在 `%USERPROFILE%\.workbuddy\mcp-approvals.json`，键为 `sha256(服务地址 origin)::服务名`（本机为 `1174fcdc…::xjtlu`，origin 即 `http://127.0.0.1:39527`）。因此：**重置访问密钥后不用重新点信任**（地址没变）；换端口或换主机才需要重新信任。卡片上的「连接信任」一行就是读这条记录得到的（只读判断，不代为写入）。
- 信任之后工具面在新会话注入；当前会话（本任务所在会话）不会出现 `mcp__xjtlu__*`，需在**新会话**验收工具发现。
- 若连接器页没有出现 `xjtlu`：完全退出 WorkBuddy（托盘/任务管理器确认进程结束）后重启，再进连接器页；仍不出现时依次核对文件名是否 `mcp.json`、顶层键是否 `mcpServers`、`type` 拼写、URL 是否为回环地址。
- 工作台必须保持运行。Windows 上点工作台窗口 × 只是收起到托盘，MCP 继续工作；托盘菜单「退出 XJTLU-MCP」会一并停止 MCP，此时客户端侧表现为连接中断（`fetch failed` / 连接重置），不是密钥问题。
- 端口 39527 被其他程序占用时，工作台「Agent 连接」页会显示错误，客户端侧同样连不上。

## 5. 密钥填写入口与安全

- 一键安装路径（本机采用）：密钥由主进程直接从密钥库取出写入 `mcp.json`，只出现在该文件里，其余位置（渲染器、剪贴板、命令行、日志、文档）均无明文。文件本身位于用户配置目录，仅当前用户可读。
- 文件配置路径（手动）：密钥以明文写入 `%USERPROFILE%\.workbuddy\mcp.json`，属于客户端本机配对载体。仓库、文档、命令参数、聊天、截图和日志只用占位符。
- 界面表单路径：连接器「自定义连接器」表单自填凭证，值由客户端注入请求头。本机 `connector-states.json` 记录 `headerOverridesBearerStripped: true`，说明表单里填入的值会剥离开头的 `Bearer ` 前缀后再按 `Bearer <值>` 注入——**表单里只填密钥本身**，不要再带 `Bearer`；这一点与第 2 节的配置文件写法正好相反，混用会得到 `Bearer Bearer <密钥>` 而被 401 拒绝。
- 密钥重置后：工作台点「重置访问密钥」→ 旧密钥立即失效（实测返回 401 `MCP access key required`）→ 回到「Agent 连接」页点一次「重新写入配置」即完成更新（或手动改 `headers.Authorization`）→ 重开新会话。条目与信任都保留，不用重新点「信任」。
- 学校账号、Cookie、学校令牌不参与 MCP 认证，也不需要交给 WorkBuddy。

## 6. 实测结果

三个状态分开记录：

| 状态 | 结果 |
| --- | --- |
| 配置已保存 | ✅ `%USERPROFILE%\.workbuddy\mcp.json` 已写入 `mcpServers.xjtlu`（`type: streamableHttp`、本机 URL、`headers.Authorization`）。本次由「在 WorkBuddy 中安装」使用的同一代码路径写入，条目字段与卡片显示的「已写入 / 已配对」一致 |
| 连接信任 | ✅ 已在客户端点过「信任」，`mcp-approvals.json` 存在 `1174fcdc…::xjtlu`；卡片「连接信任」显示「客户端已信任该地址」 |
| MCP 已连通 | 协议层 ✅（见下）；客户端内 16 项 `mcp__xjtlu__*` 工具发现与调用待新会话统一验收 |
| 学校服务已登录 | 部分，且与 MCP 配对无关。`get_connection_status` 中 AMS 为 `connected`；eBridge、LMC、图书馆为 `idle` / `needsLogin: true`（工作台重启后未连接），需在工作台内连接对应服务 |

### 一键写入验证（2026-11-22）

隔离验证：把 `WORKBUDDY_CONFIG_DIR` 指向临时目录，用真实代码路径反复安装，16/16 通过——空目录新建、条目字段正确、重复安装幂等、保留其他服务与其他顶层键、首次写入留备份、换密钥后重新写入恢复 `paired`、旧密钥视角为 `outdated`、信任记录识别（同 origin 为 `approved`，其他来源为 `pending`）、坏 JSON 拒绝覆盖并报 `invalid`、目录不存在时自动创建、非法密钥被拒绝。

同一份回归检查已固化为仓库测试 `tests/workbuddy.test.ts`（`node --experimental-strip-types --test tests/workbuddy.test.ts` 通过）；`tests/mcp.test.ts` 16 项仍全部通过，生产构建（含类型检查）通过。

真实配置验证：对本机 `mcp.json` 执行同一写入后，`mcpServers` 仅 `xjtlu` 一条、字段为 `type,url,headers,timeout`、`Authorization` 与当前密钥一致，写入前副本为 `mcp.json.bak-before-button`；重启工作台后协议层探针 6/6 通过，密钥未变。

### 协议层核对（[probe-mcp.mjs](probe-mcp.mjs)，2026-11-22）

对正在运行的本机服务 `http://127.0.0.1:39527/mcp` 做只读请求，密钥取自进程环境变量、只输出长度与摘要前缀（`b1516ec4`），结果 6/6 通过：

| 核对项 | 结果 |
| --- | --- |
| `initialize` | ✅ HTTP 200，`serverInfo = xjtlu-campus 2.0.0` |
| `tools/list` | ✅ 16 项，与服务端 `MCP_TOOL_NAMES` 逐名一致 |
| `get_connection_status` | ✅ HTTP 200，`isError=false`，`ok=true`、`complete=true`、`stale=false`（只读状态，无账号、密钥或学校链接） |
| 错误密钥 | ✅ 拒绝：401 `MCP access key required` |
| 无密钥 | ✅ 拒绝：401 `MCP access key required` |
| 换回正确密钥 | ✅ 恢复连接，仍为 200 |

16 项工具：`get_connection_status`、`refresh_source`、`get_modules`、`get_timetable`、`get_exams`、`get_grades`、`get_attendance_summary`、`get_attendance_records`、`get_library_overview`、`get_library_seats`、`reserve_library_seat`、`get_library_reservations`、`get_lmc_notification`、`list_lmc_modules`、`get_module_contents`、`download_lmc_file`。在 WorkBuddy 中按服务键加前缀注册为 `mcp__xjtlu__<工具名>`。

复现（在仓库根目录）：

```powershell
$env:XJTLU_MCP_TOKEN = '<从「Agent 连接」页复制的访问密钥>'
node docs/agent-clients/workbuddy/probe-mcp.mjs
```

### 客户端内未验证部分及阻碍

- **未在客户端内完成工具发现与 `get_connection_status` 调用**：工具面在会话建立时注入，本任务所在会话在配置写入前就已开始，因此看不到 `mcp__xjtlu__*`。信任已确认，但客户端内验收仍需在**新会话**做；协议层核对不能替代客户端内验收。
- **未目视核对连接器页渲染**：本轮没有对 WorkBuddy 界面做截图或点击操作，卡片文案（信任提示、第三方标注）取自本机程序内的中文字符串，实际以用户看到的界面为准。
- **未验证信任后是否需要重启**：按本版本设计信任后即连接；如连接器卡片显示已连接但新会话仍无工具，完整退出并重启 WorkBuddy 后复查。

## 7. 「Agent 连接」页入口（已实现）

「腾讯 WorkBuddy」卡片当前位于 Codex 插件卡片之后、豆包之前，汇总时按固定顺序（DeepSeek Harness、**腾讯 WorkBuddy**、豆包、Xiaomi MiMo Code、Kimi Code）确认位置即可。

卡片内容：

- 状态行三项：**客户端配置**（已写入 / 尚未写入 / 配置文件无法解析 / 无法确认）、**访问密钥**（已配对 / 尚未配对 / 密钥已变更，请重新写入）、**连接信任**（客户端已信任该地址 / 待客户端点「信任」）。
- 按钮：**「在 WorkBuddy 中安装」**（已写入且已配对时显示「重新写入配置」）、「刷新安装状态」。
- 主卡片动作行新增 **「复制 WorkBuddy 配置」**（`mcpServers.xjtlu` 整段 JSON，含访问密钥，由主进程写剪贴板）。
- 卡片说明文案（已采用）：

  > 点一下即把 `mcpServers.xjtlu` 写入 WorkBuddy 的 `%USERPROFILE%\.workbuddy\mcp.json`（streamableHttp、本机地址、Authorization 头），同一文件里的其他连接器保持不变，首次写入前留备份。首次连接仍需在 WorkBuddy「连接器」页对 xjtlu 点一次「信任」；信任按服务地址记录，重置访问密钥后不用再点。之后在新会话调用 `mcp__xjtlu__get_connection_status` 验证。

- 未做「打开连接器页」按钮：`workbuddy://connectors` 可用，但只打开页面、不能替代写配置，本轮不加；如需可后续补一个 `shell.openExternal` 白名单入口。

## 8. 共享代码改动（本次已实现）

按用户要求把一键安装做进工作台，因此改动超出交付目录，均为增量、未改动既有行为：

| 文件 | 改动 |
| --- | --- |
| `src/main/workbuddy.ts`（新增） | `inspectWorkbuddyInstall` / `saveWorkbuddyInstall`：读写 `mcp.json`（`WORKBUDDY_CONFIG_DIR` / `CODEBUDDY_CONFIG_DIR` 可覆盖，便于隔离验证）、合并 `mcpServers.xjtlu`、首次写入留备份、临时文件 + 重命名原子写、坏 JSON 拒绝覆盖、按 `sha256(origin)::xjtlu` 只读判断信任状态 |
| `src/shared/mcp.ts` | `McpConfigFormat` 增加 `'workbuddy'`；新增 `WorkbuddyConfigStatus` / `WorkbuddyTrustStatus` / `WorkbuddyInstallStatus`；`McpBridge` 增加 `getWorkbuddyStatus` / `installWorkbuddy` |
| `src/main/mcp-service.ts` | 新增 `pairWorkbuddy` / `inspectWorkbuddy`（与 MiMo 一致：未开启连接时拒绝写入）；`copyConfig('workbuddy')` |
| `src/main/index.ts` | IPC `mcp:get-workbuddy-status`、`mcp:install-workbuddy`；`mcp:copy-config` 格式放行 `workbuddy` |
| `src/preload/index.ts` | 桥接 `getWorkbuddyStatus` / `installWorkbuddy` |
| `src/renderer/src/McpPage.tsx` | 「腾讯 WorkBuddy」卡片、「复制 WorkBuddy 配置」按钮 |
| `tests/workbuddy.test.ts`（新增） | 一键写入的定向回归：合并保留、备份、密钥变更、信任判定、坏文件不覆盖、非法密钥拒绝 |

汇总方仍需处理：确认五个客户端卡片的最终顺序与文案口径、打包与发布说明；本次未改版本号、未打包、未提交。

## 9. 待办与阻碍

| 项 | 说明 |
| --- | --- |
| 客户端内 16 项工具 + `get_connection_status` | 待新会话统一验收；本轮协议层 6/6 通过，客户端内未调用 |
| 连接器页渲染 | 卡片文案依据取自本机程序内的中文字符串，未截图核对；信任已由用户实际点过一次（`mcp-approvals.json` 有记录） |
| 学校服务登录 | 与 MCP 配对独立，按需在工作台内连接 |
| 版本与打包 | 未升版本号、未重打 ZIP、未提交；由汇总方统一处理 |

## 10. 交付文件

| 文件 | 说明 |
| --- | --- |
| `README.md` | 本文 |
| `mcp.xjtlu.example.json` | 无密钥、可直接合并的 `mcp.json` 片段 |
| `probe-mcp.mjs` | 本机只读探针：初始化、16 项工具发现、`get_connection_status`、错误/缺失密钥负例，输出脱敏 |

工作台内的实现见第 8 节（`src/main/workbuddy.ts` 等），回归检查为 `tests/workbuddy.test.ts`。
