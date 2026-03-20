---
id: ADR-032
kind: decision
title: 2026-03-19 — Chart Terminal Unification And Qwen3.5-Plus Validation
date: 2026-03-19
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# 2026-03-19 — Chart Terminal Unification And Qwen3.5-Plus Validation

## Summary

This pass addressed two related problems:

1. `Chart Terminal` behavior had diverged by market.
   - `US` chart flows were comparatively stable.
   - `A-share` flows had different service paths, different payload semantics, and different UI/runtime edge cases.
   - Fixes such as right-edge anchoring and left-drag pagination were therefore harder to make reliable across both markets.

2. We needed a real provider validation run for `DashScope / qwen3.5-plus`, specifically to verify that:
   - the analysis loop can execute real model calls
   - stage-level token counters and latency metrics are not mock-only
   - the current observability contract works during a live run

This record captures the requirements, implementation decisions, new bugs found during validation, and the follow-up work now required.

## Requirements

### Product / architecture

- Unify `US` and `A-share` chart terminal behavior behind a single market-data contract.
- Keep public routes unchanged:
  - `/api/trading/chart/:ticker`
  - `/api/trading/quote/:ticker`
  - `/api/trading/terminal/:ticker`
- Make the frontend consume one terminal protocol and one terminal shell.
- Keep market-specific differences limited to:
  - ticker validation
  - labels / placeholder copy
  - upstream data source selection

### Validation / observability

- Run a real `qwen3.5-plus` analysis request against DashScope.
- Confirm stage-level usage fields are populated in a live task:
  - `prompt_tokens`
  - `completion_tokens`
  - `total_tokens`
  - `llm_calls`
  - `failed_calls`
  - `latency_ms`

## Problems found before implementation

### 1. Chart terminal architecture had split by market

Observed state:

- `US` and `A-share` no longer behaved like the same product surface.
- The backend chart path had become bifurcated:
  - one side remained Go-heavy / Alpha Vantage-oriented
  - the other side depended on Python-internal terminal endpoints and A-share-specific assumptions
- The frontend terminal page still had residual market-specific logic in behavior-sensitive areas, even after previous A-share work.

Impact:

- UI defects reproduced in one market but not the other.
- Contract mismatches were easy to reintroduce.
- Terminal fixes had to be reasoned about twice.

### 2. Sync analysis debugging path was broken

During `qwen3.5-plus` validation, the direct debug endpoint:

- `POST /api/v1/analyze/sync`

failed immediately with:

- `asyncio.run() cannot be called from a running event loop`

Root cause:

- the FastAPI async handler directly called `run_analysis(...)`
- `run_analysis(...)` eventually enters `TradingAgentsGraph.propagate()`
- that path internally uses `asyncio.run(...)`
- therefore the sync debug endpoint nested an event loop inside FastAPI's running loop

Impact:

- real provider verification failed before the first stage could complete
- no token or latency stats could be produced from that path

### 3. Live `qwen3.5-plus` runs revealed prompt growth risk

After fixing the sync debug path and rerunning a real DashScope task, live stage counters showed unexpectedly large token usage even in early stages.

Observed runtime state during one real task:

- `market.total_tokens ≈ 66k`
- `social.total_tokens ≈ 68k`
- `news.total_tokens ≈ 65k`
- `fundamentals.total_tokens ≈ 66k`

Impact:

- analysis latency becomes very high even before later debate stages
- provider cost scales poorly
- the stage token pipeline is working, but it exposed a new optimization problem

## Options considered

### A. Keep chart endpoints inside the existing trading service

Pros:

- fewer containers
- fewer deployment changes

Cons:

- chart/quote/terminal remains co-located with long-running analysis worker concerns
- market-data contract remains less explicit
- frontend parity work still has to straddle analysis-oriented service boundaries

### B. Split chart terminal into a dedicated Python `market-data-service`

Pros:

- chart/quote/terminal get a dedicated service boundary
- `US` and `A-share` can be normalized behind one contract
- Go can become a true external gateway for both markets
- chart terminal traffic is separated from analysis worker responsibilities

Cons:

- one more service in Docker Compose
- one more healthcheck and deployment artifact
- small amount of proxy/config plumbing in Go

## Tradeoff decision

Chose **B** for chart terminal only.

Reasoning:

- the split was justified here because terminal behavior had already become effectively service-shaped
- `chart / quote / terminal` is a clean, bounded surface
- it gives the frontend a stable contract without also forcing analysis migration in the same pass
- analysis remains in `trading-service`; only terminal-related responsibilities moved

This is deliberately **not** a full migration of TradingAgents runtime into a new service. It is a scoped split for terminal data and contract unification.

## Implementation

### 1. Added standalone `market-data-service`

New artifacts:

- `services/market-data-service/market_data_service.py`
- `services/market-data-service/Dockerfile`
- `docker-compose.yml` service entry for `market-data-service`

Responsibilities:

- `GET /api/v1/chart`
- `GET /api/v1/quote`
- `GET /api/v1/terminal`

### 2. Unified market-data contract

Both `US` and `A-share` terminal responses now return the same shape:

- `chart`
- `indicators.ma`
- `indicators.macd`
- `sidebar.metrics`
- `sidebar.notices`
- `capabilities`
- `partial`
- `has_more_left`
- `oldest_date`
- `newest_date`
- `source`
- `fallback_used`
- `cache_status`
- `stale`
- `fetched_at`

### 3. Standardized source strategy by market

- `US`
  - primary: `Alpha Vantage`
  - fallback: `yfinance` for terminal history when Alpha Vantage full-history constraints block pagination
  - local MA/MACD now computed in the same service path

- `A-share`
  - primary: `yfinance`
  - `AKShare` / `EastMoney` were removed from the hot path for terminal stability
  - local MA/MACD computed in the same service path

### 4. Moved Go to a pure gateway role for terminal routes

Go changes:

- added `MARKET_DATA_SERVICE_URL`
- `/api/trading/chart|quote|terminal` now proxy to `market-data-service`
- `US` requests forward `X-Alpha-Vantage-Key`

### 5. Frontend terminal shell was further normalized

Frontend now relies on one market-agnostic terminal response model for:

- left-drag historical pagination via `before`
- right-edge whitespace clamping
- resize right-anchor behavior
- capability-driven rendering
- quote polling

Remaining market-specific frontend differences are limited to:

- input validation
- `US` / `A股` labels
- placeholder text

### 6. Fixed sync analysis debug endpoint for real provider validation

Changed:

- `POST /api/v1/analyze/sync`

Fix:

- offload `run_analysis(...)` with `await asyncio.to_thread(...)`

Result:

- real DashScope runs can now execute from the sync debug path without the event-loop nesting failure

## Validation

### Build / compile validation

Validated with:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/backend && go test ./...
cd /Users/linyuxuan/workSpace/FinGOAT/frontend && npm run build
python3 -m py_compile /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/trading_service.py
python3 -m py_compile /Users/linyuxuan/workSpace/FinGOAT/services/market-data-service/market_data_service.py
```

### Service validation

Confirmed:

- `market-data-service` healthy
- `backend -> market-data-service` connectivity healthy
- `US` terminal endpoint returns `200`
- `A-share` terminal endpoint returns `200`
- `before` pagination works for both markets

### Real `qwen3.5-plus` validation

Executed a real `DashScope / qwen3.5-plus` analysis run against:

- `ticker=AAPL`
- `market=us`

Observed:

- multiple successful `HTTP 200` calls to:
  - `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- live runtime state already contained non-null stage usage fields during processing

Example live counters observed from the runtime state:

- `market`
  - `prompt_tokens: 66247`
  - `completion_tokens: 519`
  - `total_tokens: 66766`
  - `llm_calls: 2`
  - `latency_ms: 13728`
- `social`
  - `prompt_tokens: 64353`
  - `completion_tokens: 3613`
  - `total_tokens: 67966`
  - `llm_calls: 2`
  - `latency_ms: 75594`
- `news`
  - `prompt_tokens: 64625`
  - `completion_tokens: 847`
  - `total_tokens: 65472`
  - `llm_calls: 2`
  - `latency_ms: 17233`
- `fundamentals`
  - `prompt_tokens: 65421`
  - `completion_tokens: 1006`
  - `total_tokens: 66427`
  - `llm_calls: 2`
  - `latency_ms: 19597`

Conclusion:

- stage-level token and latency counters are active in a real `qwen3.5-plus` run
- this is no longer only a mock or unit-test path

## New bugs / follow-up findings

### 1. Usage events are only flushed at task terminal state

Observed:

- stage usage is visible in runtime state during processing
- Redis usage event list `usage:events:<task_id>` remained empty while the task was still running

Interpretation:

- `UsageCollector.flush_to_redis()` still happens on task completion/failure/cancel only
- live task detail pages can show stage counters from in-memory/runtime aggregation
- but downstream persistence of raw usage events is still terminal-state-driven

Impact:

- long-running tasks have good runtime visibility but delayed event persistence
- if a process dies before terminal flush, event-level completeness remains at risk

### 2. Prompt/context size is now a clear production risk

The live `qwen3.5-plus` run showed that token growth is already extreme in early stages.

Impact:

- high latency
- high cost
- possible provider limit pressure later in the graph

This is now a tracked optimization requirement, not a theoretical concern.

### 3. DashScope embedding package is still absent in the container

Observed warning:

- `DashScopeEmbeddings unavailable, falling back to OpenAI-compatible embeddings: No module named 'dashscope'`

Impact:

- chart terminal is unaffected
- qwen chat validation still succeeded
- but provider-fidelity for DashScope embedding paths is still incomplete in this image

## Outcome

Status: implemented and partially validated live.

What is now true:

- chart terminal is structurally unified across `US` and `A-share`
- public chart routes still did not change
- Go now behaves as a proper terminal gateway
- `qwen3.5-plus` live analysis calls are confirmed to work
- stage-level token and latency counters are confirmed to populate in a real run
- the sync debug analysis path is no longer broken by nested event loops

## Follow-up / new requirements

### Immediate follow-up

- Flush usage events incrementally at stage checkpoints or on a timed interval, not only at terminal task completion
- Reduce prompt/context growth across analyst stages before treating `qwen3.5-plus` as production-ready default for long runs
- Finish one full terminal-state `qwen3.5-plus` run and confirm raw usage event persistence into Redis/PostgreSQL after completion

### Near-term product / engineering follow-up

- Decide whether `market-data-service` should remain chart-terminal-only or become the shared market-data boundary for analysis as well
- Add provider-fidelity cleanup for DashScope embedding dependencies so DashScope runs do not log misleading fallback warnings
- Revisit stage status semantics for parallel analysts so “pending/processing/completed” better reflects true parallel execution in the UI
