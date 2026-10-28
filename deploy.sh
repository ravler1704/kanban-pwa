#!/usr/bin/env bash
# Builds the client locally and uploads the app to the server over SSH (rsync).
#
#   ./deploy.sh           deploy current local code
#   ./deploy.sh --setup   provision the server first (Node.js, Caddy, firewall), then deploy
#
# Overridable via env: DEPLOY_HOST (ssh alias), DEPLOY_DOMAIN, DEPLOY_IP.
set -euo pipefail
cd "$(dirname "$0")"

HOST="${DEPLOY_HOST:-kanban}"
SERVER_IP="${DEPLOY_IP:-178.83.123.195}"
DOMAIN="${DEPLOY_DOMAIN:-${SERVER_IP//./-}.sslip.io}"
APP_DIR=/opt/kanban

if [[ "${1:-}" == "--setup" ]]; then
  echo "==> Provisioning $HOST"
  ssh "$HOST" 'bash -s' < deploy/setup-server.sh
fi

echo "==> Building client"
npm run build --silent

echo "==> Uploading to $HOST:$APP_DIR"
ssh "$HOST" "mkdir -p $APP_DIR/server $APP_DIR/client/dist $APP_DIR/deploy"
rsync -az --delete --exclude node_modules --exclude data server/ "$HOST:$APP_DIR/server/"
rsync -az --delete client/dist/ "$HOST:$APP_DIR/client/dist/"
rsync -az --delete --exclude kanban.env deploy/ "$HOST:$APP_DIR/deploy/"

# Server settings (Google sign-in) live outside the app directory, readable only by root and the service.
if [[ -f deploy/kanban.env ]]; then
  echo "==> Uploading settings from deploy/kanban.env"
  ssh "$HOST" "install -d -m 750 -g kanban /etc/kanban && cat > /etc/kanban/env && chgrp kanban /etc/kanban/env && chmod 640 /etc/kanban/env" < deploy/kanban.env
fi

echo "==> Installing dependencies and restarting"
ssh "$HOST" "APP_DIR=$APP_DIR DOMAIN=$DOMAIN SERVER_IP=$SERVER_IP bash -s" <<'REMOTE'
set -euo pipefail
cd "$APP_DIR/server"
npm install --omit=dev --no-audit --no-fund --no-package-lock --loglevel=error

install -m 644 "$APP_DIR/deploy/kanban.service" /etc/systemd/system/kanban.service
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__SERVER_IP__/$SERVER_IP/g" \
  "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --quiet kanban caddy
systemctl restart kanban
systemctl reload caddy || systemctl restart caddy

for i in $(seq 1 20); do
  curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1 && break
  sleep 0.5
done
systemctl is-active --quiet kanban || { journalctl -u kanban -n 30 --no-pager; exit 1; }
REMOTE

echo "==> Deployed: https://$DOMAIN"
