#!/bin/bash
# Run on VM130: sudo bash /home/kkadmin/apps/vibecodingManager/deploy/install-vm130.sh
# Installs the restricted SSH endpoint; never starts or stops business containers.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run this installer with sudo.'; exit 1; }
project=/home/kkadmin/apps/vibecodingManager
test -f "$project/deploy/remote-entry.py"
test -f "$project/deploy/projects.example.json"
sshd -t
if ! id control-center >/dev/null 2>&1; then useradd --create-home --shell /bin/sh control-center; fi
install -d -o root -g root -m 0755 /etc/vibecoding-manager
install -o root -g root -m 0755 "$project/deploy/remote-entry.py" /usr/local/sbin/vcm-remote
if test ! -e /etc/vibecoding-manager/projects.json; then
  install -o root -g root -m 0644 "$project/deploy/projects.example.json" /etc/vibecoding-manager/projects.json
fi
install -d -o 1000 -g 1000 -m 0700 "$project/data/ssh"
if test ! -e "$project/data/ssh/vm130"; then
  runuser -u kkadmin -- ssh-keygen -q -t ed25519 -f "$project/data/ssh/vm130" -N '' -C vibecoding-manager
fi
chown 1000:1000 "$project/data/ssh/vm130" "$project/data/ssh/vm130.pub"
chmod 0400 "$project/data/ssh/vm130"
key=$(cat "$project/data/ssh/vm130.pub")
printf 'restrict,command="sudo -n /usr/local/sbin/vcm-remote" %s\n' "$key" > /etc/vibecoding-manager/authorized_keys
chown root:root /etc/vibecoding-manager/authorized_keys
chmod 0644 /etc/vibecoding-manager/authorized_keys
tmp=$(mktemp -d)
trap 'rm -f "$tmp/sudoers" "$tmp/sshd"; rmdir "$tmp"' EXIT
printf 'control-center ALL=(root) NOPASSWD: /usr/local/sbin/vcm-remote ""\n' > "$tmp/sudoers"
visudo -cf "$tmp/sudoers"
install -o root -g root -m 0440 "$tmp/sudoers" /etc/sudoers.d/vibecoding-manager
cat > "$tmp/sshd" <<'CONFIG'
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
CONFIG
target=/etc/ssh/sshd_config.d/60-vibecoding-manager.conf
if test -e "$target" && ! cmp -s "$tmp/sshd" "$target"; then
  echo 'Existing SSH configuration differs; review it before replacement.'; exit 1
fi
install -o root -g root -m 0644 "$tmp/sshd" "$target"
sshd -t
systemctl reload ssh
echo 'Restricted SSH endpoint installed. Existing business containers were not changed.'
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
