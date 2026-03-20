# v0.1.4 Architecture

## High-level architecture

- Frontend: React/Vite UI
- Backend: Go/Gin API gateway and durable business-state owner
- Trading runtime: Python FastAPI service in `services/trading-service`
- Market data runtime: Python FastAPI service in `services/market-data-service`
- Shared Python support: `services/python-common`
- Agent engine: `TradingAgents`
- Persistence: PostgreSQL
- Runtime coordination/cache: Redis
- Entry/reverse proxy: Nginx
- Optional local auxiliary runtime: OpenClaw gateway / Ollama

## Collaboration pattern

- Frontend product traffic enters through Go.
- Go owns auth, profile, BYOK, feed, usage, admin, and trading task persistence.
- Go writes task records to PostgreSQL, seeds runtime state, and enqueues analysis requests into Redis.
- Python trading service consumes queued requests and executes TradingAgents graph workflows.
- Python trading service writes runtime checkpoints and usage events during execution.
- Go reconciles runtime state with durable task state and serves user-facing query endpoints.
- Go proxies market-data requests to the dedicated market-data service and normalizes the product-facing response surface.

## Main architecture improvements vs v0.1.2

- Python service code is no longer centered around `langchain-v1` as the active service root
- `trading-service` and `market-data-service` now have explicit directories and Dockerfiles
- `python-common` carries shared service support code instead of hiding it in the old mixed directory
- market-data concerns are separated from trading execution concerns
- devlog and release process are now traceable through ADRs, `current/`, and version archives

## Main architecture weaknesses

- Go remains the main product boundary, but a few service contracts still depend on weakly typed JSON blobs
- trading execution still depends on external LLM / embedding reachability that is not fully normalized for container defaults
- Ollama discovery is still local-host-biased and not container-aware by default
- feed ingest still has text-cleaning edge cases that leak into persistence
- OpenClaw runtime health is still partly local-first and not yet a production-grade boundary
