---
id: ADR-041
kind: decision
title: 2026-03-21 Hard Cancel for Running Analysis
date: 2026-03-21
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# 2026-03-21 Hard Cancel for Running Analysis

## Summary

`Terminate` previously behaved as cooperative cancellation only:

- runtime state was flipped to `cancelled`
- queued payloads were removed from Redis
- but an already-running analysis continued inside the Python worker until the next safe checkpoint

This was especially visible with Ollama/local models, where a long-running request could keep generating after the user had already cancelled the task.

This change isolates each analysis run in a dedicated subprocess so cancellation can terminate the active worker process immediately instead of waiting for the current model call to return.

## What changed

### Worker execution model

- `process_analysis_payload(...)` no longer runs the analysis inline inside the long-lived worker thread.
- The worker now starts a dedicated subprocess per analysis payload.
- The parent worker thread polls task runtime state while the subprocess is alive.

### Cancellation behavior

- If runtime state becomes `cancelled`, the parent worker:
  1. calls `terminate()` on the analysis subprocess
  2. waits briefly for exit
  3. escalates to `kill()` if the subprocess refuses to stop

This closes the active model/tool process instead of only marking the task as cancelled in Redis/PostgreSQL.

### Failure handling

- If the subprocess exits with a non-zero exit code without an explicit cancellation state, the worker marks the task as failed with a subprocess-exit error.

### Test coverage

- Added a dedicated cancellation test to assert that a cancelled task terminates its running subprocess.
- Updated mock pipeline tests to stub `multiprocessing.Process` inline so the mock suite stays deterministic.

## Verification

- `python3 -m unittest discover -s services/trading-service/tests/mock_pipeline -p 'test_mock_analysis_pipeline.py'`
- `python3 -m unittest discover -s services/trading-service/tests/mock_pipeline -p 'test_analysis_cancellation.py'`
- `python3 -m unittest discover -s services/trading-service/tests/mock_pipeline -p 'test_key_injection.py'`
- `python3 -m unittest TradingAgents.tests.test_embedding_settings TradingAgents.tests.test_openai_tool_key_routing`
- `cd backend && go test ./...`

## Tradeoffs

- The worker now pays subprocess startup overhead for each task.
- In exchange, user cancellation semantics are much closer to what the UI promises: a cancelled Ollama/local run no longer keeps occupying the underlying model process until the next checkpoint.

## Residual Risks

- Cancellation is still coarse-grained at the subprocess level; partial in-memory state inside the killed child is intentionally discarded.
- Any future code path that bypasses `process_analysis_payload(...)` and runs analysis inline would also bypass hard-cancel behavior.
