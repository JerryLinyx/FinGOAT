# Redis PostgreSQL Boundary

## Background

Redis is currently present in the system but mostly used for article caching and like counters. PostgreSQL already stores core business entities.

## Problem and impact

Redis is underused, while PostgreSQL is not yet the sole truth for analysis state. The boundary between the two systems is not explicit.

## Current state analysis

Confirmed:

- PostgreSQL stores users, articles, analysis tasks, and decisions.
- Redis stores article cache and like counters.
- Runtime execution state for analysis tasks is not handled by either in a durable, coordinated way.

## Options considered

### Option A

Use PostgreSQL only and keep Redis minimal.

### Option B

Use Redis only for task state and task results.

### Option C

Use PostgreSQL for persistent records and Redis for runtime coordination and caching.

## Tradeoff comparison

### Option A

- Pros: fewer systems in the critical path
- Cons: weaker fit for transient task state and coordination

### Option B

- Pros: fast state updates
- Cons: poor fit for auditability, historical queries, and user-linked business records

### Option C

- Pros: matches system needs well
- Cons: requires explicit lifecycle rules

## Final decision

Adopt PostgreSQL for durable business records and Redis for runtime coordination, locks, queues, and short-lived cache/state.

## Planned Redis responsibilities

- task queue
- task runtime status
- short-lived progress metadata
- deduplication/locking for expensive fetches
- selected hot-result cache

## Planned PostgreSQL responsibilities

- users
- articles
- analysis tasks
- decisions
- final reports and historical lookup

## Testing and validation

- Redis responsibilities implemented in the current mainline:
  - task queue
  - runtime task state
- PostgreSQL responsibilities implemented in the current mainline:
  - durable task rows in `trading_analysis_tasks`
  - durable decisions in `trading_decisions`
- Verified locally:
  - Redis container health check passed with `PING`
  - Redis temporary read/write check passed with `SET/GET`
  - PostgreSQL connectivity check passed with `select 1`
  - live table inspection confirmed task rows are being written and updated

Observed follow-up issue:

- stale `pending/processing` rows can appear when Redis runtime state disappears before PostgreSQL is reconciled.

## Outcome and follow-up

Status: implemented for queue/runtime-vs-durable-state ownership.

Remaining gap:

- request-driven reconciliation is now implemented for missing runtime state, but a background sweeper is still optional future hardening

## Subsequent implementation update

Additional work completed after the initial boundary rollout:

- Go now reconciles `pending` and `processing` tasks on task detail, task list, and stats reads.
- If Redis runtime state exists, Go persists the latest runtime status and terminal data back to PostgreSQL.
- If Redis runtime state is missing and the task exceeds the configured timeout, Go marks the task as `failed` with a reconciliation error.
- Default timeouts:
  - `pending`: `2m`
  - `processing`: `30m`
- Local verification:
  - `go test ./...` passed in `backend`
  - inspected Redis queues confirmed both runtime queues were empty
  - inspected PostgreSQL confirmed 4 stale `processing` rows
  - verified matching Redis runtime keys were absent
  - manually reconciled those 4 confirmed stale rows to `failed`

Current database state after reconciliation:

- `completed = 4`
- `failed = 27`
- `pending/processing = 0`
