# Deploying Zenworld

The production stack runs the Go API, static frontend, SQLite storage, and Caddy
with automatic HTTPS. Only ports 80 and 443 are published. Application images
are built by GitHub Actions and published to GHCR for `linux/amd64`.

## 1. Publish the images

Push the project to the `main` branch. The `Publish container images` workflow
publishes:

- `ghcr.io/zumka1991/antigravityzen-backend:latest`
- `ghcr.io/zumka1991/antigravityzen-frontend:latest`

Make both packages public in their GitHub package settings. If they remain
private, log the VPS into GHCR once using a classic token with `read:packages`.

## 2. Point the domain to the VPS

In the REG.RU DNS editor, create these records:

- `A` record: `@` → the public IPv4 address of the VPS
- `A` record: `www` → the public IPv4 address of the VPS (optional)

Remove conflicting `A`/`AAAA` records. The default configuration serves
`zenworld.ru`; add `www.zenworld.ru` to `DOMAIN` only if it is also configured.

## 3. Prepare an Ubuntu/Debian VPS

From the project directory:

```bash
ssh root@SERVER_IP 'bash -s' < scripts/bootstrap-server.sh
```

The script installs Docker Compose and creates 1 GB of swap as emergency
headroom on a 1 GB VPS.

## 4. Deploy

```bash
DEPLOY_HOST=root@SERVER_IP ./scripts/deploy.sh
```

On the first deploy, the script generates and prints the `admin` password once.
Application data is stored in a Docker volume and survives redeployments.

Future deployments use the same command. The server only downloads the new
images and restarts the containers; it does not compile the application.

## Local container build

Build and run exactly the same stack locally:

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

For another installation directory:

```bash
DEPLOY_HOST=root@SERVER_IP DEPLOY_DIR=/srv/zenworld ./scripts/deploy.sh
```

## Operations

```bash
ssh root@SERVER_IP
cd /opt/zenworld
docker compose logs -f
docker compose ps
docker compose restart
```

Back up the persistent data:

```bash
docker run --rm \
  -v zenworld_backend_data:/data:ro \
  -v "$PWD":/backup \
  alpine tar -czf /backup/zenworld-data.tgz -C /data .
```
