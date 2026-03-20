---
id: ADR-012
kind: decision
title: Processing Checkpoints
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Processing Checkpoints

## Background

The stage-based frontend view had already been added, but stage content was still derived only from the final post-run state.

## Problem and impact

- Users could see stage cards while a task was `processing`, but those cards did not contain true mid-run outputs.
- Failed tasks often lost the most useful debugging context because only the terminal error remained.
- Recovery-oriented checkpointing needed a first concrete runtime representation before resume logic could be designed.

## Final decision

Persist partial `analysis_report` snapshots during graph execution so the existing polling UI can surface real intermediate stage outputs without introducing a new streaming protocol.

## Implementation design

- `TradingAgents/tradingagents/graph/trading_graph.py`
  - `propagate()` and `propagate_async()` now accept an optional `progress_callback`
  - when a callback is present, graph execution streams state chunks with `astream(...)` even outside debug mode
  - each streamed chunk is forwarded to the callback as a runtime checkpoint candidate
- `services/trading-service/trading_service.py`
  - added `update_processing_checkpoint(...)`
  - while a task is running, streamed state snapshots are converted into partial `analysis_report` payloads
  - changed `run_analysis()` to attach a progress callback and persist checkpointed `analysis_report` data during `processing`
  - retained final completion persistence unchanged
- existing frontend stage rendering required no protocol change because it already reads `analysis_report` during `processing`

## Testing and validation

Validated locally with:

```bash
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/graph/trading_graph.py /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/trading_service.py /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/tests/mock_pipeline/test_mock_analysis_pipeline.py
cd /Users/linyuxuan/workSpace/FinGOAT/services/trading-service && python -m unittest tests.mock_pipeline.test_mock_analysis_pipeline tests.mock_pipeline.test_redis_worker_client
```

Additional regression coverage:

- `tests.mock_pipeline.test_mock_analysis_pipeline` now verifies that a `processing` checkpoint containing partial stage output is persisted before final completion.

Live validation:

- restarted the local trading service with the latest code
- confirmed `/health` returned `200 OK`
- submitted a live task and confirmed checkpoint-shaped `analysis_report` data is persisted even before terminal failure

## Outcome and follow-up

Status: implemented.

Current boundary:

- runtime checkpoints now exist and are visible to the polling UI
- true resume-from-checkpoint execution is not implemented yet because the mainline graph does not yet skip already-completed stages based on checkpoint state
