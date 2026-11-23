# Kimi Code 接入（Windows）

更新：2026-11-23（北京时间）。本目录记录 Kimi Code 桌面端在本机接入 XJTLU-MCP 的实际配置、验证范围和交付建议。开发、文档和构建均在外层工程进行；本次仓库改动仅限本目录。

## 1. 实际客户端与本机入口

| 项目 | 实际情况 |
| --- | --- |
| 客户端 | Kimi Code 桌面端 1.4.2（安装目录 `D:\Kimi Code`，卸载项显示 `Kimi Code 1.4.2`） |
| 本机伴随进程 | `kimi-code-desktop` 2.7.2，监听 `127.0.0.1:7884`（应用内部使用） |
| 独立 CLI | 未安装。`kimi` 不在 PATH，npm 全局目录只有 `dsh`、`openclaw` |
| 用户级配置目录 | `%USERPROFILE%\.kimi-code`（未设置 `KIMI_CODE_HOME` 时的默认目录） |
| 用户级 MCP 文件 | `%USERPROFILE%\.kimi-code\mcp.json` |
| 项目级 MCP 文件 | 本工作区没有 `.kimi-code/mcp.json`，因此不会覆盖用户级条目 |

桌面端与 CLI 共用 `mcp.json`（[桌面端 MCP 说明](https://www.kimi.com/code/docs/en/kimi-code-desktop/settings-and-extensions.html#mcp)、[CLI MCP 说明](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html)）。桌面端设置里没有单独的 MCP 页面，配置以文件为准；`/mcp-config`、`/mcp` 属于 Kimi Code 的内置交互命令，在桌面端由用户自行调用。

## 2. 当前安装状态

三个状态分别记录：

| 状态 | 结果 | 依据 |
| --- | --- | --- |
| 配置已保存 | 已完成 | 用户级 `mcp.json` 已写入 `mcpServers.xjtlu`，JSON 解析通过（2026-11-23 12:31） |
| MCP 已连通 | 已完成（工作台侧） | 见第 5 节：使用同一 URL 和环境变量密钥的独立 MCP 客户端发现 16 项工具，`get_connection_status` 返回 `ok: true` |
| 学校服务已登录 | 部分 | 工作台状态：AMS、eBridge 已连接；图书馆、LMC 为 idle、未连接。本任务未登录或读取任何学校数据 |
| 客户端内新会话 | 待确认 | 当前会话是在写入配置前创建的，按官方行为不会加载新增服务器；需要用户新建会话复核 |

未在 Kimi Code 会话内实际调用工具，因此**不标记为「已验证」**；完整工具发现和调用留给统一验收。

## 3. 无密钥配置

写入 `%USERPROFILE%\.kimi-code\mcp.json` 的内容（与工作台「复制 Kimi Code 配置」的输出一致）：

```json
{
  "mcpServers": {
    "xjtlu": {
      "url": "http://127.0.0.1:39527/mcp",
      "bearerTokenEnvVar": "XJTLU_MCP_TOKEN"
    }
  }
}
```

说明：

- 有 `url` 且不写 `transport` 时按 HTTP（Streamable HTTP）连接，不需要 `type` 字段。
- `bearerTokenEnvVar` 只保存变量名，真实访问密钥不出现在配置文件中。
- 合并到已有 `mcp.json` 时，只增加 `mcpServers.xjtlu` 这一项，保留其他服务器；同一文件中同名条目以最后一份配置为准，不要重复写两个 `xjtlu`。
- 项目级 `.kimi-code/mcp.json` 中同名的 `xjtlu` 会覆盖用户级条目。在不被信任的文件夹中，项目级服务器会在信任提示里显示传输方式和目标地址，确认信任后才启用；无界面运行时需要 `KIMI_CODE_TRUST_WORKSPACE=1` 或已在配置中关闭工作区信任要求。

## 4. 添加、移除与重新配对

### 添加

在工作台「Agent 连接 → Kimi Code」点「在 Kimi Code 中安装」。工作台将 `mcpServers.xjtlu` 合并到用户级 `mcp.json`，优先使用 `KIMI_CODE_HOME` 指定的目录，并将当前访问密钥保存到 Windows 用户环境变量 `XJTLU_MCP_TOKEN`。完全退出并重启 Kimi Code，再新建本地会话。

#### 手动配置

1. 保持 XJTLU-MCP 工作台运行并已开启 MCP（「Agent 连接」页地址为 `http://127.0.0.1:39527/mcp`）。
2. 在工作台「Agent 连接 → Kimi Code」点「复制 Kimi Code 配置」。
3. 打开或新建用户级 `mcp.json`。默认路径为 `%USERPROFILE%\.kimi-code\mcp.json`，设置了 `KIMI_CODE_HOME` 时使用 `%KIMI_CODE_HOME%\mcp.json`。把 `mcpServers.xjtlu` 合并进去并保存。
4. 把工作台当前访问密钥写入 Windows 用户环境变量 `XJTLU_MCP_TOKEN`（见下节）。本次核对时该变量已存在于用户作用域，且工作台握手通过。
5. 完全退出 Kimi Code 再启动（环境变量在进程启动时读取）。
6. 新建会话，模型侧应出现 `mcp__xjtlu__*` 工具。工具命名格式为 `mcp__<服务器名>__<工具名>`，例如 `mcp__xjtlu__get_connection_status`。

### 设置访问密钥

在 Windows「系统属性 → 环境变量」中为用户变量新增 `XJTLU_MCP_TOKEN`，值从工作台「复制访问密钥」取得，直接粘贴到输入框。也可以用 PowerShell 交互输入，避免密钥进入命令历史：

```powershell
$secure = Read-Host -AsSecureString "粘贴 MCP 访问密钥"
[Environment]::SetEnvironmentVariable('XJTLU_MCP_TOKEN',
  [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)), 'User')
```

只检查是否已设置、不打印内容：

```powershell
if ([Environment]::GetEnvironmentVariable('XJTLU_MCP_TOKEN','User')) { '已设置' } else { '未设置' }
```

不要把密钥写入 `mcp.json`、命令行参数、聊天、截图或日志。

### 移除

1. 编辑用户级 `mcp.json`，删除 `mcpServers.xjtlu`（也可以先设 `"enabled": false` 临时停用），保存。
2. 已打开的会话不会立即中断：该服务器仍会出现在列表中，但调用会收到移除提示；新会话不再注册它的工具。需要立即彻底生效时重启 Kimi Code。
3. 如果还在其他位置添加过同名条目，一并检查项目级 `.kimi-code/mcp.json` 或插件声明。
4. 不再需要时可删除用户环境变量 `XJTLU_MCP_TOKEN`。

### 密钥重置后重新配对

1. 在工作台「Agent 连接」点「重置访问密钥」，再点「在 Kimi Code 中安装」更新配对。
2. 完全退出并重新启动 Kimi Code，然后新建会话。新进程会读取更新后的环境变量。
3. 若仍失败，确认工作台正在运行、端口 39527 未被占用，并检查是否被项目级同名条目覆盖。

## 5. 本次验证记录（脱敏）

- 配置校验：`mcp.json` 可被 JSON 解析，条目为 `url` + `bearerTokenEnvVar`。
- 连通性核对：在仓库外用 `@modelcontextprotocol/client` 以相同 URL 和 `XJTLU_MCP_TOKEN` 环境变量建立 Streamable HTTP 会话，`listTools` 返回 16 项工具：
  `get_connection_status`、`refresh_source`、`get_modules`、`get_timetable`、`get_exams`、`get_grades`、`get_attendance_summary`、`get_attendance_records`、`get_library_overview`、`get_library_seats`、`reserve_library_seat`、`get_library_reservations`、`get_lmc_notification`、`list_lmc_modules`、`get_module_contents`、`download_lmc_file`。
- 同一会话调用 `get_connection_status` 返回 `ok: true`、`stale: false`；来源状态为 AMS connected、eBridge connected、library idle、LMC idle。
- 临时脚本位于本地 `.scratch/`，运行后已删除；没有记录访问密钥、学校账号、Cookie 或签名链接。
- 以上核对证明「地址 + 环境变量密钥」这组配置有效，但**不等同于 Kimi Code 客户端内已验证**。客户端内的工具发现与调用（`mcp__xjtlu__*`）需要新建会话后复核。

## 6. 版本与字段差异

- 本次版本 1.4.2 使用第 3 节的字段；`url` 省略 `transport` 即为 HTTP，`bearerTokenEnvVar` 为该版本支持的 HTTP 凭据字段。
- `type: "http"`、`headers.Authorization` 等写法属于其他客户端或旧版示例。若某个旧版本不识别 `bearerTokenEnvVar`，可退回文档支持的静态请求头 `headers: { "Authorization": "Bearer <密钥>" }`（密钥会落在文件中，安全性较差），或升级客户端。此回退**未在本机旧版本验证**，仅作为兼容提示。
- `/mcp-config` 可在交互界面中增删服务器，`/mcp` 查看连接状态。本机没有独立 CLI，桌面端由用户自行调用这些内置命令；本次采用直接写入用户级文件的等效方式。
- 服务器新增或删除只影响之后创建的会话；运行中的会话保持原工具列表。

## 7. 「Agent 连接」页

主按钮为「在 Kimi Code 中安装」，手动接入仍可用「复制 Kimi Code 配置」和「复制访问密钥」。安装时保留其他服务和顶层设置。若已有 JSON 无法解析或结构无效，界面提示检查配置文件。

## 8. 待验收

在 Kimi Code 的新会话确认 16 项 `mcp__xjtlu__*` 工具可见，并调用一次 `mcp__xjtlu__get_connection_status`。
