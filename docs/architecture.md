# 架构与接口

React/Vite 原生组件与内联 SVG → 同源 Fastify API → SQLite / 定时健康检查 / SSH forced command。

Node.js 24 内置 SQLite，WAL 模式。迁移版本记录在 migrations 表。初始版本创建 users、sessions、hosts、projects、checks、incidents、samples、tasks、audit、notifications、settings；初始资产只插入一次。

项目配置共享 Zod 校验位于 `packages/shared/src/index.ts`。密钥只存文件引用，密码使用 Argon2id，会话令牌仅以 SHA256 哈希存数据库。生产 Cookie Secure/HttpOnly/SameSite=Strict、8小时过期。

## 接口

除 `/api/health` 和 `/api/auth/login` 外全部需 Session。非 GET 请求必须提供正确 Origin 和 `X-CSRF-Token`，CSRF 值由 login/me 返回。错误为 `{message}`。

| 接口 | 权限/行为 |
|---|---|
| POST /api/auth/login | 用户名密码，返回 user/csrf 并设置 sid |
| GET /api/auth/me | 当前用户与 csrf |
| POST /api/auth/logout | 失效当前会话 |
| GET /api/projects | 全角色；配置、三种状态、最新检查 |
| GET /api/telemetry | 全角色；24h内网样本统计、96区间趋势、今日告警 |
| GET /api/events | 全角色；健康事件；操作事件仅管理员/操作员可见 |
| POST /api/projects/test | 管理员；校验草稿并执行只读HTTP/SSH测试，6次/分钟 |
| POST /api/projects、PUT /api/projects/:id | 管理员；新增或完整更新配置 |
| GET /api/projects/:id/history | 最近720个检查点 |
| POST /api/projects/:id/maintenance | 管理员/操作员；`{enabled:boolean}` |
| POST /api/projects/:id/actions | 管理员/操作员；`{action:start\|stop\|restart}`，202 `{taskId}` |
| GET /api/tasks、GET /api/tasks/:taskId | 管理员/操作员；任务及执行后容器状态 |
| GET /api/projects/:id/logs?service=api&lines=200 | 管理员/操作员；脱敏限长文本 |
| GET /api/hosts、GET /api/hosts/:id/history | 全角色；非管理员隐藏SSH敏感连接字段 |
| POST /api/hosts、PUT /api/hosts/:id | 管理员；完整配置 |
| POST /api/hosts/:id/verify | 管理员；只读验证并采集 |
| POST /api/hosts/collect | 管理员；立即采集所有已配置节点，4次/分钟 |
| GET/POST /api/users、PUT /api/users/:id | 管理员；创建/权限/禁用/重置密码 |
| GET /api/audit | 管理员；最近300条 |
| GET/PUT /api/alerts | 管理员；查询/开启通知，密钥不返回 |

HTTP 2xx 判成功，不跟随重定向。TCP 只测连接。DNS 解析后检查地址类别并固定连接到解析的 IP，阻止重绑定；公网检查拒绝私网，内网检查只允许登记主机且拒绝回环、链路本地、元数据网段。无密码的 HTTP/HTTPS 地址是唯一允许的探测 URL。

部署、健康、运行状态独立。超过90秒的运行数据返回 unknown，UI也标明过期。操作执行中使用维护模式抑制预期失败；正常停止后保留，正常启动后解除。操作失败恢复之前维护状态；中断任务标记 uncertain，不重放。

root 入口接收 stdin JSON，请求无法指定命令、文件路径或任意容器 ID。按 Compose project/service 标签找容器，核对一对一映射；root 白名单才是最终权限来源。专用账号不能写入口、白名单或 authorized_keys。

部署目录字段仅用于展示，控制不依赖可被业务账号改写的 Compose 文件。这避免了经 sudo 执行任意 Compose 配置的权限提升。
