# FinGOAT Project Organization

This document is a practical map of the current repository structure and runtime flow.

## 1) System at a glance

FinGOAT is a multi-service, multi-agent trading system:

- `frontend` (React/Vite): user UI, login, article feeds, trading analysis panel
- `backend` (Go/Gin): auth, data APIs, task persistence, gateway to Python service
- `services/trading-service` (FastAPI): async analysis task API, wraps TradingAgents graph
- `services/market-data-service` (FastAPI): chart / quote / terminal internal service
- `services/python-common`: shared Python runtime modules
- `TradingAgents` (Python package): core multi-agent reasoning and graph logic
- `postgres` + `redis`: persistence and cache
- `nginx`: reverse proxy entry

## 2) Directory responsibilities

### Root

- `README.md` / `README-CN.md`: project overview and setup
- `docker-compose.yml`: full local stack orchestration
- `services/trading-service/Dockerfile`: Python trading service image
- `services/market-data-service/Dockerfile`: Python market-data service image
- `nginx/`: external reverse proxy config
- `k8s/`: Kubernetes manifests (deployment direction)

### Go gateway (`backend/`)

- `main.go`: init config, migrate DB, start Gin server
- `router/router.go`: route and auth middleware registration
- `controllers/trading_controller.go`: forward analysis requests to FastAPI, persist task+decision
- `models/trading_analysis.go`: `trading_analysis_tasks` and `trading_decisions` schema
- `config/`: Viper config, DB and Redis initialization

### Python services (`services/`)

- `trading-service/trading_service.py`: FastAPI endpoints, background execution, task state
- `trading-service/README.md`: service-level API and operational notes
- `trading-service/test_trading_service.py`: service tests (local)
- `market-data-service/market_data_service.py`: chart / quote / terminal API
- `python-common/marketdata/`: shared marketdata package
- `python-common/json_safety.py`: JSON serialization helper
- `python-common/usage_collector.py`: usage event collector

### Legacy playground (`langchain-v1/`)

- `app-langagents*` / `app-langgraph.py`: historical experiments
- `eval_results/`: sample output logs retained for comparison

### Agent core (`TradingAgents/`)

- `tradingagents/graph/`: graph setup/propagation/signal flow
- `tradingagents/agents/`: analyst/researcher/risk/trader roles
- `tradingagents/dataflows/`: market/news/fundamental provider adapters
- `default_config.py`: baseline LLM/data vendor config

### Frontend (`frontend/`)

- `src/App.tsx`: auth + dashboard shell
- `src/components/TradingAnalysis.tsx`: submit/poll/render analysis
- `src/services/tradingService.ts`: API wrapper
- `nginx.conf`: SPA static serving and in-container `/api` proxy

## 3) End-to-end request flow

1. User submits ticker/date in `frontend`.
2. Frontend calls `POST /api/trading/analyze` on Go backend.
3. Go backend forwards to `POST /api/v1/analyze` (FastAPI) and stores task metadata.
4. FastAPI runs `TradingAgentsGraph.propagate()` in background.
5. Frontend polls `GET /api/trading/analysis/{task_id}`.
6. Go backend fetches latest FastAPI status, writes final decision/report to PostgreSQL.
7. Frontend renders action/confidence/report JSON.

## 4) Ports and runtime services

- Nginx entry: `:80`
- Frontend container: `:8080` (mapped to container `:80`)
- Go backend: `:3000`
- Python trading service: `:8001`
- PostgreSQL: `:5432`
- Redis: `:6379`

## 5) Current organization gaps (recommended cleanup backlog)

### P0 (high impact)

- Clarify auth header contract:
  - `backend/TRADING_API.md` says `Authorization: Bearer <token>`
  - actual middleware parses raw token string from `Authorization`
  - choose one contract and align docs + frontend + middleware

- Replace in-memory task store in `services/trading-service/trading_service.py`:
  - `analysis_tasks` is process-local and non-durable
  - restarts lose in-flight state
  - recommend Redis-backed task state for production stability

### P1 (medium impact)

- Frontend docs were scaffold template (now replaced in `frontend/README.md`).
- Evaluate whether `langchain-v1/eval_results/` should remain tracked:
  - if for demos, move to `assets/examples/`
  - if generated outputs, ignore future artifacts

- Config consistency check:
  - `backend/config/config.yaml` defines timezone/sslmode
  - `backend/config/db.go` currently hardcodes `sslmode=disable` and `TimeZone=Asia/Shanghai`
  - either make hardcoded behavior explicit or consume YAML/env values fully

### P2 (nice to have)

- Add one `docs/` index and move operational docs (`TRADING_API.md`, deployment, service docs) under it.
- Add a single `make`/`task` entrypoint for local bring-up, lint, and smoke tests.

## 6) Suggested next step order

1. Fix auth header contract mismatch.
2. Persist FastAPI task status in Redis.
3. Normalize config source-of-truth (remove hardcoded DB options).
4. Consolidate docs into `docs/`.
