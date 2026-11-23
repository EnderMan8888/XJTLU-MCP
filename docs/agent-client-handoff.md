# XJTLU-MCP 多客户端接入交接

以 XJTLU-MCP V2.0 为基线，为 Windows 上的 DeepSeek Harness、Xiaomi MiMo Code、腾讯 WorkBuddy 和 Kimi Code 安装校园 MCP 连接。各 Agent 先在自己的客户端完成安装和配对，豆包单独配对。各连接就绪后，由一个 Agent 汇总到桌面应用的「Agent 连接」页，并统一验收。

在四个客户端分别打开 `XJTLU-MCP` 项目的根目录，发送文末对应的一句话。可以同时分发。各客户端在自己的 `docs/agent-clients/<客户端>/` 目录提交接入说明和需要的模板，共享页面与代码留到汇总时一起改。

## 共同约定

- 先读根目录的 [AGENTS.md](../AGENTS.md) 和 [DEVELOPMENT-HANDOFF.md](../DEVELOPMENT-HANDOFF.md)，再看 [MCP 使用说明](mcp.md) 和 [现有 Agent 连接页](../src/renderer/src/McpPage.tsx)。开发、文档和构建均在外层工程进行。`sources/` 是只读的发布存档，`文档/` 是只读的参考资料。旧通知工具和 `.scratch/` 中的本机诊断资料留在本地。
- 复用 `http://127.0.0.1:39527/mcp` 和现有 16 项工具。传输为 Streamable HTTP，请求头为 `Authorization: Bearer <MCP 访问密钥>`。MCP 客户端进程和校园工作台都运行在同一台 Windows 机器，工作台须保持开启。保留本机监听、Host/Origin 校验和访问密钥验证。[服务实现](../src/mcp/server.ts)
- 真实 MCP 访问密钥由用户在工作台「Agent 连接」页复制，再直接填入受信任客户端的本机配对入口。优先使用客户端支持的凭据存储或环境变量引用。源码、配置样例、命令参数、聊天、截图和日志只用占位符或一次性虚构密钥。学校账号、Cookie、学校令牌和签名链接留在工作台。
- 工具结果会由所选客户端处理。使用云端模型时，客户端可能把调用结果送给模型。开发验证使用虚构数据，复用 [现有 MCP 测试](../tests/mcp.test.ts) 的数据和随机本机端口思路，保留桌面预约确认和下载保存对话框。测试时省略真实学校登录、数据查询、预约和文件下载。
- 复用当前已安装的客户端。客户端缺失时按官方方式安装，再在本机正常使用的配置中添加并启用自己的 `xjtlu` 条目。保留同一客户端中的其他设置和连接器，所有客户端沿用工作台当前访问密钥。
- 任务内的仓库改动限于各自的交付目录。把共享页面、打包和发布的需求写入交付说明，由汇总方处理。用户亲自完成客户端登录、验证或需要交互授权的步骤。

## DeepSeek Harness 的任务

交付目录为 `docs/agent-clients/deepseek-harness/`。

1. 优先在正常使用的 Windows Desktop 设置中添加 `xjtlu`。确认 Harness Host 在本机运行，用 Streamable HTTP 连接。当前版本支持凭据管理时，创建凭据引用，将 `Authorization` 设为 `Bearer ${credential:XJTLU_MCP_TOKEN}`。记录入口及重新配对步骤。[Harness MCP manager](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-manager/README.md#managing-configured-servers)
2. 如果当前用户使用 `dsh` CLI，在实际使用的 profile 中添加 `@deepseek-ai/dsh-mcp-client` 单服务配置，核心字段为 `serverName: xjtlu`、`transport: streamable-http`、`url` 和 `headers`。保留已有 MCP 条目，特别是 Desktop 的 `servers` 映射。记录完成接入的是 Desktop 还是 CLI。[Harness Desktop](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md) · [Harness MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md#minimal-configuration)
3. 保存并确认 `xjtlu` 已启用。为统一验收注明客户端显示的工具命名方式，例如 `mcp__xjtlu__get_connection_status`，并交付设置入口和需要复制的字段。

## Xiaomi MiMo Code 的任务

交付目录为 `docs/agent-clients/mimo-code/`。

1. 核对 Windows 上的 MiMo Code CLI 版本、可用命令和用户级配置路径。合并 `xjtlu` 条目，保留 `mimocode.json` 或 `mimocode.jsonc` 的已有设置及根目录 `AGENTS.md`。[配置文件](https://mimo.xiaomi.com/mimocode/config-files) · [配置覆盖](https://mimo.xiaomi.com/mimocode/config-overrides)
2. 在实际使用的配置里设置 `mcp.xjtlu`，使用 `type: "remote"`、本机 URL、`oauth: false` 及 `headers.Authorization: "Bearer {env:XJTLU_MCP_TOKEN}"`。让启动 MiMo Code 的进程继承密钥变量。[MiMo Code MCP 文档](https://mimo.xiaomi.com/mimocode/mcp-servers#disabling-oauth)
3. 用 `mimo mcp list` 或当前版本的等效命令查看初始状态。交付可合并的 JSON 示例和让配置生效的步骤。

## 腾讯 WorkBuddy 的任务

交付目录为 `docs/agent-clients/workbuddy/`。

1. 在 Windows 上核对腾讯 WorkBuddy 桌面端的版本和实际入口。从「连接器 → 自定义连接器 → 配置 MCP」手动添加并启用 `xjtlu`。记录是否需要信任或重连，以及如何从该版本的界面查看工具数。[WorkBuddy 连接器说明](https://www.tencentcloud.com/zh/document/product/1316/84494)
2. 确认 MCP 请求从工作台所在的本机发出。在 `mcpServers.xjtlu` 配置 `type: "streamableHttp"`、本机 URL 和 `headers.Authorization` 的 Bearer 值，保留其他现有连接器。记录实际接受的字段与安全填写密钥的入口。[WorkBuddy 字段与凭据文档](https://open.workbuddy.cn/docs/connector)
3. 交付可粘贴的无密钥 JSON 片段、合并及移除单个条目的步骤。若当前版本无法完成本机直连，记录版本、失败环节及脱敏错误，交给汇总方判断兼容方案。

## Kimi Code 的任务

交付目录为 `docs/agent-clients/kimi-code/`。

1. 核对 Windows 上实际安装的 Kimi Code CLI 版本，在实际使用的用户级配置中添加 `xjtlu`。当前路径为 `~/.kimi-code/mcp.json` 或 `$KIMI_CODE_HOME/mcp.json`。检查项目级同名条目是否会覆盖用户级条目。[Kimi Code MCP 文档](https://moonshotai.github.io/kimi-code/zh/customization/mcp.html)
2. 在 `mcpServers.xjtlu` 配置 `url` 和 `bearerTokenEnvVar: "XJTLU_MCP_TOKEN"`。按版本记录 `/mcp-config` 的编辑入口、`/mcp` 的连接状态，以及保存后何时需要开新会话。旧版字段有差异时，明确标注版本和配对方式。[Kimi Code MCP 配置](https://moonshotai.github.io/kimi-code/zh/customization/mcp.html#配置)
3. 按实际版本在新会话内确认条目已加载。交付可合并的 JSON 示例，以及启动 Kimi 前提供访问密钥、重新配对和移除服务的步骤。

## 各客户端的安装交付

1. 把 `xjtlu` 安装在实际使用的 Windows 客户端里，并确认条目已保存、已启用。优先完成配对。需要用户填密钥时，把它带到对应输入位置并报告待配对状态。完整工具发现和调用留到统一验收。
2. 在自己的交付目录写中文 `README.md`，记录实际客户端版本、入口、无密钥配置、添加和移除单个 `xjtlu` 条目的步骤、密钥重置后的重新配对方式、当前安装状态，以及「Agent 连接」页建议文案和可复制配置。
3. 遇到客户端缺失、无法配对或连接失败时，记录实际进度、复现步骤和脱敏错误。配置已保存、MCP 已连通、学校服务已登录是三个状态，分别记录。

## 汇总到「Agent 连接」页

四项交付和豆包的接入结果由一个 Agent 汇总。复用 [现有页面](../src/renderer/src/McpPage.tsx)、[连接类型](../src/shared/mcp.ts) 和 [主进程复制逻辑](../src/main/mcp-service.ts)，提供各客户端的配置复制和简明步骤。密钥仍由主进程处理，界面只展示连接信息和操作反馈。若当前客户端版本有经验证的官方安装入口，再接上相应的安装动作。

「Agent 连接」页的新增客户端入口从上到下固定按以下顺序显示。

1. DeepSeek Harness
2. 腾讯 WorkBuddy
3. 豆包
4. Xiaomi MiMo Code
5. Kimi Code

豆包使用桌面端自定义连接器配对。工作台已提供接入卡片，位置在 MiMo Code 前。实际客户端配对与联通结果在统一验收中记录。[豆包接入说明](agent-clients/doubao/README.md) 汇总时保留 Codex 插件和通用配置入口。

## 统一验收

等五个客户端都已安装和配对，再集中做一次定向验收。汇总方可在安装期间记录阻碍并推进其他客户端。

1. 做一次外层生产构建。核对程序内入口顺序、复制内容、原有 Codex 入口和密钥重置文案。
2. 在五个实际客户端中检查 `xjtlu` 工具发现，分别确认 16 项工具可见，并调用一次 `get_connection_status`。列表只显示连接状态时，注明工具数量的验证依据。只记录脱敏状态和数量，学校数据、预约和下载均留在本次验收范围之外。
3. 用 [现有测试](../tests/mcp.test.ts) 的虚构数据与隔离配置定向核对错误密钥被拒绝、正确密钥能恢复。保持实际安装使用的密钥和其他连接正常。
4. 各客户端分别记录通过项与待处理项。能从实际客户端发现并调用工具后，才标记为已验证。

### 2026-11-23 工作台按钮验收

生产构建中，四个主按钮通过了页面点击和 IPC 检查。显示顺序为 DeepSeek Harness、腾讯 WorkBuddy、豆包、Xiaomi MiMo Code、Kimi Code，Codex 入口仍可见。使用虚构密钥和随机本机端口验证四种配置，均发现 16 项工具并调用 `get_connection_status`。错误密钥会被拒绝，使用当前密钥可重新连接。

| 客户端 | 工作台按钮 | 本机客户端状态 |
| --- | --- | --- |
| DeepSeek Harness | 通过随桌面端附带的命令安装 `xjtlu` 插件，支持复制含凭据引用的配置 | 隔离 profile 已验证启用插件及重复安装。实际客户端待安装和调用 |
| 腾讯 WorkBuddy | 触发安装；隔离测试核对配置合并、密钥和信任状态 | 已保存配置，信任记录存在，待新会话复核工具 |
| Xiaomi MiMo Code | 触发安装；配置、配对或插件登记不完整时提示检查状态 | 已保存配置和环境变量，已登记插件，待重启客户端并在新会话复核工具 |
| Kimi Code | 一键合并用户级 `mcpServers.xjtlu` 并保存配对密钥，也可复制配置 | 桌面端交付已保存配置，独立 MCP 客户端验证了工具发现及调用，待在 Kimi Code 新会话复核 |

[DeepSeek Harness 接入说明](agent-clients/deepseek-harness/README.md) · [Kimi Code 接入说明](agent-clients/kimi-code/README.md)

## 分发提示词

每个客户端只需收到对应的一句，它可以在项目里直接读取任务和验收要求。

- 请阅读 `docs/agent-client-handoff.md`，先按「DeepSeek Harness 的任务」在本机安装并配对 `xjtlu`，把状态和交付写到 `docs/agent-clients/deepseek-harness/`，最后统一验收。
- 请阅读 `docs/agent-client-handoff.md`，先按「腾讯 WorkBuddy 的任务」在本机安装并配对 `xjtlu`，把状态和交付写到 `docs/agent-clients/workbuddy/`，最后统一验收。
- 请阅读 `docs/agent-client-handoff.md`，先按「Xiaomi MiMo Code 的任务」在本机安装并配对 `xjtlu`，把状态和交付写到 `docs/agent-clients/mimo-code/`，最后统一验收。
- 请阅读 `docs/agent-client-handoff.md`，先按「Kimi Code 的任务」在本机安装并配对 `xjtlu`，把状态和交付写到 `docs/agent-clients/kimi-code/`，最后统一验收。
