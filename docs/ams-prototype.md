# AMS 最小原型记录

日期：2026-11-02。首个数据源改为 AMS，以验证独立应用的登录与只读查询。

## 已观察到的事实

- 学校公开学生指南列出 AMS 地址为 `https://ams.xjtlu.edu.cn/`。
- 官方网站进入学生端路径 `/studentpc/checkIn`。
- 本机现有 Edge 能进入该页面，但显示「The account is invalid. Please log in again.」，没有取得真实课表。
- 公开资源 `/studentpc/static/js/app.js` 中，Axios 请求携带 `X-Token`，值来自学校网页 localStorage 的 `Token` 字段。响应 `code: 0` 表示成功，`401` 表示认证失败。
- 公开课表资源 `/studentpc/static/js/chunk-021751fc.js` 调用 `GET /xjtlu-base-student-timetables/getStudentTimetable`；响应 data 为按 date 分组的数组，每组包含 timetableVoList。
- 课程字段有 moduleCode、moduleTitle、moduleDate、moduleTime、room、moduleTypeGroup、status。界面把 1、2、3 分别展示为 Present、Absent、Authorized Absence。
- 当前官方前端的 API baseURL 使用 HTTP。本原型固定通过同主机 HTTPS 地址查询，也把学校页面的 AMS HTTP 请求升级为 HTTPS，不关闭浏览器安全检查。

接口字段最初来自学校公开代码的静态检查，现已完成首次真实登录和课表核对。接口长期稳定性仍需持续观察。

## 原型验收

- [x] TypeScript 检查与生产构建通过。
- [x] 22 项接口、加密存储和填入目标限制测试通过；使用 Node.js 内置测试工具。
- [x] npm audit 未报告已知依赖漏洞。
- [x] 已阻止启动命令自动下载缺失的 Electron 运行时，安装由用户操作。
- [x] Electron 45.2.1 运行时安装完整，应用窗口与 React 界面正常显示。
- [x] preload/IPC 正常连接，可从应用打开独立的西浦认证窗口。
- [x] 应用独立窗口能完成学校登录，由用户在官方页面操作。
- [x] 2026-11-02 首次查询得到三个日期共八节课，当天四节课的名称、时间、教室与官方页一致；出勤按返回的原始标记展示。
- [x] 2026-11-03 重启后复用有效会话，查询得到 11-03、11-04、11-05 三个日期共八节课。
- [x] 关闭学校窗口后再次读取成功，界面更新时间从 10:09:47 变为 10:11:37（北京时间）。
- [ ] 失效凭证、断网、格式变化分别显示正确状态。
- [ ] 清除本机登录后，不再展示前一个账号的数据。

人工登录及二次验证由用户在学校页面完成。按用户后续要求加入可选的本机加密账号密码保存，不导入现有浏览器凭证。

用户已完成 Electron 运行时安装及首次真实登录。启动、IPC 与真实课表读取验证通过。

Windows 启动测试中已修正窗口隐藏的问题：交互应用使用可见方式启动，并在界面加载完成后显式显示主窗口。

## 可选密码保存（2026-11-03）

- 使用 Electron 45 的异步 safeStorage API；虚构数据的 Windows 实际加密、解密测试通过。
- 账号与密码加密后才写入用户数据目录，保存操作原子替换；加密不可用时不写文件。
- IPC 仅返回是否已保存、账号和状态，不提供解密密码的读取接口。
- 只在 `https://uim.xjtlu.edu.cn/esc-sso/login/page` 的已验证表单尝试填入；主进程和隔离脚本分别检查目标。
- 页面已有其他账号或密码时保留原输入；不提交登录，不处理验证码或二次验证。
- 更新、删除及清除操作会取消尚未执行的填入；删除与保存串行，避免删除后被延迟保存恢复。
- 已验证设置弹窗的显示与取消。尚未使用用户真实保存密码完成端到端重新登录测试。
- 关闭学校窗口后，在本次进程内保留有效认证 Token，减少不必要的重新登录。

## 参考来源

- [学校学生指南](https://www.xjtlu.edu.cn/wp-content/uploads/2025/07/XJTLU-Student-Development-Advisor-2526-CN.pdf)
- [AMS 官方入口](https://ams.xjtlu.edu.cn/)
- [Electron session](https://www.electronjs.org/docs/latest/api/session)
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)

## 聚合首页、自动登录与 Module（v0.2，2026-11-03）

- 首页增加「账号与登录」「AMS 出勤」同级入口，学校账号由公共 AccountService 管理，AMS 为其消费者。
- 断开 AMS 只清除该服务会话，保留公共账号；切换学校账号时清理旧账号的 AMS 数据。
- 后台恢复会话；需要密码时自动填入并点击 UIM 原始登录按钮。检测到验证码或二次验证时显示官方窗口；密码错误停止自动重试。
- 账号密码表单和 Sign in 按钮的容器类名来自公开的 UIM `accountPsw.js`。提交经过隔离上下文、来源双重检查与每次连接的提交限制。
- 读取 `GET /xjtlu/stuapi/my-module/list?type=1&academicYear=...&semester=...`，采用响应中的 `vos`、`moudleTitle`、`courseAttendance` 和 `comprehensiveAttendance`。
- 学年、学期选项来自 `GET /xjtlu/xjtlu-base-academic-year-semester/getList?type=1/2`；默认值来自当前 AMS 会话中 userInfo 的对应字段。
- 保留学校语义：courseAttendance 为 0 且 absences 为 0 时显示暂无统计，有缺勤时保留 0%。
- 已成功读取真实当前学期的课程列表、单课签到率及总体签到率。35 项检查与构建通过；实际凭据自动重新登录、验证页面仍待自然触发观察。

本节是 v0.2 的当前行为，替代上文 v0.1 中“只填入、不点击登录”及密码管理位于 AMS 内的旧说明。

## 首页单节签到来源修正（2026-11-17）

- 首页课程继续来自 eBridge；签到状态改用 AMS → Module → 对应课程 → Detail 的记录。
- 先通过 Module 课程列表确认课程属于所选学年学期，再查询 `GET /xjtlu/stuapi/my-module/recordList`。参数与官方详情页相同：`moduleCode`、`academicYear`、`semester`、`date`、`moduleTypeGroup`、`status` 和分页参数。
- 返回 `data.list`、`data.total`，逐页读取。单行 `date` 包含课堂日期和时段，另有 `moduleTypeGroup`、`status`、`statusName`、`signTime`。
- 状态采用 Module 原始语义：0 Pending、1 Present、2 Absent、3 Authorized Absence、4 Excluded。签到时间只在 Present 时展示。
- 仅查询 eBridge 今天有课的课程；按日期、课程、开始时间和教学组核对，兼容课间十分钟差异。缺少记录或无法唯一匹配时不推断缺勤，读取失败保留上次 Module 结果并提示。
- 实际只读核对：当天 1 门课程、1 条单节考勤记录，匹配成功，来源状态为 Present。首页近期课表的状态不再作为签到来源，也不作为失败回退值。
