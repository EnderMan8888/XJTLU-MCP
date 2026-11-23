# DeepSeek Harness 接入 xjtlu 校园 MCP

本目录是「多客户端接入交接」中 DeepSeek Harness 的交付。内容：实际安装结果、无密钥配置、添加/移除/重新配对步骤，以及「Agent 连接」页建议文案与可复制配置。

## 一、接入结果摘要

| 项 | 结果 |
| --- | --- |
| 完成接入的客户端 | **DeepSeek Harness Desktop**（Electron 管理的 `desktop` profile） |
| 客户端版本 | `0.2.2-rc.5`（`@deepseek-ai/dsh-desktop-runtime`） |
| 接入方式 | 插件 `@local/xjtlu-mcp`（源码清单 `1.1.1`；本机旧安装为 `1.1.0`，见第八、十节）通过 Desktop 的 MCP 管理器注册 `xjtlu`，已有同名连接器时复用原条目 |
| 传输 | Streamable HTTP，`http://127.0.0.1:39527/mcp` |
| 认证 | `Authorization: Bearer ${credential:XJTLU_MCP_TOKEN}`（凭据引用，密钥不落配置） |
| 工具命名 | `mcp__xjtlu__<工具名>`，共 16 项，例如 `mcp__xjtlu__get_connection_status` |
| 安装入口 | 工作台「Agent 连接 → 在 DeepSeek Harness 中安装」 |

> 工作台调用 Desktop 自带的命令管理 `desktop` profile。[DeepSeek Harness Desktop 官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime)

> 插件通过管理器的 `register` 注册自己的服务，安装后可在 MCP 列表看到该服务。[插件注册方式](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-manager/README.md#registering-a-server-from-a-plugin)

## 二、客户端版本与入口

- 安装目录：`%LOCALAPPDATA%\Programs\DeepSeek Harness`
- 运行时版本：`0.2.2-rc.5`（`resources\app.asar\dsh\package.json` 中 `@deepseek-ai/dsh-desktop-runtime`）
- profile：`desktop`（默认目录 `%USERPROFILE%\.dsh\profiles\desktop`，bundles 为 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）
- MCP 服务器入口：Desktop 的 MCP 服务器由 `@deepseek-ai/dsh-mcp-manager` 管理。MCP 列表可查看插件注册的 `xjtlu`，在插件页启用或移除注册它的插件。
- 安装后在「插件（Plugins）」页可核对 `@local/xjtlu-mcp`（源码清单 `1.1.1`；本机旧安装仍是 `1.1.0`，补丁已就地修正，见第十节）。

> 入口的精确 UI 标签（设置页里 MCP 区块的中英文标题）本次未通过点击核对，以上以已核实的 `mcp-manager` 配置层为准；若界面上未直接看到 MCP 区块，到「设置 → 插件/连接器」里找 MCP 服务器列表即可，底层就是同一个 `servers` 映射。

## 三、无密钥配置（密钥不落配置）

以下是从工作台复制的配置示例。安装时，插件使用相同的地址及凭据引用。

```json
{
  "xjtlu": {
    "transport": "streamable-http",
    "url": "http://127.0.0.1:39527/mcp",
    "headers": { "Authorization": "Bearer ${credential:XJTLU_MCP_TOKEN}" },
    "enabled": true
  }
}
```

需要的字段（对应工作台「Agent 连接」页要复制的内容）：

| 字段 | 值 |
| --- | --- |
| 服务名 `serverName` | `xjtlu` |
| 传输 `transport` | `streamable-http` |
| 地址 `url` | `http://127.0.0.1:39527/mcp` |
| 请求头 `headers.Authorization` | `Bearer ${credential:XJTLU_MCP_TOKEN}`（凭据名 `XJTLU_MCP_TOKEN`，值为工作台的「复制访问密钥」结果） |
| `enabled` | `true` |

## 四、添加 xjtlu 条目

### 方式 A（工作台安装）

1. 首次安装前，先打开一次 DeepSeek Harness 完成初始化，再从托盘完全退出客户端。
2. 在工作台「Agent 连接」点「在 DeepSeek Harness 中安装」。工作台安装并启用插件，并通过 Harness 的凭据管理接口保存 `XJTLU_MCP_TOKEN`。
3. 安装或更新插件后打开 Harness，启动新会话并调用 `mcp__xjtlu__get_connection_status`。仅更新配对时，再点安装按钮即可，正在运行的 Harness 会读取新凭据。

旧版 `1.1.0` 补丁把新插件写成了对已有行的修改，Harness 找不到目标行时会跳过。`1.1.1` 用 `insert` 插入 `xjtlu-campus-mcp`。升级时请先从托盘完全退出 Harness，再点工作台安装按钮并重新打开 Harness。[Harness 配置组合说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md#inspect-the-composed-config)

### 方式 B（通过工作台复制配置）

1. 在工作台「Agent 连接 → DeepSeek Harness」点「复制 DeepSeek Harness 配置」。
2. 打开 Harness 的 MCP 服务器设置，按复制的字段新增或编辑 `xjtlu`。请求头 `Authorization` 用 `Bearer ${credential:XJTLU_MCP_TOKEN}`。
3. 保存并保持启用。按第六节完成配对。

## 五、移除单个 xjtlu 条目

- 若是方式 A（插件）：在「插件（Plugins）」页移除 `@local/xjtlu-mcp`。插件注册的连接器随之撤下。
- 若是方式 B（手动设置）：在设置里的 MCP 服务器列表删除 `xjtlu`，或先停用（`enabled: false`）保留条目。
- 移除后如该会话仍列出 `mcp__xjtlu__*` 工具，开新会话生效（DSH 既有会话沿用启动时的插件修订）。

## 六、配对与密钥重置后的重新配对

- 保持 XJTLU-MCP 工作台运行。首次配对和密钥重置后，在「Agent 连接」页点「在 DeepSeek Harness 中安装」。手动添加的同名连接器也可以使用此入口配置凭据，前提是请求头使用 `Bearer ${credential:XJTLU_MCP_TOKEN}`。
- 工作台通过 Harness 自带的凭据接口更新 `~/.dsh/.credentials.yaml` 中的 `refs.XJTLU_MCP_TOKEN`。Harness 会优先使用此引用，自动重载凭据并重试等待配对的连接。已有的其他凭据记录会保留。[Harness 凭据说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/credentials/credentials-local/README.md)
- 如果沿用 Windows 用户环境变量手动配对，Harness 仅在启动时读取该变量。为运行中的客户端配对，请用工作台的安装按钮更新凭据引用。

## 七、工具命名

DSH 用服务器限定名暴露工具：`mcp__<serverName>__<原始工具名>`。xjtlu 的 16 项工具即：

```
mcp__xjtlu__get_connection_status
mcp__xjtlu__refresh_source
mcp__xjtlu__get_modules
mcp__xjtlu__get_timetable
mcp__xjtlu__get_exams
mcp__xjtlu__get_grades
mcp__xjtlu__get_attendance_summary
mcp__xjtlu__get_attendance_records
mcp__xjtlu__get_library_overview
mcp__xjtlu__get_library_seats
mcp__xjtlu__reserve_library_seat
mcp__xjtlu__get_library_reservations
mcp__xjtlu__get_lmc_notification
mcp__xjtlu__list_lmc_modules
mcp__xjtlu__get_module_contents
mcp__xjtlu__download_lmc_file
```

统一验收时在**新会话**里确认这 16 项可见，并调用一次 `mcp__xjtlu__get_connection_status`。既有会话沿用启动时的插件修订，看不到刚装上的工具。

## 八、当前安装状态（三个状态分别记录）

1. **核对安装**：确认 profile 已启用插件，且 Harness 的组合配置中出现 `xjtlu-campus-mcp` 插件行。源码清单为 `1.1.1`；本机 profile 实际仍是旧工作台写入的 `1.1.0` 副本，已就地按 `1.1.1` 的补丁内容修正，见第十节。
2. **核对 MCP 工具**：在 Harness 新会话中调用 `mcp__xjtlu__get_connection_status`，确认工具可用。2026-11-23 已在本机实际调用成功。
3. **学校服务登录**：本次只验证了 MCP 工具列表。学校服务的登录状态可在工作台查看。

## 九、给「Agent 连接」页的建议

- 文案建议（DeepSeek Harness 条目）：`安装或更新插件前从托盘完全退出 Harness，操作完成后重新打开。仅更新密钥时，再点安装即可。保持工作台运行，在 Harness 新会话中检查 mcp__xjtlu__* 工具。`
- 可复制配置（无密钥，密钥由主进程/用户填入 `XJTLU_MCP_TOKEN` 凭据）：

```json
{
  "xjtlu": {
    "transport": "streamable-http",
    "url": "http://127.0.0.1:39527/mcp",
    "headers": { "Authorization": "Bearer ${credential:XJTLU_MCP_TOKEN}" },
    "enabled": true
  }
}
```

- 需要用户复制/填写的字段：地址 `http://127.0.0.1:39527/mcp`、凭据名 `XJTLU_MCP_TOKEN`（值取工作台「复制访问密钥」）。

## 十、实机修复与验证记录（2026-11-23）

本节记录一次「插件装了、凭据也配了，但工具始终不出现」的实机排查，供后续接手者复现与验收参照。时间为北京时间。

### 现象

- 工作台的 MCP 服务正常运行，`127.0.0.1:39527/mcp` 可用，用访问密钥握手成功，`tools/list` 返回 16 项工具。
- `~/.dsh/.credentials.yaml` 已写入 `refs.XJTLU_MCP_TOKEN`，`XJTLU_MCP_TOKEN` 也在 Windows 用户环境变量里。
- 但 DSH 会话工具集里没有任何 `mcp__xjtlu__*`；`plugin_manager list_plugins` 共 205 行，从头到尾没有 `xjtlu-campus-mcp` 行；会话日志中也从未出现 `mcp__xjtlu`。
- 反复重启 Harness、补写凭据都无效。

### 根因

profile 实际加载的不是 `%APPDATA%\XJTLU-MCP-AMS\agent-plugins\deepseek-harness\1.1.0`，而是 pnpm 在 profile 内留下的副本 `~/.dsh/profiles/desktop/node_modules/@local/xjtlu-mcp`。该副本（`1.1.0`）的 `cordis.patch.yml` 写成：

```yaml
- id: xjtlu-campus-mcp
  name: '@local/xjtlu-mcp'
  inject: [mcpManager]
```

按 Loader 补丁规则，顶层带 `id` 且没有 `insert` 的条目表示「修改 id 为 `xjtlu-campus-mcp` 的既有行」；profile 中没有这一行时，补丁只会告警并被跳过（见官方 `references/composition-reference.md` 的 Loader patch dialect）。于是插件 `apply` 从未执行，`mcpManager` 里没有 `xjtlu` 服务器，工具自然不会注册。凭据缺失是叠加在后面的第二道门槛；插件行不存在时，补凭据和重启都只是空转。

### 修复

统一改为 insert 形式，三处保持同一内容：

```yaml
- insert:
    - id: xjtlu-campus-mcp
      name: '@local/xjtlu-mcp'
      inject: [mcpManager]
```

| 位置 | 说明 |
| --- | --- |
| `src/main/assets/deepseek-harness/xjtlu-mcp/cordis.patch.yml` | 工程内源资产；重建工作台后写出的安装包才会带正确补丁 |
| `%APPDATA%\XJTLU-MCP-AMS\agent-plugins\deepseek-harness\1.1.0\cordis.patch.yml` | 工作台「在 Harness 中安装」分发的持久包副本 |
| `~/.dsh/profiles/desktop/node_modules/@local/xjtlu-mcp/cordis.patch.yml` | profile 实际加载的副本，三处中只有这份决定运行时行为 |

`src/main/assets/.../package.json` 的版本此前已是 `1.1.1`，但补丁内容没有跟着改；本次把补丁补齐。

### 验证

从托盘完全退出并重新打开 Harness 后：

- profile 组合中出现 `xjtlu-campus-mcp` 行，`xjtlu` MCP 服务器注册成功；
- 16 项工具以 `mcp__xjtlu__*` 进入工具集；
- 在会话中直接调用 `mcp__xjtlu__get_connection_status` 成功：`ok: true`、`complete: true`、`stale: false`、`fetchedAt 2026-11-23T05:40:07Z`；AMS 与 eBridge 为 `connected`，图书馆与 LMC 为 `idle`（需在桌面连接）。

### 遗留与注意

- 本机 profile 仍是 `1.1.0` 目录（旧工作台构建写入），只是补丁被就地修正。重新构建工作台后应再执行一次安装，让 `1.1.1` 正式覆盖。
- 以后改 bundle 补丁，验收要看到「组合配置里出现 `xjtlu-campus-mcp` 行」再谈工具；只确认「安装成功」「包在 bundles 列表里」不足以说明插件真的挂载。
- 排查时不要用「补凭据重试」掩盖插件未加载：先用插件列表行数或组合配置确认行是否存在。

## 附录：dsh CLI 单服务配置（未应用，仅参考）

若后续为独立 CLI profile 接入，用静态 `@deepseek-ai/dsh-mcp-client` 单服务配置（非 `mcp-manager`）：

```yaml
- insert:
    - id: xjtlu-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: xjtlu
        transport: streamable-http
        url: http://127.0.0.1:39527/mcp
        headers:
          Authorization: 'Bearer ${credential:XJTLU_MCP_TOKEN}'
        expandTemplates: true
        failOnStartupError: true
```

注意：本机 `desktop` profile 由 Electron 独占，不能这么加；此片段仅用于将来新建并实际使用的 CLI profile。

## 交付文件

- [README.md](README.md)（本文件）
- [随工作台构建的插件源码](../../../src/main/assets/deepseek-harness/xjtlu-mcp/)（清单、启用配置、连接器、展示元数据及图标）
