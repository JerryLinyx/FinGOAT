---
id: ADR-017
kind: decision
title: Stage Timing And Stage View
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: [ADR-037]
---

# Stage Timing And Stage View

## Background

The reviewed `origin/dev_gq2142` branch contained stronger transparency around agent execution, including stage timing metadata and a stage-based frontend presentation.

## Problem and impact

- Mainline analysis responses only exposed the final decision and a raw `analysis_report`.
- The frontend had no stage-oriented presentation, so users could not quickly inspect which analyst or manager produced which output.
- Agent workflow execution was opaque, which made debugging and trust-building harder.

## Final decision

Selectively absorb the safe transparency improvements from the branch without replacing the current mainline graph workflow.

## Implementation design

- Keep the current sequential debate workflow intact.
- Add timing instrumentation to existing graph nodes so the runtime state records per-node start/end markers.
- Derive stage-level durations from those markers in `services/trading-service/trading_service.py`.
- Embed transparency metadata into `analysis_report`:
  - `__stage_times`
  - `__key_outputs`
  - `__total_elapsed`
- Add a lightweight frontend stage view based on the current mainline task shape rather than copying the branch UI wholesale.

## Agent workflow optimization absorbed

The branch was referenced for workflow optimization, but only the low-risk pieces were adopted:

- node-level timing instrumentation
- stage-oriented output extraction
- stage-based UI rendering

Deferred:

- whole-graph workflow replacement
- valuation-analyst insertion
- broader structured output contract changes across all agents

## Additional frontend follow-up absorbed

After the first stage-view rollout, several UX gaps were closed in the same area:

- active in-progress analyses are now persisted locally by `task_id`, so logging out and back in no longer drops the current analysis context
- `Recent Analyses` items are now clickable, allowing users to reopen historical task details
- a return action was added so users can jump back from a historical task into the recent-analyses list
- placeholder navigation shells such as `Markets / Portfolio / History` and the related placeholder messaging were removed from the main app
- a polling-state regression was fixed so intermediate `analysis_report` content does not disappear when a later polling frame temporarily omits the report payload for the same `task_id`

Implementation details:

- `frontend/src/components/TradingAnalysis.tsx`
  - persists/restores active task ids through local storage
  - preserves the previous `analysis_report` for the same task when a later polling frame arrives without report content
  - supports opening tasks from the recent-analysis list and returning back to that list
- `frontend/src/App.tsx`
  - removes dead-end placeholder navigation entries and related placeholder copy
- `frontend/src/TradingAnalysis.css`
  - adds supporting styles for the history-navigation flow

## Testing and validation

Validated locally with:

```bash
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/graph/setup.py /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/trading_service.py /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/tests/mock_pipeline/test_mock_analysis_pipeline.py
python -m unittest tests.mock_pipeline.test_mock_analysis_pipeline
cd /Users/linyuxuan/workSpace/FinGOAT/frontend && npm run build
```

Observed result:

- mock pipeline test passed
- stage metadata extraction test passed
- frontend build passed

## Outcome and follow-up

Status: implemented.

Current behavior:

- mainline analysis responses now include stage timing and key output metadata inside `analysis_report`
- the frontend now renders a stage-based view for pending, processing, completed, failed, and cancelled tasks when report content exists
- stage/results visibility survives logout/login and transient polling payload gaps
- historical analysis details can be reopened directly from the recent-analysis list

Remaining gap:

- a live end-to-end regression run is still needed to verify the stage metadata on a real analysis task after restart
