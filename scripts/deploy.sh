#!/usr/bin/env bash
set -Eeuo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST, for example root@203.0.113.10}"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/zenworld}"
DOMAIN="${DOMAIN:-zenworld.ru}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! ssh "$DEPLOY_HOST" "docker compose version >/dev/null 2>&1"; then
  echo "Docker Compose is not installed on ${DEPLOY_HOST}." >&2
  echo "First run: ssh ${DEPLOY_HOST} 'bash -s' < scripts/bootstrap-server.sh" >&2
  exit 1
fi

echo "Uploading application to ${DEPLOY_HOST}:${DEPLOY_DIR}..."
tar \
  --exclude=.git \
  --exclude=.env \
  --exclude=.env.production \
  --exclude=.idea \
  --exclude='*.bak' \
  --exclude=backend/server \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=data \
  -C "$ROOT_DIR" -czf - . \
  | ssh "$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR' && tar -xzf - -C '$DEPLOY_DIR'"

ssh "$DEPLOY_HOST" "DEPLOY_DIR='$DEPLOY_DIR' DOMAIN='$DOMAIN' bash -s" <<'REMOTE'
set -Eeuo pipefail
cd "$DEPLOY_DIR"

if [[ ! -f .env ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 32 | tr -d '\n')"
  {
    printf 'DOMAIN=%s\n' "$DOMAIN"
    printf 'ADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD"
    printf 'TZ=Asia/Barnaul\n'
    printf 'GHCR_OWNER=zumka1991\n'
    printf 'IMAGE_TAG=latest\n'
  } > .env
  chmod 600 .env
  printf '\nAdmin login: admin\nAdmin password: %s\nSave it now; it will not be shown again.\n\n' "$ADMIN_PASSWORD"
else
  sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env
fi

docker compose pull
docker compose up -d --remove-orphans --wait --wait-timeout 180
docker image prune -f
docker compose ps
REMOTE

echo "Deployment finished: https://${DOMAIN}"
