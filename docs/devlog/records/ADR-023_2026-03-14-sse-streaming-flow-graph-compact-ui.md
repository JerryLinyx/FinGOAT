---
id: ADR-023
kind: decision
title: SSE Streaming, Agent Flow Graph, and Compact UI
date: 2026-03-14
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# SSE Streaming, Agent Flow Graph, and Compact UI

## 1. Background

Three UX/architecture upgrades requested to improve live feedback and information density:
- True token-level streaming from LangGraph nodes to the frontend
- A visual DAG tab showing the agent pipeline with live execution state
- Compact single-row layouts for the processing indicator and decision card

## 2. Changes

### 2.1 LangGraph SSE Streaming (Full pipeline)

- **`TradingAgents/tradingagents/graph/trading_graph.py`**: Added `propagate_streaming()` async method using `astream_events(version="v2")`.
  - `on_chat_model_stream` events → `token_callback(stage_id, node, token)`
  - `on_chain_end` events → `stage_end_callback(stage_id, state_snapshot)`
  - `NODE_TO_STAGE` dict + `SKIP_NODES` frozenset defined at module level.
  - Key mapping: `"Research Manager" → "portfolio_manager"` (fills `investment_plan`, not `research_debate`).
- **`services/trading-service/trading_service.py`**: Streaming worker + Redis Streams bridge + SSE endpoint.
  - Worker publishes `{type: "token", stage_id, node, t}` and `{type: "stage_end", stage_id, data}` via `XADD trading:stream:{task_id}`.
  - `GET /api/v1/analysis/{task_id}/stream` serves `EventSourceResponse` consuming `XREAD BLOCK 500`.
  - `STREAM_KEY_PREFIX = "trading:stream"`, `STREAM_TTL_SECONDS = 3600`.
  - `sse-starlette>=1.6.1` added to `requirements.txt`.
- **Go backend — `backend/controllers/trading_controller.go`**: `StreamAnalysisResult()` SSE proxy handler.
  - Sets `X-Accel-Buffering: no` to disable Nginx buffering.
  - Uses `http.Flusher` to flush chunks to client.
- **Go backend — `backend/middlewares/auth_middleware.go`**: `AuthMiddleware` accepts `?token=<jwt>` query param fallback. Browser `EventSource` cannot send custom `Authorization` headers; JWT is appended as a query param on the frontend.
- **Go backend — `backend/router/router.go`**: Route registered: `GET /api/trading/analysis/:task_id/stream`.
- **Frontend — `frontend/src/services/tradingService.ts`**: `streamAnalysis(taskId, onEvent, token)` wraps `EventSource`; `getAuthToken()` reads JWT from `localStorage`.
- **Frontend — `frontend/src/components/TradingAnalysis.tsx`**: SSE `useEffect` connects when task is `pending`/`processing`; `stageTokens: Map<string, string>` state accumulates tokens per stage; passed as prop to `<AgentResultsModule>`.

### 2.2 Agent Flow Graph Tab

- **`frontend/src/components/AgentFlowGraph.tsx`** (new file): SVG DAG component.
  - 9 nodes: col 0 = 4 parallel analysts (rows 0–3), cols 1–5 = sequential pipeline (row 1.5).
  - `NODE_LAYOUT` constant + `EDGES` array + `nodePos()` / `edgePath()` / `edgeClass()` helpers.
  - Bezier curve edges; color driven by source/target node status.
  - Processing nodes: pulsing blue `flow-node__pulse` animation.
  - Completed edges: solid green; active edges: dashed blue `flow-edge--active` with dash-flow animation.
  - Accessible: `role="button"`, `aria-label`, keyboard Enter/Space support.
- **`frontend/src/components/AgentResultsModule.tsx`** (rewrite): added `viewMode: 'stages' | 'graph'` state and `.arm-tabs` tab bar.
  - "Stage List" tab: original layout with ReactMarkdown rendering.
  - "Flow Graph" tab: `<AgentFlowGraph>` + `.flow-detail-panel` for selected node detail.
  - `extractMarkdownText()` helper: extracts human-readable text from structured JSON content, checking priority keys (`summary`, `history`, `judge_decision`, `current_response`).
  - `stageTokens?: Map<string, string>` prop: live token buffer takes priority over completed stage content.

### 2.3 Compact UI

- **Processing indicator**: Replaced large centered `.processing-indicator` block with single-row `.processing-bar` (spinner + active stage label + elapsed time). Uses `.spinner--sm` (14px, 2px border).
- **Decision card**: Replaced 2-column grid with single-row flex — Decision · Action · Confidence · (optional) `⏱ {n}s`. Compressed to ≤ 50px height.
- **ReactMarkdown**: `react-markdown@^9` + `remark-gfm@^4` installed; stage content rendered as formatted Markdown with `.streaming-cursor` (blinking `▍`) while tokens are incoming.

## 3. Implementation Notes

- `astream_events` does **not** accept `stream_mode` parameter (unlike `astream`). Extract only the `config` key from `get_graph_args()` to avoid `TypeError`.
- Blocking `XREAD` in async FastAPI SSE generator: wrapped in `loop.run_in_executor(None, lambda lid=current_last_id: client.xread(...))`. Lambda default-captures `lid` to avoid closure variable mutation across iterations.
- Worker threading: `run_streaming_analysis()` uses `asyncio.run(_run_streaming_analysis_async())` pattern — consistent with existing `trading_graph.propagate()`.
- `process_analysis_payload` now calls `run_streaming_analysis` instead of `run_analysis` so all new task submissions use the streaming path.

## 4. Status

- [x] `trading_graph.py` — `propagate_streaming()` + `NODE_TO_STAGE` + `SKIP_NODES`
- [x] `trading_service.py` — streaming async worker + Redis Streams bridge + SSE endpoint
- [x] `requirements.txt` — `sse-starlette>=1.6.1`
- [x] Go — `StreamAnalysisResult` SSE proxy handler
- [x] Go — `GET /api/trading/analysis/:task_id/stream` route registered
- [x] Go — `AuthMiddleware` `?token=` query param fallback
- [x] `react-markdown` + `remark-gfm` installed (`frontend/package.json`)
- [x] `tradingService.ts` — `StreamEvent` interface + `streamAnalysis()` + `getAuthToken()`
- [x] `TradingAnalysis.tsx` — compact processing-bar + compact decision-card + SSE `useEffect` + `stageTokens` state
- [x] `AgentResultsModule.tsx` — Tabs + ReactMarkdown + `stageTokens` prop + `extractMarkdownText()`
- [x] `AgentFlowGraph.tsx` — new SVG DAG component
- [x] `TradingAnalysis.css` — processing-bar, spinner--sm, decision-card flex, arm-tabs, stage-markdown-content, streaming-cursor, flow-node/edge styles
- [x] TypeScript check — `npx tsc --noEmit` exit 0
