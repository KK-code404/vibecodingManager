# VM 部署

目标 VM：`192.168.101.130`，Ubuntu 26.04。控制中心域名：`https://deck.kkhub.com.cn`。前置：Docker Engine、Compose v2、Git，域名已在 Cloudflare 可配置。控制中心独立占用 5176，不更改业务 5174/5175。

## 1. 准备目录与配置

将本项目文件放在 `/home/kkadmin/apps/vibecodingManager`，运行下列命令前进入此目录：

```bash
mkdir -p data/ssh
cp deploy/deck.env.example .env
```

`.env` 中使用 `APP_ORIGIN=https://deck.kkhub.com.cn`。生产容器强制启用 Secure Cookie；其他开发端口配置由 Dockerfile 固定覆盖。已有部署请保留现有通知等配置，只修改 APP_ORIGIN。

SSH 私钥准备见 [SSH 接入](ssh-setup.md)。未配置 SSH 时可先使用清单和健康监控。

## 2. 构建与初始化

```bash
docker compose build
docker compose run --rm control-center pnpm migrate
docker compose run --rm control-center pnpm admin admin
docker compose up -d
docker compose ps
curl -f http://127.0.0.1:5176/api/health
```

`pnpm admin admin` 交互输入至少 12 位密码。管理员命令也用于恢复账号，修改密码后旧会话失效。初始化及升级均不会重置已保存的项目。

容器以 UID 1000 运行；SQLite 挂载 `control-data` 卷。数据库卷首次由镜像目录初始化权限。私钥文件 UID 应为 1000，文件权限 0400，目录 0700。容器只读根文件系统，只有数据库卷及临时目录可写，不挂载 Docker socket。

## 3. Cloudflare Tunnel

如果已有 cloudflared 在 VM 宿主机运行，为新域名添加独立路由：

```text
deck.kkhub.com.cn → http://127.0.0.1:5176
```

不要覆盖 `oilorder.kkhub.com.cn` 和 `pm.kkhub.com.cn`。Tunnel 提供入口，登录仍由控制中心负责。

如果 cloudflared 在容器中，容器内 `localhost` 是它自身。创建共同 Docker 网络并在双方 Compose 配置中声明 external network，路由使用 `http://control-center:8080`。不要为方便访问把 5176 开放到所有公网地址。

通过 HTTPS 域名验证：未登录只出现登录页；登录成功；项目可见；viewer 无法调用启停 API。浏览器控制台无 CSP 或请求来源错误。

## 4. 自启动与升级

Docker daemon 使用系统的 systemd 服务，控制中心采用 `restart: unless-stopped`，不额外使用 pm2。确认 Docker 随系统启动：

```bash
sudo systemctl enable docker
```

升级前执行一致性备份并记录当前镜像 ID。更新代码后执行 `docker compose build`、`docker compose up -d`，查看日志和健康状态。数据库迁移在启动时执行。回滚若涉及数据库版本，必须同时恢复升级前的备份，不应只换回旧镜像。

## 5. 当前接入前置

- 控制中心域名已确定为 deck.kkhub.com.cn，部署时添加独立 Tunnel 路由。
- root 安装受限 SSH 入口、确认 Compose 标签及 API/依赖容器健康检查。
- 通过可信 VM 控制台获得 SSH SHA256 指纹，不能自动信任首次扫描结果。
- 项目一 API 内部 8000 不对宿主机发布；默认使用 API Docker healthcheck 判断启动就绪。如没有该检查，先由业务维护者补齐，控制中心不会自动修改业务 Compose。
- 公网发布和真实业务停机测试需要在实际环境完成，见验收文档。
