# v0.1.2 Architecture

## High-level architecture

- Frontend: React/Vite UI
- Backend: Go/Gin API gateway and business-state owner
- Analysis runtime: Python FastAPI service running Redis worker loop
- Agent engine: TradingAgents with LangGraph async execution
- Persistence: PostgreSQL (durable business state)
- Runtime coordination/cache: Redis (queue, processing queue, runtime state, article cache, counters)
- Entry/reverse proxy: Nginx
- Local auxiliary runtime: OpenClaw gateway (frontend direct-connect MVP only)

## Collaboration pattern

- Frontend product flows still go through Go for auth, feed, chart, and trading APIs.
- Go creates task records, writes Redis runtime initial state, and enqueues analysis requests.
- Python worker consumes Redis queue payloads, runs TradingAgents, and writes runtime checkpoints/results.
- Go reconciles runtime state and persists terminal results back to PostgreSQL.
- Frontend polls Go for task progress and renders stage-centric results.
- Feed reads are now DB-first; refresh may trigger RSS ingest only when the last successful ingest is stale.
- OpenClaw Chat MVP is separate from the trading workflow path and connects directly from browser to local OpenClaw gateway.

## Main architecture improvements vs v0.1.1

- async LangGraph execution with parallel analyst fan-out
- stage checkpoints visible before task completion
- cancel/resume plus Redis queue cleanup
- provider-aware embedding routing for DashScope and Ollama
- article/feed path split into ingest layer and DB-backed read layer

## Main architecture weaknesses

- weakly typed cross-service payload regions remain
- Python public task APIs are still exposed
- OpenClaw integration is split:
  - workflow side uses a FinGOAT adapter concept
  - chat side uses direct browser-to-gateway connection
- production deployment assumptions are still too local-first in several places
