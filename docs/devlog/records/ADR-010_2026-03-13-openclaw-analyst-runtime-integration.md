---
id: ADR-010
kind: decision
title: 2026-03-13 OpenClaw Analyst Runtime Integration
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# 2026-03-13 OpenClaw Analyst Runtime Integration

- Status: implemented
- Scope: `backend`, `langchain-v1`, `TradingAgents`, `frontend`, `openclaw-gateway`

## Completed Requirements

1. Added `execution_mode` to the trading analysis request/response path.
   - Supported values: `default`, `openclaw`.
   - Go now persists `execution_mode` on `trading_analysis_tasks`.
   - Python runtime state also stores `execution_mode`.

2. Preserved the existing LangGraph trading workflow and only switched the four top-level analyst implementations.
   - `market`
   - `social`
   - `news`
   - `fundamentals`

3. Added a standalone `openclaw-gateway` service boundary.
   - `POST /internal/openclaw/agents/ensure`
   - `POST /internal/openclaw/stages/run`
   - `GET /internal/openclaw/agents/status/:user_id`
   - `GET /health`

4. Added per-user analyst registry/bootstrap behavior in the gateway.
   - Stable analyst ids are derived from `user_id + analyst_kind`.
   - Gateway persists registry metadata under `openclaw-gateway/state/registry.json`.
   - Gateway creates per-user workspaces and per-agent state roots.

5. Added a stage-centric task response contract.
   - Python now emits canonical `stages`.
   - `analysis_report` still exists, but now carries transitional `__stages`.
   - Go responses expose `stages`.
   - Frontend stage rendering now prefers `stages` and only falls back to legacy `analysis_report` parsing.

6. Added OpenClaw dependency visibility to health checks.
   - Python `/health` includes `openclaw_gateway`.
   - Go `/api/trading/health` includes direct gateway reachability.

## Implementation Notes

- LangGraph remains the task orchestrator for:
  - analyst fan-out / join
  - downstream debate / trader / risk stages
  - processing checkpoints
  - cancel / resume

- In `openclaw` mode, the four top-level analyst nodes no longer use the local tool-node loop.
  - They call the OpenClaw gateway directly.
  - The node response is written back into the shared state as the same report fields the downstream workflow already expects.

- OpenClaw stage metadata is stored in flat runtime keys and rehydrated into `stages`.
  - backend
  - agent id
  - session key
  - raw output
  - started/completed timestamps
  - summary

## Validation

- `python -m py_compile services/trading-service/trading_service.py TradingAgents/tradingagents/openclaw/adapter.py TradingAgents/tradingagents/graph/setup.py TradingAgents/tradingagents/graph/trading_graph.py TradingAgents/tradingagents/default_config.py`
- `python -m unittest tests.mock_pipeline.test_mock_analysis_pipeline tests.mock_pipeline.test_openclaw_stage_contract`
- `go test ./...` in `backend`
- `npm run build` in `frontend`
- `node --check openclaw-gateway/server.mjs`

## Known Follow-up

- The local `openclaw` repo currently appears source-only in this workspace.
  - `openclaw-gateway` will start and report health.
  - Actual OpenClaw analyst runs will stay degraded until the OpenClaw runtime dependencies/build artifacts are available.
  - This is surfaced explicitly through gateway health instead of silently falling back.
