# Task State Redesign

## Background

The current analysis task lifecycle is split across Go persistence and Python in-memory runtime state.

## Problem and impact

- Python uses an in-memory `analysis_tasks` dictionary.
- Service restart drops live task state.
- Multi-instance execution is not currently viable.
- Go must query Python for live task status, so the ownership model is unclear.

## Current state analysis

Confirmed from the repository:

- Go persists `TradingAnalysisTask` and `TradingDecision`.
- Python FastAPI creates and tracks task state internally.
- Frontend polls Go, and Go relays runtime status from Python.

## Options considered

### Option A

Keep Python as the primary task-state owner and make it more durable.

### Option B

Use PostgreSQL only for both runtime and final state.

### Option C

Use PostgreSQL for persistent truth and Redis for runtime coordination.

## Tradeoff comparison

### Option A

- Pros: minimal change to the current Python service model
- Cons: keeps business truth outside the main API boundary and weakens Go's role

### Option B

- Pros: simplest mental model, one storage system
- Cons: less suitable for high-frequency runtime status updates and coordination patterns

### Option C

- Pros: matches the lifecycle split between persistent business records and fast runtime state
- Cons: adds coordination complexity and requires clearer ownership rules

## Final decision

Use PostgreSQL as the persistent business truth and Redis as the runtime coordination layer.

## Implementation design

- Go receives task request and persists the initial task row.
- Go enqueues the task in Redis.
- Python worker consumes the task and updates runtime status in Redis.
- Python writes final result back through a controlled persistence path.
- Go serves task reads from PostgreSQL and, when unfinished, supplements with Redis runtime state.

## Testing and validation

- Go now generates `task_id`, persists `trading_analysis_tasks`, and enqueues the request into Redis.
- Python now consumes queued requests from Redis and persists runtime state in Redis instead of an in-process dictionary.
- Go task reads now combine PostgreSQL and Redis runtime state and persist terminal results back to PostgreSQL.
- Frontend polling remained compatible with the new `task_id / status / decision / analysis_report` response shape.
- Verified locally with:
  - `go test ./...` in `backend`
  - `python -m py_compile` for `langchain-v1/trading_service.py`
  - `npm run build` in `frontend`
  - live local API submission and polling against the refactored task lifecycle

Still pending:

- restart-resilience test across an in-flight live task
- concurrent task execution stress validation
- startup or scheduled reconciliation beyond request-driven reads

## Outcome and follow-up

Status: implemented for the main request lifecycle.

Remaining gap:

- reconciliation currently runs on task read/list/stats paths; a background sweeper is still optional future hardening
