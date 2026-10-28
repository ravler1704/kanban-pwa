#!/usr/bin/env bash
# One-time server provisioning (Ubuntu). Safe to re-run.
# Usage (from the project root): ./deploy.sh --setup
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> System packages"
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg rsync ufw \
  debian-keyring debian-archive-keyring apt-transport-https

echo "==> Node.js 24"
if ! node -v 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -q nodejs
fi

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

echo "==> App user and directories"
id kanban >/dev/null 2>&1 || useradd --system --home-dir /opt/kanban --shell /usr/sbin/nologin kanban
mkdir -p /opt/kanban/deploy /var/lib/kanban
chown kanban:kanban /var/lib/kanban
chmod 750 /var/lib/kanban

echo "==> Swap (1 GB) for low-memory hosts"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Done"
