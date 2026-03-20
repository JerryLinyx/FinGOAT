# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FinGOAT (Financial Graph-Orchestrated Agentic Trading) is a polyglot monorepo with three independent services coordinated via Docker Compose:

- **frontend/** — React 19 + Vite SPA (TypeScript)
- **backend/** — Go (Gin + GORM + PostgreSQL + Redis)
- **services/trading-service/** — FastAPI trading worker service
- **services/market-data-service/** — FastAPI market-data service
- **services/python-common/** — shared Python runtime modules
- **TradingAgents/** — Core LangGraph multi-agent reasoning package (Python)

## Development Commands

### Full Stack (Docker Compose)
```bash
docker-compose up --build          # Start all services
docker-compose up -d               # Start detached
docker-compose logs -f backend     # Tail a specific service
docker-compose down                # Stop and remove containers
```

### Frontend (Node/React)
```bash
cd frontend
npm install
npm run dev       # Dev server (Vite)
npm run build     # TypeScript compile + Vite build
npm run lint      # ESLint
npm run preview   # Preview production build
```

### Backend (Go)
```bash
cd backend
go mod download
go run main.go              # Start with config from config/config.yaml
go build -o fingoat .       # Build binary
go test ./...               # Run all tests
go test ./controllers/...   # Run tests in a specific package
```

### Python Services
```bash
# Trading Agent Service
cd services/trading-service
pip install -r ../python-common/requirements.txt
uvicorn trading_service:app --host 0.0.0.0 --port 8001 --reload  # Dev
uvicorn trading_service:app --host 0.0.0.0 --port 8001           # Prod

# Market Data Service
cd ../market-data-service
uvicorn market_data_service:app --host 0.0.0.0 --port 8002 --reload

# TradingAgents package
cd TradingAgents
pip install -e .
```

## Architecture

### Request Flow
```
Browser → Nginx (:80) → Go Backend (:3000) → FastAPI (:8001) → TradingAgents
                                  ↕                    ↕
                            PostgreSQL             Redis (task state)
```

1. User submits ticker/date in React frontend
2. `POST /api/trading/analyze` hits Go backend, which forwards to `POST /api/v1/analyze` on FastAPI
3. FastAPI stores task metadata in Redis and spawns a background worker
4. Worker executes `TradingAgentsGraph.propagate()` (multi-agent LangGraph pipeline)
5. Frontend polls `GET /api/trading/analysis/{task_id}` for status/results
6. Go backend fetches state from FastAPI and persists to PostgreSQL
7. Final result: BUY/SELL/HOLD decision + confidence + full analysis report

### Go Backend Structure (`backend/`)
- `main.go` — Config init, DB migration, router start
- `config/` — Viper config loading, DB (GORM/PostgreSQL), Redis init
- `router/router.go` — Route registration (public vs auth-required)
- `controllers/` — HTTP handlers: `trading`, `articles`, `auth`, `user`
- `models/` — GORM models: `User`, `Article`, `TradingAnalysisTask`, `TradingDecision`
- `middlewares/` — JWT auth middleware

### Python Agent Structure (`TradingAgents/tradingagents/`)
- `graph/` — LangGraph setup (`trading_graph.py`, `signal_processing.py`)
- `agents/` — Agent roles: analysts, researchers, managers, risk_mgmt, trader
- `dataflows/` — Data providers: yfinance, alpha_vantage, news APIs, local cache
- `default_config.py` — LLM provider, model, timeout, temperature, debate rounds

### Trading Worker (`services/trading-service/trading_service.py`)
- Redis-backed async worker for task execution
- Endpoints: `/health`, `/api/v1/analyze` (async), `/api/v1/analysis/{task_id}` (poll), `/api/v1/analyze/sync`

### Market Data Service (`services/market-data-service/market_data_service.py`)
- Internal chart / quote / terminal aggregation service
- Endpoints: `/health`, `/api/v1/chart`, `/api/v1/quote`, `/api/v1/terminal`

### Nginx (`nginx/default.conf`)
- `/api/` → Go backend (:3000)
- `/trading/` → FastAPI (:8001)
- `/` → React frontend (:8080)

## Key API Endpoints

All trading endpoints require JWT `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/auth/register` | Register |
| POST | `/api/trading/analyze` | Submit analysis task |
| GET | `/api/trading/analysis/:task_id` | Poll result |
| GET | `/api/trading/analyses` | List user's analyses |
| GET | `/api/trading/chart/:ticker` | Stock chart data |

## Environment Configuration

The Go backend uses Viper with `backend/config/config.yaml`. The FastAPI service uses `services/trading-service/.env` (copy from `.env.trading`).

Key env variables for the Python service:
- `LLM_PROVIDER` — `openai`, `anthropic`, `google`, `deepseek`, `ollama`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.
- `REDIS_URL` — Redis connection string
- `BACKEND_URL` — Go backend URL for callbacks

## Known Issues (from PROJECT_ORGANIZATION.md)
- **P0:** Auth header contract mismatch between Go backend and FastAPI (Bearer vs raw token)
- **P0:** In-memory task store in FastAPI is non-durable — Redis backing is recommended
- **P1:** Config inconsistency: some DB options are hardcoded instead of using Viper YAML
