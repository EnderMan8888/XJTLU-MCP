# Agent 的 MCP 连接

MCP 服务随 XJTLU-MCP V2.0 提供。程序运行时，本机 Agent 可以从桌面应用查询和使用校园工具。

## 开始使用

打开 XJTLU-MCP 的「Agent 连接」，点「在 ChatGPT 中安装」，再到 ChatGPT 桌面端的插件页确认安装。配对会自动完成。详见 [XJTLU 校园助手插件](../codex-plugin/README.md)。以下步骤适用于手动连接 Codex 或其他支持 Streamable HTTP 的本机 Agent。

1. 打开 XJTLU-MCP V2.0，在应用中连接所需的学校服务。
2. 进入侧栏「Agent 连接」。服务就绪后，地址为 `http://127.0.0.1:39527/mcp`。
3. 点击「复制 Codex 配置」或「复制通用配置」，添加到支持 Streamable HTTP 和自定义 Authorization 请求头的本机客户端。学校密码、Cookie 和学校 Token 不用于 MCP 认证。
4. 保持桌面应用运行，由 Agent 先调用 `get_connection_status`，再查询所需数据。

复制的配置包含单独的 MCP 访问密钥，不要提交到 Git、发到聊天中或与他人共享。界面只显示服务地址，密钥由主进程写入剪贴板，不通过查询 IPC 返回页面。若客户端分别填写地址和 Bearer token，可使用「复制访问密钥」。

Codex 使用的配置结构如下；示例密钥是占位符，实际配置由应用复制：

```toml
[mcp_servers.xjtlu]
url = "http://127.0.0.1:39527/mcp"
http_headers = { Authorization = "Bearer <从应用复制的访问密钥>" }
```

按客户端的配置入口添加即可；Codex 的设置依据见[官方 MCP 说明](https://learn.chatgpt.com/docs/extend/mcp)。通用 JSON 复制结果采用 `mcpServers.xjtlu`，包含 `type: "http"`、`url` 和 `headers.Authorization`；其他客户端可能使用不同的配置外层结构。

关闭桌面应用会停止服务。「关闭本次连接」只关闭当前运行中的 MCP；下次启动默认重新开启。「重置访问密钥」会断开现有连接并重新开启服务，旧配置立即失效，需要重新复制。

如果端口 39527 被其他程序占用，Agent 连接页会显示错误；应用中的学校功能仍可使用。本版不自动安装 Electron，不自动改写客户端配置，不提供公网连接或 stdio 桥接。

## 工具列表

`date` 支持有效的 `YYYY-MM-DD` 或 `today`、`yesterday`、`tomorrow`，统一按北京时间解释。

| 工具 | 输入 | 返回内容 |
| --- | --- | --- |
| `get_connection_status` | `{}` | AMS、eBridge、图书馆及 LMC 的 phase、connected、needsLogin、needsVerification、操作提示及相关更新时间 |
| `refresh_source` | `source` 为 `ams`、`ebridge`、`library`、`lmc` | 刷新已连接的指定来源并返回各项更新时间。图书馆更新公开楼层数据 |
| `get_modules` | `refresh?` | eBridge 当前学年的课程代码、名称、学期、学分和状态 |
| `get_timetable` | `date?`、`refresh?` | 默认今天；指定日期的课程代码、名称、时间、教室、教学组、课程类型及教学周 |
| `get_exams` | `date?`、`refresh?` | 默认全部已读取考试；考试日期、原始日期、星期、入场时间、开考时间、时长、考场、座位、区域、入口 |
| `get_grades` | `scope?` 为 `current`（默认）或 `all`，`refresh?` | 学校完整成绩记录和分项成绩，含总评、等级、分项权重和分数。学校未公布的分数为 null |
| `get_attendance_summary` | `refresh?` | AMS 当前所选学期各门课及总体签到率、课时统计；百分比单位为 percent，null 表示暂无统计 |
| `get_attendance_records` | `date?`、`refresh?` | 默认今天，只支持今天、昨天、明天；单节课程、教室、教学组、出勤状态及签到时间 |
| `get_library_overview` | `refresh?` | 各校区和楼层的 `floorId`、剩余座位数和总数，无需登录 |
| `get_library_seats` | `floorId`、`date?`、`start?`、`end?` | 当前登录账号可查询的楼层座位、`seatId`、座位号、可预约状态和开放时段 |
| `reserve_library_seat` | `floorId`、`seatId` 或 `seatNumber`、`date?`、`start?`、`end?`、`title?`、`memo?`；或仅传 `requestId` | 发起需用户确认的预约，或查询现有请求的状态和学校确认结果 |
| `get_library_reservations` | `date?` | 当前账号在该日期的预约，默认今天 |
| `get_lmc_notification` | `from?`、`to?`（年月日），`includeSignIn?` | 日期范围内的通知、正文、时间和已读状态 |
| `list_lmc_modules` | `refresh?` | 当前可见课程的 `courseId`、课程名和简称，保持 Core 最近访问顺序 |
| `get_module_contents` | `courseId`、`folderId?`、`refresh?` | 课程目录的章节和活动类型；指定文件夹时返回文件名、相对路径和 `fileId` |
| `download_lmc_file` | `courseId` 和 `fileId`，或 `courseId`、`fileName`、`folderId?`、`path?`；或仅传 `downloadId` | 请求保存 LMC 原文件，或查询下载进度和结果 |

调用示例：

```json
{"name":"get_timetable","arguments":{"date":"2026-11-17"}}
{"name":"get_exams","arguments":{}}
{"name":"get_attendance_records","arguments":{"date":"yesterday"}}
```

默认使用应用已有结果。单节考勤没有对应缓存时，会复用已连接的 AMS 按日期读取，并合并同时发起的相同查询。`refresh: true` 刷新相关的已连接来源；不为当前未连接的服务发起连接。已连接来源刷新时仍沿用应用原有的会话失效和验证处理，验证码和二次验证仍由用户在官方窗口完成。

签到率沿用应用当前所选 AMS 学期，不会修改界面中的学期选择。课表依据 eBridge 课表所属学期和明确配置的校历，不能据此查询未配置学年的课表。

成绩在第一次调用或显式刷新时按需读取。当前学期优先按已配置的校历确定，其他时候使用 eBridge 课表返回的学期。当前学期的分项成绩按校方学年、成绩记录和课程注册信息匹配。无法匹配学期的分项可在 `scope: "all"` 查看。

### 图书馆预约

1. 调用 `get_library_overview` 获取 `floorId`，再调用 `get_library_seats` 选择座位和时段。时间用 `HH:mm`，开始和结束一起提供。两者都省略时默认今天现在至 22:00。
2. 调用 `reserve_library_seat`，使用同一楼层、时段和座位。桌面应用显示五分钟内有效的确认请求。
3. 用户在图书馆页核对学校须知、验证码和时段后提交。Agent 用 `requestId` 查看状态。仅当 `booked` 为 true 时可报告学校已确认。若学校要求在官方窗口完成滑块验证，用户继续在官方窗口操作，随后可查询预约记录核对。

### LMC 通知和资料

在应用内连接 LMC 后即可查询。通知默认读取最近四个自然月，指定日期时包含首尾两天，回溯上限同为四个自然月。登录提醒默认隐藏，可用 `includeSignIn: true` 包含。读取达到分页或时间限制时，结果会标记不完整。

下载前先调用 `list_lmc_modules` 和 `get_module_contents` 定位课程及文件。按名称定位时，文件夹内的 `path` 是文件相对路径，目录中的独立资源则用所在章节。桌面选择保存位置后，用 `downloadId` 查询进度，完成时 `downloaded` 为 true。文件内容、学校下载链接及本机保存路径均保留在桌面端。

## 结果语义

每个工具同时提供 JSON 文本与 `structuredContent`，包含：

- `ok`、`code`：是否可用，以及不可用原因；无法读取时设置 MCP `isError`，不能当作没有课程或考试。
- `source`、`timezone`、`fetchedAt`：来源、时区和来源最近成功读取时间。
- `stale`：缓存超过五分钟、来源未连接、读取失败或尚未读取时为 true。
- `complete`、`message`：数据是否完整，以及需要核对的情况。刷新失败会保留可用的旧结果，并标记 stale / incomplete。
- `data`：对应查询内容。未读取考试表与已读取的空考试表有不同结果。

`needsLogin` 在已连接时为 false；未连接、凭据缺失、认证过期或需要人工验证时为 true。网络错误及认证进行中无法确定时为 null，不能把普通读取错误直接说成密码错误。

单节考勤来自 AMS Module Detail，按 eBridge 的日期、课程、课堂时间、教学组唯一匹配，兼容十分钟课间差异。`unmatched` 和 `unavailable` 均不代表缺勤。只在学校明确标记 present 时展示签到时间。合法无课日期可返回空记录；无法确认课表所属校历时返回错误。

## 本机边界

- 使用官方 TypeScript SDK v2 的 HTTP 入口，为每次请求创建独立服务实例，兼容 2026-07-28 及 2025 年的协议请求。
- 仅监听 `127.0.0.1`；检查 Host 和 Origin；每次请求都需要独立随机访问密钥。
- 密钥由 Electron safeStorage 加密保存至现有用户资料目录的 `mcp-access.bin`，与学校账号分开。加密不可用或文件损坏时不开放匿名访问。
- 限制请求大小、接收超时和并发数量。学校请求限定在各服务已有入口。预约提交使用桌面确认流程，下载使用受限的学校文件入口和系统保存对话框。
- 更换学校账号时，丢弃在途查询和旧缓存的 MCP 读取结果，等待读取新账号数据。

传输实现参考[官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)及其[HTTP 协议兼容说明](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)。

## 验证范围

定向验证使用虚构数据和本机端口，覆盖 16 项工具的发现与调用、预约确认前后状态、LMC 下载状态、通知范围与登录提醒过滤、认证、旧协议兼容及账号切换隔离。本轮没有重新登录学校或进行真实预约和下载。
