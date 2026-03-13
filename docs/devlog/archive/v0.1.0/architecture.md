# v0.1.0 Architecture

## High-level architecture

- Frontend: React/Vite UI
- Backend: Go/Gin API gateway
- Analysis service: FastAPI wrapper around TradingAgents
- Agent engine: TradingAgents with LangGraph
- Persistence: PostgreSQL
- Cache/support: Redis
- Entry/reverse proxy: Nginx

## Collaboration pattern

- Frontend calls Go APIs.
- Go forwards analysis requests to Python.
- Python runs TradingAgents and returns task progress/results.
- Go persists task metadata and final decisions.
- Frontend polls Go for status and final output.

## Main architecture weakness

The system is already separated cleanly by language and role, but runtime task-state ownership is not yet stable.

