---
id: ADR-037
kind: decision
title: 2026-03-19 — Stage Usage And Token Visibility
date: 2026-03-19
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# 2026-03-19 — Stage Usage And Token Visibility

## Summary

Reviewed the current token-usage pipeline and confirmed that usage was previously collected at per-node event granularity, but not promoted into the stage-centric task response that the analysis UI consumes. As a result, users could see stage duration but not stage token usage.

This change promotes stage-level token aggregation into the runtime/report contract and surfaces it in the analysis UI.

## What changed

### Usage collection and aggregation

- Added stage-level usage aggregation in Python `UsageCollector`.
- Mapped `node_name -> stage_id` for all default TradingAgents analyst/debate nodes.
- Included stage usage in `analysis_report.__stage_usage` and each `__stages[]` item:
  - `prompt_tokens`
  - `completion_tokens`
  - `total_tokens`
  - `llm_calls`
  - `failed_calls`
  - `latency_ms`

### Runtime/task response

- Extended Go runtime parsing so canonical `stages` returned to the frontend preserve the new usage fields.
- Extended `/api/usage/tasks/:task_id` to also return `by_stage` usage aggregation derived from persisted node events.

### Frontend analysis UI

- Extended `AnalysisStage` / `StageProgress` with stage-level usage fields.
- Updated `AgentResultsModule` to show:
  - duration
  - total token count
  - input/output token split
  - LLM call count
  - failed call count
  - accumulated model latency

## Verification

- `python -m py_compile services/trading-service/trading_service.py services/python-common/usage_collector.py`
- `cd backend && go test ./...`
- `cd frontend && npm run build`
- `cd services/trading-service && python -m unittest tests.mock_pipeline.test_mock_analysis_pipeline`

## Findings

- Before this change, token usage did **not** reliably reach each frontend stage/analyst card, even though usage events were already captured in Redis/PostgreSQL.
- Default TradingAgents execution now has stage-level token visibility in the main report/UI.
- OpenClaw-backed top-level analyst stages still do not emit stage token usage. Their duration/status still appear, but token counts require a follow-up change in the OpenClaw gateway/adapter contract.
