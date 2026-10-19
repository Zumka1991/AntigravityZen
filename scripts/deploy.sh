#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-root@191.215.45.93}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/zenworld}"
DOMAIN="${DOMAIN:-zenworld.ru}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! ssh "$DEPLOY_HOST" "docker compose version >/dev/null 2>&1"; then
  echo "Docker Compose is not installed on ${DEPLOY_HOST}." >&2
  echo "First run: ssh ${DEPLOY_HOST} 'bash -s' < scripts/bootstrap-server.sh" >&2
  exit 1
fi

echo "Uploading application to ${DEPLOY_HOST}:${DEPLOY_DIR}..."
COPYFILE_DISABLE=1 tar \
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
  POSTGRES_PASSWORD="$(openssl rand -hex 32)"
  {
    printf 'DOMAIN=%s\n' "$DOMAIN"
    printf 'ADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD"
    printf 'POSTGRES_DB=meditation\n'
    printf 'POSTGRES_USER=meditation\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
    printf 'TZ=Asia/Barnaul\n'
    printf 'GHCR_OWNER=zumka1991\n'
    printf 'IMAGE_TAG=latest\n'
  } > .env
  chmod 600 .env
  printf '\nAdmin login: admin\nAdmin password: %s\nSave it now; it will not be shown again.\n\n' "$ADMIN_PASSWORD"
else
  sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env
  if ! grep -q '^POSTGRES_PASSWORD=' .env; then
    {
      printf 'POSTGRES_DB=meditation\n'
      printf 'POSTGRES_USER=meditation\n'
      printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    } >> .env
  fi
fi

docker network inspect edge >/dev/null 2>&1 || docker network create edge

SQLITE_VOLUME=zenworld_backend_data
if docker volume inspect "$SQLITE_VOLUME" >/dev/null 2>&1 \
  && docker run --rm -v "$SQLITE_VOLUME:/data:ro" alpine test -f /data/meditation.db; then
  echo "Legacy SQLite database found; stopping the old backend and creating a safety backup..."
  docker compose stop backend || true
  mkdir -p "$DEPLOY_DIR/backups"
  BACKUP_NAME="sqlite-before-postgres-$(date -u +%Y%m%dT%H%M%SZ).tgz"
  docker run --rm \
    -v "$SQLITE_VOLUME:/data:ro" \
    -v "$DEPLOY_DIR/backups:/backup" \
    alpine tar -czf "/backup/$BACKUP_NAME" -C /data .
  chmod 600 "$DEPLOY_DIR/backups/$BACKUP_NAME"
  echo "SQLite safety backup: $DEPLOY_DIR/backups/$BACKUP_NAME"
fi

docker compose pull
docker compose up -d --remove-orphans --wait --wait-timeout 180

if [[ -d /opt/edge/sites ]]; then
  install -m 0644 "$DEPLOY_DIR/Caddyfile" "/opt/edge/sites/${DOMAIN}.caddy"
  docker compose -f /opt/edge/compose.yaml exec -T caddy caddy validate --config /etc/caddy/Caddyfile
  docker compose -f /opt/edge/compose.yaml exec -T caddy caddy reload --config /etc/caddy/Caddyfile
fi

docker image prune -f
docker compose ps
REMOTE

echo "Deployment finished: https://${DOMAIN}"
