# XJTLU-MCP · 校园信息中心

TypeScript + Electron 桌面应用，聚合 AMS 出勤、eBridge 教务、图书馆选座预约和 Learning Mall Core。V2.1 提供 16 个 MCP 工具，覆盖连接与刷新、课表、考试、成绩、考勤、图书馆座位与预约、LMC 通知和课程资料。

## Learning Mall Core

从首页或侧栏进入「Learning Mall Core」，点击「连接 LMC」，复用首页保存的学校账号完成官方登录。课程列表支持搜索，选择课程可查看 Module 活动；资料可直接下载，文件夹展开后可逐个下载文件，保存时选择本地位置。提供下载进度、取消和完成后显示文件，不提取 PDF、Office 或压缩包的文档内容。

Notification 展示标题、正文、时间和学校的已读状态，支持分页加载；在程序中读取或展开通知不会将其标为已读。作业、讨论等活动可打开学校原页，当前未实现独立的作业截止时间或成绩汇总。使用范围与验证记录见 [LMC 接入说明](docs/lmc.md)。

## Agent MCP 连接

侧栏新增「Agent 连接」，可复制 Codex 或通用客户端配置。程序运行时提供带独立访问密钥的本机 Streamable HTTP 服务，地址为 `http://127.0.0.1:39527/mcp`。

最小化窗口时，MCP 继续运行。Windows 上点窗口右上角 × 会收起到系统托盘，点击托盘图标可恢复窗口。需要完全退出时，右键托盘图标选择「退出 XJTLU-MCP」。

单节考勤支持北京时间今天、昨天和明天。工具复用当前桌面连接并标明数据来源、更新时间和完整性。通过 Agent 发起的座位预约需在桌面确认，LMC 文件由用户选择保存位置。

本机 Codex 也可以通过 [XJTLU-MCP 插件](codex-plugin/README.md) 连接。使用 `npm run package:codex-plugin` 生成 Windows 本机插件 ZIP。连接参数和结果语义见 [MCP 连接说明](docs/mcp.md)。

## 下载使用

在 [Releases](https://github.com/EnderMan8888/XJTLU-MCP/releases) 下载 Windows x64 完整安装 EXE 或完整解压 ZIP。安装版可从开始菜单打开，解压版请完整解压后双击 `XJTLU-MCP.exe`。已有兼容安装时可以使用 Lite EXE 原地更新。每个包都提供 SHA-256 校验值。发布包未签名。

安装版首次运行时可选择目录和是否创建桌面快捷方式。升级会沿用已登记的安装目录。受保护目录会通过 Windows UAC 请求程序文件操作权限。使用解压版的用户应先从托盘退出工作台，再完整解压新版。学校账号、会话和已启用的教务缓存保存在同一 Windows 用户的 `%APPDATA%\XJTLU-MCP-AMS`。安装版可通过 Windows「已安装的应用」卸载，程序目录中的 `Uninstall.exe` 也可用于卸载。卸载时可选择是否保留本机数据。详情见 [v2.4.0 发布说明](releases/v2.4.0.md)。

首页和侧栏均可进入「账号与设置」。AMS、eBridge、图书馆和 LMC 可分别开启会话过期后的自动重登，默认关闭。需要在线读取时才尝试恢复过期连接，普通课表查询继续使用缓存。

首页「今天的课程」使用 eBridge 的课程、时间和教室，按北京时间、所属学期、校历教学周和课程周次筛选。右侧签到状态来自 AMS → Module → 对应课程 → Detail 的单节考勤记录，先确认课程属于该学期，再按当天日期、课堂开始时间及教学组匹配，并兼容学校课表预留的十分钟课间差异。显示单节状态和签到时间；不使用 AMS 首页近期课表的状态，也不根据课程总体签到率推算。没有唯一匹配记录时显示「未匹配到记录」，不推断缺勤。启动时自动连接两个来源，也可点击「刷新今日课程」更新。

目前内置的校历为学校发布的 2026/27 学年学生校历，按学年明确限定；遇到尚未配置的学年会提示无法确认当天课程。[校历原文（学校文件的合作院校副本）](https://www.rf.unibl.org/wp-content/uploads/2026/10/ACADEMIC-CALENDAR-2026-27-FOR-STUDENT-1-1.pdf)。

图书馆入口仅提供「选座预约」和「我的预约」。默认查询今天「现在起至 22:00」，查询、核对及提交时更新即时开始时间；需要其他安排时展开「修改日期 / 时段」。保留按楼层查询，界面显示上次更新时间。学校规定时段需满足最短和最长预约时长，22:00 后提示修改安排。空位提醒和后台定时监测已移除。

「我的预约」按官方 `reserve/resvInfo` 的 `beginDate`、`endDate`、`page`、`pageNum`、`needStatus` 参数读取和分页，使用 `resvDevInfoList` 中的座位名称。旧版误用 `startDate`、`pageSize` 会导致学校返回 HTTP 500，已对比登录后的真实响应确认并修正。

## 运行

开发环境：Node.js 22.12+，npm，Windows。

```powershell
npm ci
npm run install:electron
npm run build
npm start
```

Electron npm 包与运行时分开安装。`npm run install:electron` 由用户手动执行，下载并解压项目指定版本的 Electron。`npm start` 在运行时缺失时只提示安装，不会自动下载。

安装好运行时后，开发时使用 `npm run dev`。检查使用 `npm run typecheck` 和 `npm test`；测试使用 Node.js 内置测试工具。

软件启动后自动尝试恢复学校会话并连接 AMS。需要账号时，在「账号与设置」保存学校账号密码，之后由程序填写并点击学校登录按钮。遇到验证码、二次验证或页面确认时，会打开学校官方窗口提示用户完成；验证后继续读取数据。

## 记住账号密码

在「账号与设置」中保存学校账号和密码。账号与密码整体通过 Electron 的异步 safeStorage API 加密，Windows 上使用由 DPAPI 保护的密钥。为兼容已有记录，密文仍使用 `%APPDATA%\XJTLU-MCP-AMS\ams-credentials.json`，现由公共账号模块统一管理。加密不可用时拒绝保存。

若学校提示异地登录或风险登录，在弹出的西浦官方窗口选择验证方式、填写验证码并提交。窗口最小化时，可点工作台顶部的「打开学校验证窗口」继续。学校认证通过后，程序继续连接原来的服务。

进入西浦官方 UIM 登录页时，程序在已确认的账号密码表单中自动填写并点击原始 Sign in 按钮，保留学校的校验与加密逻辑。自动提交按每次连接限制，密码错误后停止重试；页面已有不同的账号或密码时保留用户输入。验证码、OTP、滑块及额外页面确认交给用户完成。

保存的密码不会通过 IPC 读回应用界面，不写日志。可在首页更新或删除。删除密码保留当前学校会话；AMS 内的「断开 AMS」仅清除该服务的会话和内存数据，不删除公共学校账号。

## AMS 课程与签到率

「AMS 出勤」默认显示「课程与签到率」，读取官方 Module → My Module 的数据：

- 当前学期的课程代码、课程名称与每门课签到率。
- 学校返回的总体签到率。
- 按学校提供的学年、学期切换查询，并可按代码或名称筛选课程。
- “暂无统计”与真正的 0% 分别显示，签到率直接使用学校数值，不由近期课表推算。

「近期课表」保留日期、课程、时间、教室与出勤标记。两个视图分别显示来源、更新时间和读取失败提示，某一来源失败不会被显示为空课程。

AMS「近期课表」的签到状态同样按 Module → 对应课程 → Detail 核对，显示单节状态与签到时间。切换课表日期时按需查询该日的课程记录，日期之间及首页查询分别保存结果；不会用课表接口的原始 `status` 补充缺失的 Module 考勤。

课表日期固定为「今天」「昨天」「明天」，默认今天，按北京时间切换。三天的课程名称、时间、教室和教学组统一从 eBridge Timetable 提取，按对应教学周筛选；AMS Module 仅提供单节签到状态及签到时间。缺少 Timetable 时提示等待读取，不再用缺少教室的考勤记录生成课表。AMS 页面刷新时会同时更新 Timetable 和签到数据。

## eBridge 课程、课表、考试与成绩

进入首页或侧栏的「eBridge 教务」，点击连接或刷新，复用公共学校账号完成登录。页面提供「课程信息」「Timetables」「考试安排」「成绩查询」四个视图。

在 eBridge 页可勾选「在本机保存课表、课程列表和考试安排」。默认关闭。保存学校账号后开启此选项，可以在下次启动时直接查看加密缓存及原读取时间。联网刷新成功后更新对应数据，关闭选项会清除本地副本。成绩仍按需读取。

「成绩查询」按需读取 Academic Records，可查看当学年的分项成绩和 Full Academic Records 完整记录。显示考核项目、类型、比重、原始分数，以及学校提供的课程总评、等级、学分、学期和考试次数；历史记录可展开分项。支持学年筛选和搜索，空白显示「暂无成绩」，保留真正的 0 分，不推算总评或平均分。详细范围见 [成绩查询说明](docs/ebridge-grades.md)。

考试安排来自学校 Timetables 总览中的个人考试表，展示课程、日期、星期、入场时间、开考时间、考试时长、考场/校区、座位号、区域和入口。时间保留学校的 UTC+8 标注，入场时间与开考时间分别展示。支持按日期筛选、搜索课程或考场，并按考试日期排序。「打开学校原页」直接进入考试表所在的总览。

连接和刷新均先读取 Timetables 总览中的考试表，再进入个人课程表。考试结果独立更新；读取期间的重复刷新共用同一次任务，避免学校页面相互跳转而漏读考试。

各视图分别记录更新时间和读取失败提示。考试页面无法识别时会提示读取失败并保留上次结果；学校明确返回空表时才显示没有考试安排。成绩的分项页面与完整记录也分别缓存和报告错误。登录凭据和含会话信息的学校链接保留在主进程中。

## 当前范围

- 固定查询 AMS 官方课表接口：`https://ams.xjtlu.edu.cn/xjtlu/xjtlu-base-student-timetables/getStudentTimetable`。
- 课程与签到率接口：`https://ams.xjtlu.edu.cn/xjtlu/stuapi/my-module/list`，查询包含 `type=1`、`academicYear`、`semester`。
- 学年学期选项来自 `/xjtlu/xjtlu-base-academic-year-semester/getList`。
- 查询地址和字段来自 AMS 公开的学生端前端代码，已使用真实登录响应及学校原页核对课程、时间和教室。
- 课表显示 AMS 实际返回的日期范围，不推断其覆盖整个学期。
- 状态按 AMS 原始值展示：0 未标记、1 出勤、2 缺勤、3 获批请假，其他值显示未知。
- 网络或格式错误保留上次结果并标记刷新失败，避免把错误显示成没有课程。
- 使用本应用独立的持久化浏览器 session；不读取 Edge、Chrome 的 Cookie 或密码。
- 读取学校窗口中的认证 Token 仅用于固定的 HTTPS 课表接口；Token 不返回界面，不写日志。学校窗口关闭后仍可在本次运行中复用有效 Token。
- 学校网页关闭 Node 集成，启用沙箱与上下文隔离；请求使用 HTTPS。

学校会话位于 `%APPDATA%\XJTLU-MCP-AMS`。开启 eBridge 本机缓存时，课表、课程列表与考试安排会加密保存在同一目录。

已有 35 项 Node.js 检查通过，涵盖响应解析、公共账号管理、加密存储、自动提交限制、验证码暂停及 Module 百分比语义；TypeScript 检查和构建通过。Windows safeStorage 加密解密已使用虚构信息验证，真实 AMS 课表、当前学期课程列表与签到率已读取成功。实际密码重新登录和验证流程需在自然触发时继续观察。

## 源码结构与打包

- `src/main`：Electron 主进程及学校系统连接。
- `src/preload`：受限的桌面通信接口。
- `src/renderer`：React 聚合界面。
- `src/providers`、`src/shared`：来源解析、数据模型与课程匹配。
- `src/security`、`src/services`、`src/infrastructure`：登录限制、公共账号和加密存储。
- `tests`：解析与业务规则检查；`docs`：设计与早期开发记录。
- `releases`：版本说明；`.github/workflows/release.yml`：Windows 打包及 GitHub Release 发布。

Windows x64 本地执行 `npm run package:win`，复用已经安装的 Electron 运行时，生成 `dist/XJTLU-MCP-2.1.0-win-x64.zip` 和 `dist/SHA256SUMS.txt`。打包仅复制构建产物、生产依赖及运行时。已有同名输出时拒绝覆盖。

推送新的 `releases/` 版本说明到 `main` 后，GitHub Actions 会构建并上传 Windows 完整安装 EXE、完整解压 ZIP、Lite 更新 EXE 和校验文件。Release 标签指向该次源码提交。账号、学校 Cookie、调试目录、依赖、构建产物和导入的旧版工具不进入源码仓库。

## 技术资料

- [AMS 官方入口](https://ams.xjtlu.edu.cn/)
- [AMS 实测与实现记录](docs/ams-prototype.md)
- [完整开发方案](docs/development-plan.md)
