# 豆包电脑版接入

使用豆包的「本地电脑」模式连接同一台 Windows 电脑上的 XJTLU-MCP。校园工作台和豆包电脑版即可完成配对。

1. 在工作台打开「Agent 连接」，确认本机连接已开启。
2. 在「豆包」卡片点击「在豆包中配置」。工作台会请求打开豆包插件页并复制服务地址。在豆包选择「添加」→「新建自定义连接器」。已有同地址的 `xjtlu` 或 `XJTLU-MCP` 时，可在「管理 → 连接器」启用或编辑原条目。[豆包电脑版入口示例](https://aikuaikuai.com/guide/doubao)
3. 在表单中将名称填为 `XJTLU-MCP`，传输类型选 `HTTP`。把已复制的地址粘贴到服务器 URL。默认地址是 `http://127.0.0.1:39527/mcp`，也可通过「复制服务地址」重新复制。
4. 在自定义 Headers 中新增 `Authorization`。点击工作台的「复制授权值」，把完整的 `Bearer …` 粘贴到值一栏。保存并启用连接器。[本机 HTTP 和 Bearer 填写示例](https://eidograph-docs.metaphorprojects.link/agents/doubao)
5. 在豆包的本地电脑会话中，让它调用 XJTLU-MCP 的 `get_connection_status`。以实际工具调用和返回状态为准。学校连接状态由校园工作台管理。

重置访问密钥后编辑原连接器，替换 `Authorization` 的值即可。需要撤下时，在豆包连接器管理中停用或移除 `XJTLU-MCP`。工作台可收起到系统托盘，退出工作台会停止本机服务。

## 验证状态

工作台生产构建通过。使用虚构密钥验证了复制出的服务地址和 `Authorization` 值，可以发现 16 项工具并调用 `get_connection_status`。现有工作台端口已确认在线。豆包客户端中的配对和实际工具调用待核对。
