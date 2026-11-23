# 运行环境变量与本机数据写入总结

核对日期：2026-11-21（北京时间）。

范围：当前外层开发工程的源码，以及本机已经存在的应用数据和校园插件文件。本文描述当前开发版，不代表 GitHub V1.0 发布包具有全部相同行为。核对采用源码检查和文件目录检查，没有进行系统级的逐次文件写入跟踪，也没有读取或记录账号、密码、Cookie、访问密钥或学校签名链接的实际内容。

## 1. 结论

- 持久化环境变量：**1 个**，为当前 Windows 用户的 `XJTLU_CODEX_MCP_TOKEN`，在插件安装或配对时写入。
- 系统级环境变量：**0 个**；当前代码没有修改 Windows 系统 `PATH`。
- 打包脚本额外使用 **4 个临时环境变量**，只传给相应子进程，不写入 Windows 用户或系统环境。
- 普通运行的数据主要位于 `%APPDATA%\XJTLU-MCP-AMS\`，包括账号凭据、MCP 密钥、可选教务缓存，以及 Electron 的学校会话和浏览器缓存。
- 安装校园插件时，还会通过 Codex 更新插件配置及插件缓存。下载 LMC 文件时，文件写入用户选择的位置。
- 构建、打包和诊断会使用工程内的 `out/`、`dist/`、`.scratch/` 等位置，与普通运行的数据写入分开统计。

## 2. 环境变量

### 2.1 持久化变量

| 名称 | 作用范围 | 用途 | 写入时机 | 退出后是否保留 |
| --- | --- | --- | --- | --- |
| `XJTLU_CODEX_MCP_TOKEN` | Windows 当前用户 | 供 Codex 校园插件读取 MCP 配对密钥 | 点击 ChatGPT 卡片的「安装」或运行插件安装脚本 | 保留 |

Windows 将该用户环境变量保存在注册表 `HKEY_CURRENT_USER\Environment`，它不是某个目录中的独立配置文件。本机已确认存在该变量，系统级没有同名变量。

变量的内容为 MCP 访问密钥。用户环境变量本身没有使用应用的 safeStorage 加密；应用数据目录中的 `mcp-access.bin` 则是加密文件。插件清单只引用变量名，不写入密钥值。

主进程通过 PowerShell 标准输入传递配对密钥，不把密钥放入命令行参数。普通启动及插件状态检查不会执行用户环境变量写入。重新配对会更新同一项变量，不会增加新的变量名。

### 2.2 打包时的临时变量

| 名称 | 使用流程 | 用途 |
| --- | --- | --- |
| `XJTLU_PACKAGE_DIR` | Windows 应用打包 | 待压缩的程序目录 |
| `XJTLU_PACKAGE_ZIP` | Windows 应用打包 | ZIP 输出路径 |
| `XJTLU_PLUGIN_STAGE` | 独立插件打包 | 待压缩的插件目录 |
| `XJTLU_PLUGIN_ZIP` | 独立插件打包 | 插件 ZIP 输出路径 |

这些变量通过启动参数中的 `env` 对象传给打包子进程，随该进程结束而消失，不属于永久环境变量。

### 2.3 读取和子进程环境处理

- `SystemRoot`：用于定位 Windows PowerShell，代码只读取它。
- `ELECTRON_RENDERER_URL`：用于识别开发模式的界面地址，应用代码只读取它。
- `ELECTRON_RUN_AS_NODE`：`npm start` 的启动脚本会从传给 Electron 的环境副本中删除它，让 Electron 正常启动图形应用；不会删除 Windows 已保存的环境变量。
- 从父进程继承的其他环境变量，不计作本程序新增的变量。

## 3. 普通运行的数据目录

默认根目录：

```text
%APPDATA%\XJTLU-MCP-AMS\
```

下面的文件和子目录均位于该根目录内。

### 3.1 应用显式保存的文件

| 文件 | 内容 | 写入条件 |
| --- | --- | --- |
| `ams-credentials.json` | safeStorage 加密的学校账号和密码 | 用户保存或更新账号 |
| `mcp-access.bin` | safeStorage 加密的 MCP 访问密钥 | 首次生成密钥或重置密钥 |
| `ebridge-cache.bin` | 加密的课程列表、课表、考试安排、所属账号标识及读取时间 | 开启本地教务缓存后保存或成功更新数据 |

本机核对时，上述三个文件均存在。账号、密钥和教务缓存写入时，会先使用同目录的临时文件，再重命名为正式文件；临时文件不属于新的数据根目录。

`ebridge-cache.bin` 的模型不包含成绩、学校会话或签名来源链接。取消教务缓存、移除保存账号、切换账号或显式断开 eBridge 时，代码会清除对应本地缓存。应用显式保存的业务文件与浏览器内核缓存是不同层次的数据，不能由此推断内核缓存完全不含学校页面内容。

### 3.2 四个学校系统的独立会话

| 子目录 | 对应系统 | 主要内容 |
| --- | --- | --- |
| `Partitions\xjtlu-ams\` | AMS | Cookie、学校网页存储、网络缓存及相关浏览器状态 |
| `Partitions\xjtlu-ebridge\` | eBridge | Cookie、学校网页存储、网络缓存及相关浏览器状态 |
| `Partitions\xjtlu-library\` | 图书馆预约系统 | Cookie、学校网页存储、网络缓存及相关浏览器状态 |
| `Partitions\xjtlu-core\` | Learning Mall Core | Cookie、学校网页存储、网络缓存及相关浏览器状态 |

这四个目录对应应用自己的持久化会话。本机已确认四个目录均存在。它们内部也可能包含 `Cache`、`Local Storage`、`IndexedDB`、`Network`、`Session Storage` 等由 Chromium 管理的子目录和数据库。

### 3.3 主界面及浏览器内核数据

| 文件或目录 | 用途 |
| --- | --- |
| `Local Storage\` | 主界面的本机偏好，例如 LMC 课程排序、是否隐藏登录提醒 |
| `Session Storage\` | 会话存储 |
| `Network\` | 网络状态和相关数据库 |
| `Cache\`、`Code Cache\` | 页面资源及脚本缓存 |
| `GPUCache\`、`ShaderCache\`、`GrShaderCache\`、`DawnGraphiteCache\`、`DawnWebGPUCache\`、`GPUPersistentCache\` | 图形和渲染缓存 |
| `Dictionaries\`、拼写词典文件 | 浏览器词典资源 |
| `Local State`、`Preferences`、`DIPS` 等 | 浏览器内核维护的配置和状态 |
| `blob_storage\`、`Shared Dictionary\`、`Extension State\` 等 | 浏览器内核自动管理的其他存储 |

实际目录数量和大小会随访问页面、Electron 版本及运行情况变化，不能把固定的缓存目录清单当作永久不变的文件总数。

### 3.4 已有但未确认当前写入来源的文件

本机还发现 `library-preferences.json`。当前外层源码没有找到其对应写入点，因此只记录它已经存在，不认定当前版本仍在更新它，也不据此推断文件内容或创建来源。

## 4. 插件安装涉及的 Codex 文件

应用通过 Codex 官方命令登记插件目录，插件安装及启用由 Codex 管理。本机核对到以下位置：

| 位置 | 内容或作用 |
| --- | --- |
| `%USERPROFILE%\.codex\config.toml` | `xjtlu-local` 插件目录登记及 `xjtlu-campus@xjtlu-local` 的插件配置 |
| `%USERPROFILE%\.codex\plugins\cache\xjtlu-local\xjtlu-campus\<版本>\` | 已安装版本的校园插件清单和 MCP 配置 |
| `%APPDATA%\XJTLU-MCP-AMS\agent-plugins\codex\` | 工作台登记给 Codex 的本机插件目录 |

校园插件缓存内已确认有 `.mcp.json` 和 `.codex-plugin\plugin.json`。其中的 MCP 配置只声明 `XJTLU_CODEX_MCP_TOKEN` 变量名。版本更新后缓存目录中的版本号可能变化。

这里只统计与校园插件直接相关的配置和文件，不将整个 `.codex` 目录中的其他聊天、日志或插件资料归因于本程序。

## 5. LMC 文件下载

下载通过系统保存窗口让用户选择路径。默认建议位置取自 Electron 的 `app.getPath('downloads')`；本机通常对应：

```text
%USERPROFILE%\Downloads\
```

最终文件写入用户在保存窗口选择的位置，可以是其他目录。Windows 下载文件夹若被重定向，默认路径也会不同。程序只提供文件下载，不在此流程中提取 PDF、Office 或其他文档正文。

## 6. 开发、构建和诊断使用的位置

以下位置相对于外层工程根目录，分别由对应开发操作产生，不作为普通启动的固定数据目录：

| 位置 | 使用场景 |
| --- | --- |
| `out/` | 类型检查通过后的应用构建产物 |
| `dist/` | Windows 程序目录、ZIP、校验文件和独立插件打包产物 |
| `.scratch/smoke-profile/` | 显式使用 `--smoke-test` 时替代普通用户数据目录 |
| `.scratch/encryption-test/` | 显式运行加密诊断脚本时的隔离资料及 `result.json` |
| `.scratch/` 中的其他隔离目录 | 历史人工诊断或验证资料，具体由相应诊断操作决定 |
| `node_modules/` | 安装开发依赖和 Electron 运行文件时使用；普通启动复用已有内容 |

安装依赖所涉及的 npm、Electron 下载缓存等属于安装工具的额外写入，本次没有审计其全部目录。操作系统自行维护的临时文件、崩溃记录等也不属于本次逐项跟踪范围。

## 7. 核对依据

| 源码位置 | 对应行为 |
| --- | --- |
| `src/main/index.ts` | 用户数据目录设置、账号及缓存初始化、插件配对入口 |
| `src/main/codex-plugin.ts`、`codex-plugin/Install.ps1` | 用户环境变量读写、插件目录登记 |
| `src/infrastructure/credential-store.ts` | 账号凭据加密文件及临时文件 |
| `src/infrastructure/mcp-key-store.ts` | MCP 密钥加密文件及临时文件 |
| `src/infrastructure/ebridge-cache.ts` | 教务缓存文件及清理逻辑 |
| `src/main/ams-service.ts`、`src/main/ebridge-service.ts`、`src/main/library-login.ts`、`src/main/lmc-service.ts` | 学校系统的独立会话及下载流程 |
| `src/renderer/src/LmcPage.tsx` | 界面偏好的 localStorage 写入 |
| `scripts/start.mjs` | Electron 子进程环境处理 |
| `scripts/package-windows.mjs`、`scripts/package-codex-plugin.mjs` | 打包临时环境变量和输出路径 |
| `scripts/check-encryption.cjs` | 隔离加密诊断目录 |

本次文档整理不改变程序行为，不执行数据清理，不修改用户环境变量或学校会话，也不包含任何真实密钥或会话内容。
