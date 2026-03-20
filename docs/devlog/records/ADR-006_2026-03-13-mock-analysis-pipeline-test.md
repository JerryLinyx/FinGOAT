---
id: ADR-006
kind: decision
title: Mock Analysis Pipeline Test
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Mock Analysis Pipeline Test

## Background

Recent live end-to-end validation exposed provider and serialization issues, but those runs still depended on real LLMs, real data vendors, Redis timing, and local Python environment health.

## Problem and impact

- There was no stable regression test for the task lifecycle itself.
- A failure in model routing, vendor APIs, or scientific Python dependencies could mask whether the queue -> worker -> persistence -> query path was actually correct.
- Local debugging therefore mixed infrastructure failures with business-logic failures.

## Final decision

Add a no-network mock pipeline testcase that simulates TradingAgents input/output and validates the async task lifecycle in isolation.

## Implementation design

- Extract single-payload worker handling into `process_analysis_payload()` inside `services/trading-service/trading_service.py`.
- Add a dedicated test folder at `services/trading-service/tests/mock_pipeline/`.
- Use fixture JSON files to simulate:
  - graph state output
  - final decision output
- Inject fake `tradingagents.*` modules before importing `trading_service` so the test does not import the real TradingAgents dependency tree.
- Replace Redis with an in-memory fake implementation and replace the worker thread with a no-op fake thread.
- Use FastAPI `TestClient` to validate:
  - `POST /api/v1/analyze`
  - queue payload creation
  - manual payload processing
  - `GET /api/v1/analysis/{task_id}` returns `completed`

## Testing and validation

Validated locally with:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/services/trading-service
python -m unittest tests.mock_pipeline.test_mock_analysis_pipeline
```

Observed result:

- test passed with status `OK`
- task progressed from `pending` to `completed`
- decision payload and `analysis_report` were returned through the API shape
- no real model endpoint, Redis server, or market/news vendor was required

## Outcome and follow-up

This test now provides a deterministic baseline for debugging the FinGOAT task lifecycle before reintroducing live provider and vendor dependencies.
