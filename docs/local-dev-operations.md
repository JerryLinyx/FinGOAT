# Local Dev Operations

## Start Commands

### Stateful services

Start PostgreSQL:

```bash
docker start fingoat-pg
```

Start Redis:

```bash
docker start fingoat-redis
```

### Backend

Start the Go backend from [backend](/Users/linyuxuan/workSpace/FinGOAT/backend):

```bash
/bin/zsh -lc 'JWT_SECRET=dev-jwt-secret BYOK_ENCRYPTION_KEY=txtTm8zhoJiVIORkqMJtpGpTWRn6n97Q7nhrcoOugYw= ALPHA_VANTAGE_API_KEY=H0GNP3632K0DHMZZ go run .'
```

### Trading Service

Start the Python trading service from [langchain-v1](/Users/linyuxuan/workSpace/FinGOAT/langchain-v1):

```bash
/bin/zsh -lc 'ALPHA_VANTAGE_API_KEY=H0GNP3632K0DHMZZ ./.venv/bin/uvicorn trading_service:app --host 0.0.0.0 --port 8001'
```

### Frontend

Start the Vite dev server from [frontend](/Users/linyuxuan/workSpace/FinGOAT/frontend):

```bash
npm run dev
```

## Stop Commands

### Backend

Find the PID listening on port `3000`:

```bash
lsof -ti tcp:3000
```

Stop it:

```bash
kill <PID>
```

### Trading Service

Find the PID listening on port `8001`:

```bash
lsof -ti tcp:8001
```

Stop it:

```bash
kill <PID>
```

### Frontend

Find the PID listening on port `5173`:

```bash
lsof -ti tcp:5173
```

Stop it:

```bash
kill <PID>
```

### Stateful services

Stop PostgreSQL:

```bash
docker stop fingoat-pg
```

Stop Redis:

```bash
docker stop fingoat-redis
```

## Health Checks

Backend:

```bash
curl -s http://localhost:3000/api/health
```

Trading service:

```bash
curl -s http://localhost:8001/health
```

Frontend:

Open [http://localhost:5173/](http://localhost:5173/).
