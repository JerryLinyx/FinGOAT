# Local Dev Operations

## Default Startup

Start the full stack from the repository root:

```bash
docker compose up --build
```

This is the default local development path. It builds and starts nginx, frontend, backend, trading service, PostgreSQL, and Redis together.

To run in the background:

```bash
docker compose up -d --build
```

## Stop Commands

Stop the compose stack:

```bash
docker compose down
```

Stop the compose stack and remove volumes:

```bash
docker compose down -v
```

## Logs

Tail all services:

```bash
docker compose logs -f
```

Tail a single service:

```bash
docker compose logs -f backend
```

Useful service names:

- `nginx`
- `frontend`
- `backend`
- `trading-service`
- `postgres`
- `redis`

## Health Checks

App entry:

Open [http://localhost](http://localhost).

Go backend:

```bash
curl -s http://localhost/api/health
```

Trading service via Go gateway:

```bash
curl -s http://localhost/api/trading/health
```

## Component-Only Debugging

Manual per-service startup is now an exception path for isolated debugging only. The source of truth for local startup is still root-level `docker compose up --build`.
