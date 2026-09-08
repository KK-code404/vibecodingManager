# SSH 受限入口

运行账号 `control-center` 不加入 Docker 组。所有请求通过 root 持有的 Python 入口，入口验证请求和 Compose 标签，只允许白名单服务。已有 `kkadmin` 仅用于初次部署配置。

## 在 VM 安装

针对本次 VM130 的固定部署目录，可运行已包含的安装脚本：

```bash
sudo bash /home/kkadmin/apps/vibecodingManager/deploy/install-vm130.sh
```

脚本生成专用密钥、安装 root 白名单和受限账号，检查 SSH 配置后 reload；不启停业务容器。已有不同的 SSH Match 配置会停止并要求审阅。其他主机或部署目录使用下面的手动流程。

先审阅 `deploy/remote-entry.py` 和 `deploy/projects.example.json`，确认项目名和服务一致。从项目根目录执行：

```bash
sudo useradd --create-home --shell /bin/sh control-center
sudo install -d -o root -g root -m 0755 /etc/vibecoding-manager
sudo install -o root -g root -m 0755 deploy/remote-entry.py /usr/local/sbin/vcm-remote
sudo install -o root -g root -m 0644 deploy/projects.example.json /etc/vibecoding-manager/projects.json
```

若账号已存在则跳过 useradd。专用账号不得另配密码或其他密钥登录。

通过 `sudo visudo -f /etc/sudoers.d/vibecoding-manager` 写入：

```sudoers
control-center ALL=(root) NOPASSWD: /usr/local/sbin/vcm-remote ""
```

末尾 `""` 限定命令不带任何参数。不要给予通配 sudo/docker 权限。

## 专用密钥

在控制中心部署目录生成独立密钥，不复用 kkadmin 私钥：

```bash
ssh-keygen -t ed25519 -f data/ssh/vm130 -N '' -C 'vibecoding-manager'
```

从 `data/ssh/vm130.pub` 复制公钥，在 VM 通过 root 创建 `/etc/vibecoding-manager/authorized_keys`，一行内容为：

```text
restrict,command="sudo -n /usr/local/sbin/vcm-remote" ssh-ed25519 公钥内容 vibecoding-manager
```

该文件 root:root，0644；专用账号不可写。用 `sudoedit /etc/ssh/sshd_config.d/60-vibecoding-manager.conf` 添加：

```text
Match User control-center
    AuthorizedKeysFile /etc/vibecoding-manager/authorized_keys
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    ForceCommand sudo -n /usr/local/sbin/vcm-remote
Match all
```

先运行 `sudo sshd -t` 检查配置，通过后再 `sudo systemctl reload ssh`。保留当前 kkadmin 会话以便排查。不要将这份 Match 配置应用于 kkadmin。

设置部署目录私钥权限：

```bash
sudo chown -R 1000:1000 data/ssh
chmod 700 data/ssh
chmod 400 data/ssh/vm130
```

## 固定主机指纹

通过可信 VM 控制台运行：

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

将其中完整 `SHA256:...` 填入页面主机设置；密钥引用填 `vm130`。后端优先使用 Ed25519 主机密钥。不要把 `ssh-keyscan` 的未经核验输出自动作为信任依据。

页面点击“验证连接”，应获得两个项目的容器状态。首次执行仅验证，不启停业务。

## 启停边界

- oilorder：停止 frontend → beat → worker → api；启动 api → 就绪检查 → worker → beat → frontend。
- projectmanager：只控制 project-manager，启动后检查 `http://127.0.0.1:5174/api/health`。
- db/redis 不执行写操作，启动前必须处于 running 且 Docker healthcheck 为 healthy。
- API 默认使用 Docker healthcheck。可以由 root 改为仅限可信内部地址的 HTTP readiness，但不能经过已停止的 frontend。
- 控制只针对已经存在的容器。缺失、多副本、标签不匹配会拒绝控制，需人工接入处理。
- 停止发送 SIGTERM 并等待，worker 最多 120 秒，其他服务每项最多 15 秒；不发送 SIGKILL。超时中止后续步骤并返回已完成列表。
- 远程项目锁防止重复执行；后端任务锁防止双击；连接中断后不自动重放。

更改白名单需 root 操作，同时更新页面服务映射。现有业务配置文件和卷不会被控制中心编辑或删除。
