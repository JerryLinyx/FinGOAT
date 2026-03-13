# v0.1.1 Architecture

## High-level architecture

- Frontend: React/Vite UI
- Backend: Go/Gin API gateway and task lifecycle owner
- Analysis runtime: Python FastAPI service running Redis worker loop
- Agent engine: TradingAgents with LangGraph
- Persistence: PostgreSQL (durable business state)
- Runtime coordination/cache: Redis (queue, processing queue, runtime state, cache counters)
- Entry/reverse proxy: Nginx

## Collaboration pattern

- Frontend calls Go APIs only for product flows.
- Go creates task records and enqueues analysis requests into Redis.
- Python worker consumes Redis queue, runs TradingAgents, and writes runtime checkpoints/results to Redis.
- Go reads runtime state during polling and reconciles terminal state back to PostgreSQL decisions/tasks.
- Frontend polls Go for status/result and renders stage-level visibility.

## Main architecture weakness

The runtime layering is now clearer, but contract and boundary hardening is still incomplete:

- weakly typed cross-service payload regions remain
- Python task APIs are still exposed though not needed as external product endpoints
