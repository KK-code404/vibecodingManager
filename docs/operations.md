# 运维

## 备份与恢复

运行中的 SQLite 使用一致性备份 API，禁止直接复制正在写入的 WAL 数据库。

```bash
docker compose exec control-center pnpm backup /app/data/backup-20260905.sqlite
docker compose cp control-center:/app/data/backup-20260905.sqlite ./backup-20260905.sqlite
```

备份文件不能已存在。将备份转存到 VM 之外；同盘备份不能覆盖磁盘损坏。SSH 私钥单独安全备份，Webhook 与域名配置单独保存。

恢复前停止控制中心并保留当前数据库及 WAL/SHM 文件。使用临时容器挂载 `vibecoding-manager_control-data` 卷，将当前三个文件移动到备份目录，再把一致性备份复制为 `control.sqlite`，UID 1000、权限 0600。不要将旧 WAL/SHM 与恢复后的数据库混用。重新启动后运行管理员恢复命令，清除旧会话；核对两项目清单和历史数据。

```bash
docker compose stop control-center
# 使用 docker run --rm -v vibecoding-manager_control-data:/data ... 执行经过核对的恢复
docker compose up -d
docker compose exec control-center pnpm admin admin
```

## 账号恢复

```bash
docker compose exec control-center pnpm admin admin
```

创建或恢复该管理员账号，禁用状态解除，相关旧会话失效。没有公网密码找回接口。非交互 CI 可通过短时环境变量 ADMIN_USERNAME/ADMIN_PASSWORD 注入，完成后移除，不写进 Compose 或仓库。

## 告警

在服务器 `.env` 中设置 `ALERT_WEBHOOK_URL=https://...`，重建容器环境后由管理员在告警设置开启。HTTPS POST JSON：

```json
{"eventId":1,"projectId":1,"project":"油品发货核销平台","kind":"internal","type":"failure","at":1788595000000}
```

`type` 为 failure/recovery，kind 为 internal/public/tcp。接收端以 eventId 去重，投递采用至少一次语义；首次失败后延迟 60 秒，第二次 120 秒，三次失败后停止。维护模式或通知未开启时，事件标记为 suppressed，不在以后补发。

原始检查第一次失败即标红；连续三次失败才发事件，连续两次成功恢复。每个检查项独立产生事件，因此同项目内网/TCP 同时异常可有两条通知。该实现只对健康检查变化告警，不基于日志关键字或 CPU 阈值自动启停。

外部服务应定时 GET 控制中心的 HTTPS `/api/health`，失败时通过该服务的独立渠道通知。该接口只返回存活状态，不包含资产。控制中心与业务同机时必须有这种独立监控才能覆盖整机断电。

## 故障排查

| 表现 | 排查 |
|---|---|
| 登录后仍回登录页 | APP_ORIGIN 协议/域名/端口、Secure Cookie、是否通过 HTTPS |
| 请求来源不匹配 | 浏览器地址必须等于 APP_ORIGIN；不要混用 localhost 与 127.0.0.1 |
| 内网正常、公网异常 | Tunnel 路由、Cloudflare 策略、域名、证书 |
| SSH 指纹失败 | 从可信控制台复核主机密钥；不要关闭校验 |
| 启停灰色 | 完成密钥挂载与连接验证，状态必须在90秒内有效 |
| 启动依赖不健康 | 由业务维护者检查 db/redis healthcheck，不自动重启数据库 |
| worker 退出超时 | 检查任务状态，确认后人工处理；控制中心不会强杀 |
| 任务结果待核对 | 查看最新容器状态和健康；解除不再需要的维护模式，不盲目重试 |
| 日志被截断 | 单次限制 500KB/1000 行；缩小查询服务，敏感内容仍需按权限保护 |
| SQLite 只读错误 | 检查卷 UID 1000 及磁盘空间 |

健康及资源明细保留 7 天，审计 90 天。单实例设计不支持多个后端同时挂同一 SQLite 卷；不支持多副本 Compose 服务的批量控制。
