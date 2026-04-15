# v0.1.5 Architecture

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
- Local-only reference corpus: `.reference/` (ignored by Git)

## Collaboration pattern

- Frontend product traffic enters through Go.
- Go owns auth, profile, BYOK, feed, usage, admin, trading task persistence, trading task query, cancellation, resume, export, and health aggregation.
- Go writes task records to PostgreSQL, seeds runtime state, and enqueues analysis requests into Redis.
- Python trading service consumes queued requests and executes TradingAgents graph workflows.
- Python trading service writes runtime checkpoints, stage outputs, and usage events during execution.
- Go reconciles runtime state with durable task state and serves user-facing query/export endpoints.
- Go proxies market-data requests to the dedicated market-data service and normalizes the product-facing response surface.
- `.reference/` is outside tracked source control and only informs future design review.

## Main architecture improvements vs v0.1.4

- Public trading task ownership is clearer: Go remains the product API, while Python trading-service is internal runtime.
- Deprecated Python public task creation/config/delete endpoints are removed.
- Duplicate market-data endpoints are removed from `trading-service`; `market-data-service` remains the dedicated data surface.
- Legacy `articles` is removed; `feed` is the only content domain.
- Historical `langchain-v1/` experiments are removed from the main repository.
- TradingAgents CLI is removed after Web/API controls covered analyst selection, research depth, live stage tracking, and report export.
- Go/Python contract drift is constrained by `docs/devlog/appendix/api-contracts.md` and `scripts/check_api_contracts.py`.

## Main architecture weaknesses

- Required-stage failure semantics are still incomplete; partial checkpoints can exist before the future fail-closed contract lands.
- `analysis_report` remains partly dynamic JSON for compatibility.
- Signal, outcome, attribution, report memory, and evidence memory are not yet first-class product loops.
- OpenClaw still lacks `research_debate / risk_debate` multi-agent protocol support.
- `.reference/` is useful for design research but requires license and architecture-fit review before any adoption.
