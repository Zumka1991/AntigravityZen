# Deploying Zenworld

The production stack runs the Go API, static frontend, and PostgreSQL 17 behind
the shared VPS Caddy entrance (`/opt/edge`) with automatic HTTPS. Only ports 80
and 443 on the shared `edge` proxy are public; the backend (`zenworld-backend`)
and frontend (`zenworld-frontend`) join the `edge` Docker network while
PostgreSQL stays on the private `app` network. Application images are built by
GitHub Actions and published to GHCR for `linux/amd64`.

## Local development

### Native macOS PostgreSQL (without Docker)

Install and start PostgreSQL:

```bash
brew install postgresql@17
brew services start postgresql@17
```

Create the local role and database once:

```bash
PGBIN="$(brew --prefix postgresql@17)/bin"
"$PGBIN/psql" -d postgres -c \
  "CREATE ROLE meditation LOGIN PASSWORD 'meditation'"
"$PGBIN/createdb" -O meditation meditation
```

The backend's default development URL is
`postgres://meditation:meditation@localhost:5432/meditation?sslmode=disable`,
so only the required admin password needs to be supplied:

```bash
cd backend
ADMIN_PASSWORD=local-admin go run .
```

The local Homebrew service can be controlled with:

```bash
brew services list
brew services stop postgresql@17
brew services start postgresql@17
```

### Docker development

Copy the environment template and choose strong local passwords:

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d postgres
```

PostgreSQL is then available only on localhost port 5432. Run the backend from
another terminal:

```bash
cd backend
ADMIN_PASSWORD=local-admin \
DATABASE_URL='postgres://meditation:YOUR_POSTGRES_PASSWORD@localhost:5432/meditation?sslmode=disable' \
go run .
```

Or build and run the complete stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Production deploy

1. Push `main` to publish the backend and frontend images to GHCR.
2. Point the domain's `A` records (`@` and `www`) at the VPS (`191.215.45.93`).
3. If preparing a fresh Ubuntu/Debian VPS without Docker:

```bash
ssh root@191.215.45.93 'bash -s' < scripts/bootstrap-server.sh
```

4. Deploy (installs `/opt/zenworld`, starts containers, writes `/opt/edge/sites/zenworld.ru.caddy`, and reloads the shared `edge` Caddy):

```bash
./scripts/deploy.sh
```

The first deploy generates independent admin and PostgreSQL passwords in the
server-side `/opt/zenworld/.env`. PostgreSQL is reachable only through the
private Compose network in production.

### Existing SQLite production data

Keep the existing `zenworld_backend_data` volume in place. On the first start
with PostgreSQL, the backend automatically imports `/data/meditation.db` in one
transaction. After success it renames the source to
`/data/meditation.db.migrated`. If import fails, startup stops and the original
SQLite file remains available for recovery.

Before migration, `scripts/deploy.sh` stops the old SQLite backend and creates a
full safety archive under `/opt/zenworld/backups/`. Do not remove that archive
until the checks below pass.

Check the migration before deleting any old backup:

```bash
ssh root@SERVER_IP
cd /opt/zenworld
docker compose logs backend
docker compose exec postgres psql -U meditation -d meditation -c '\dt'
```

## Operations

```bash
cd /opt/zenworld
docker compose logs -f
docker compose ps
docker compose restart
```

Create a PostgreSQL backup:

```bash
docker compose exec -T postgres \
  pg_dump -U meditation -d meditation -Fc > zenworld-postgres.dump
```

Restore into an empty database:

```bash
docker compose exec -T postgres \
  pg_restore -U meditation -d meditation --clean --if-exists < zenworld-postgres.dump
```

The `backend_data` volume still stores uploaded recordings and the one-time
SQLite migration backup. The `postgres_data` volume stores the live database.
