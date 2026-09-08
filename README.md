# 项目控制中心

管理多个 Docker Compose 项目的清单、HTTP/TCP 健康、主机/容器资源、日志与受限 SSH 启停。

初始资产已包含同机 `192.168.101.130` 上的油品发货核销平台（5175）和 ProjectManager（5174）。数据库首次初始化只导入一次，后续启动不会覆盖页面修改。

## 本机启动

需要 **Node.js 24 LTS、pnpm 11.19.0**。系统默认 Node 14 不兼容。

```bash
pnpm install
cp .env.example .env
pnpm migrate
pnpm admin admin
pnpm dev
```

Windows PowerShell 使用 `Copy-Item .env.example .env`。管理员密码在终端输入，不回显；没有默认账号密码。页面地址为 `http://localhost:5176`，API 为 `127.0.0.1:3001`。必须使用与 `APP_ORIGIN` 完全一致的浏览器地址，包括协议和端口。

如果 Windows 使用 Codex 自带 Node，可在当前终端临时设置：

```powershell
$env:PATH = "C:\Users\KK\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;" + $env:PATH
```

## 功能

- 管理员、操作员、只读用户；服务端会话、CSRF 和来源校验、登录限流。
- CONTROL·DECK 深色遥测界面，项目搜索、状态筛选、三列卡片与四段接入表单。
- 项目编辑、独立内网/公网/TCP 检查、24h 响应趋势与样本可用率、事件流。
- 30 秒检查、5 秒网络超时、健康历史、连续失败和恢复事件。
- SSH 主机指纹固定、专用密钥文件引用、root 服务白名单、项目级互斥任务。
- VM CPU/内存/磁盘、容器 CPU/内存/状态/重启次数、按需读取脱敏日志。
- 维护模式、操作审计、HTTPS Webhook 投递与重试。
- SQLite 一致性备份、Docker 部署、容器健康检查。

运行状态来自 SSH，连接尚未配置时显示未知，启停按钮不可用；HTTP 异常不会直接改变容器运行状态。

## 检查

```bash
pnpm check
pnpm build
pnpm test
python -m unittest discover -s deploy/tests
```

真实 Docker 集成测试仅在专用 Linux 测试机运行，见 [验收文档](docs/acceptance.md)。不要拿现有业务执行停机测试。

## 文档

- [VM、Docker 与 Cloudflare 部署](docs/deployment.md)
- [SSH 白名单与项目接入](docs/ssh-setup.md)
- [备份、恢复、告警与故障排查](docs/operations.md)
- [架构、API 与数据定义](docs/architecture.md)
- [验收与测试边界](docs/acceptance.md)
- [视觉规范与数据口径](docs/design.md)
- [deck.kkhub.com.cn 实际部署记录](docs/production-deck.md)

部署前需填写控制中心域名、安装远程入口、核实 SSH 指纹并配置密钥。公网发布前完成权限和 Tunnel 验收。该项目不执行构建发布、数据库启停或任意远程 shell。
