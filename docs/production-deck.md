# deck.kkhub.com.cn 部署记录

2026-09-06 已在 Ubuntu VM `192.168.101.130` 完成部署。

- 访问地址：`https://deck.kkhub.com.cn`
- 目录：`/home/kkadmin/apps/vibecodingManager`
- Compose 项目：`vibecoding-manager`
- 容器：`vibecoding-manager-control-center-1`
- 端口：`127.0.0.1:5176 → 8080`，由现有宿主机 Cloudflare Tunnel 接入。
- 自启动：`restart: unless-stopped`；容器健康状态为 healthy。
- 数据：独立 `control-data` 卷，已有业务端口和容器未修改。
- 初始管理员：`admin`，随机密码保存在 VM 的 `/home/kkadmin/deck-initial-admin.txt`（0600）；密码不写入本文或 Git。首次登录后在设置中修改密码并删除临时凭据文件。
- 受限账号：`control-center`，不属于 Docker 组；密钥只读挂载，root 白名单仅允许应用服务。

## 已完成验证

通过真实公网地址使用 Playwright 验证登录、退出和两个项目的展示：页面 HTTP 200，匿名资产 API 401，会话 Cookie 为 Secure、HttpOnly、SameSite=Strict，无页面脚本错误。

油品发货核销平台与 ProjectManager 的内网、公网 HTTP 均为 200，TCP 探测成功，SSH 实测均为 running。真实资源采集及服务映射已接入，未执行业务停止/重启测试。

## 本次部署修正

首次 Node 基础镜像下载较慢，完成后已进入 Docker 缓存。统一 `.npmrc` 与锁文件的包地址为官方 npm 源，保留 pnpm 的锁文件和完整性校验，解决容器构建中的 tarball URL 不一致错误；依赖版本及完整性摘要未改动。

## 日常维护

2026-09-08 已上线黑白主题切换：侧栏底部和登录页右上角提供“白色模式”开关，浏览器记住选择。构建、隔离环境的登录/弹窗/主题测试及公网切换验证通过。本次仅更新控制中心前端，保留原镜像 `vibecoding-manager-control-center:before-theme-20260908` 以便回滚。

在部署目录运行 `docker compose ps` 查看状态，`docker compose logs --tail=100 control-center` 查看服务日志。升级、备份和恢复流程见 `deployment.md` 与 `operations.md`。账号恢复运行 `docker compose exec control-center pnpm admin admin`。
