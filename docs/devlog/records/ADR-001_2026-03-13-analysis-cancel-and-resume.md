---
id: ADR-001
kind: decision
title: Analysis Cancel And Resume
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Analysis Cancel And Resume

## Background

The analysis flow had become recoverable enough to expose partial checkpoints, but users still had no control to stop a long-running task or restart it from the app after a cancellation/failure.

## Problem and impact

- long-running analyses could only be left running or abandoned
- users had no explicit terminate control when a task was clearly not worth waiting for
- after a failure or manual stop, there was no first-class continue action in the UI
- logging out and coming back preserved visibility, but not active task control

## Final decision

Implement a minimum viable task-control model:

- `terminate` = cooperative cancellation
- `continue` = requeue the same stored analysis request with the same `task_id`

This is intentionally not full checkpoint resume. It restarts execution with the stored request/config while preserving the product-level control flow and history visibility.

## Implementation design

- `backend/controllers/trading_controller.go`
  - added `CancelAnalysis`
  - added `ResumeAnalysis`
  - cancel marks task/runtime as `cancelled`
  - resume reloads stored task config, resets task status, and re-enqueues the request
- `backend/controllers/trading_runtime.go`
  - extended runtime state with `cancel_requested`
  - added task-config unmarshalling helper for resume
  - added Redis queue helpers to:
    - identify `task_id` from queued payloads
    - remove all matching payloads from `trading:analysis:queue`
    - remove all matching payloads from `trading:analysis:processing`
    - deduplicate queue entries before re-enqueueing the same `task_id`
- `backend/router/router.go`
  - added:
    - `POST /api/trading/analysis/:task_id/cancel`
    - `POST /api/trading/analysis/:task_id/resume`
- `services/trading-service/trading_service.py`
  - added `cancelled` task status
  - worker now checks runtime state before starting and at progress checkpoints
  - cancellation raises a dedicated cooperative cancellation path instead of surfacing as a generic failure
- `frontend/src/services/tradingService.ts`
  - added cancel/resume service methods
  - extended task status union with `cancelled`
- `frontend/src/components/TradingAnalysis.tsx`
  - added `Terminate` action for `pending/processing`
  - added `Continue` action for `failed/cancelled`
  - added `cancelled` terminal-state handling in the UI
  - active-task persistence now clears on `cancelled`

Queue cleanup hardening added after live validation exposed stale Redis payloads:

- cancelling a task now removes its payloads from both Redis queue lists
- resuming a task first clears any stale queue/process entries for that `task_id`
- enqueueing the same `task_id` again now deduplicates pending queue entries before `LPUSH`
- this prevents:
  - cancelled tasks staying queued
  - the same task appearing in both `queue` and `processing`
  - repeated `resume` actions creating duplicate payloads

## Testing and validation

Validated locally with:

```bash
cd /Users/linyuxuan/workSpace/FinGOAT/backend && go test ./...
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/services/trading-service/trading_service.py
cd /Users/linyuxuan/workSpace/FinGOAT/frontend && npm run build
```

Live validation:

- restarted the Python trading service with the latest code
- restarted the Go backend with the latest code
- created a real analysis task through the Go API:
  - `4e2437b3-d864-4111-951a-463102291b12`
- issued a real cancel request
  - task state returned `cancelled`
  - partial checkpoint data remained visible
- issued a real resume request
  - task re-entered `pending` then `processing`
  - later runtime showed fresh progress in debate/plan stages
- after the queue-cleanup fix, cancelled the same live task again:
  - `4e2437b3-d864-4111-951a-463102291b12`
  - Redis `trading:analysis:processing` dropped from `1` to `0`
  - the task payload disappeared from both queue lists
- inspected remaining queued payloads and confirmed they were only cancelled-task residue
- manually cleared the residual Redis queue once, then verified:
  - `LLEN trading:analysis:queue = 0`
  - `LLEN trading:analysis:processing = 0`
  - PostgreSQL had no remaining `processing` tasks

## Outcome and follow-up

Status: implemented.

Important scope note:

- `continue` currently means requeue/restart with the same stored request
- it does not yet resume from an internal graph checkpoint
- true stage-level resume remains a separate future requirement
