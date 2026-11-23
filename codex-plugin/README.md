# XJTLU-MCP · Codex 本机插件

适用于与 XJTLU-MCP 运行在同一台 Windows 电脑上的 Codex。插件通过本机 MCP 服务使用全部 16 个工具。

1. 打开 XJTLU-MCP。在「Agent 连接」开启服务，在 ChatGPT 卡片点击「安装」。插件版本随工作台版本同步。
2. 完全退出并重开 ChatGPT，然后开启一个本地 Codex 会话。输入 `/mcp`，或直接问「用 XJTLU-MCP 检查连接状态，再查今天的课表」。

安装时，应用会登记本机插件目录、调用 Codex 安装并完成配对。Codex 插件清单只指定共享环境变量 `XJTLU_MCP_TOKEN`，供 Codex 启动时读取。旧插件可通过「重新安装」切换到该变量，重置密钥后也可点击此按钮重新配对。使用期间保持 XJTLU-MCP 运行，学校登录和预约确认在该应用内完成。

「Agent 连接」页显示安装状态、插件目录和访问密钥配对结果。可点击「刷新状态」重新检查，或点击「打开插件页」在 ChatGPT 查看详情。

XJTLU-MCP 随应用提供插件清单。单独的插件 ZIP 可作为本机 Marketplace 源码归档。

如果安装成功但 Codex 握手返回 HTTP 502，检查代理是否转发了本机请求。使用环境变量配置代理时，把 `127.0.0.1,localhost` 加到现有 `NO_PROXY` 列表，再重启 Codex。

点击 ChatGPT 卡片里的「卸载」即可移除插件，也可在 Codex 插件页卸载。
