# Observability Platform And RBAC

## Scope

This record covers the newly added internal usage/observability platform and the first user-role/RBAC layer:

- per-task LLM usage collection in Python
- Redis-backed usage event buffering
- PostgreSQL usage persistence and summary APIs in Go
- user self-service usage page
- admin-only usage dashboard
- `user` / `admin` role model and route guard

## Completed Features

### 1. Usage collection pipeline

Implemented across:

- `langchain-v1/usage_collector.py`
- `backend/models/usage.go`
- `backend/controllers/usage_controller.go`
- `backend/config/migrate.go`

Behavior:

- Python-side analysis runs collect per-call usage metadata (tokens, latency, success, error)
- events are buffered in Redis under `usage:events:{task_id}`
- Go ingests events into:
  - `llm_usage_events`
  - `analysis_run_metrics`
- user-facing summaries aggregate tokens / cost / task count
- admin-facing summaries aggregate global totals and per-user usage

### 2. User role + admin-only route guard

Implemented across:

- `backend/models/user.go`
- `backend/middlewares/auth_middleware.go`
- `backend/middlewares/role_middleware.go`
- `backend/router/router.go`
- frontend profile / app shell

Behavior:

- users now carry a `role` field with `user` as the normal role and `admin` as the privileged role
- authenticated requests place normalized `user_role` into Gin context
- admin-only routes sit behind `RequireAdmin()`
- frontend only shows the Admin tab when the profile role is `admin`

### 3. Frontend usage pages

Implemented across:

- `frontend/src/components/UsagePage.tsx`
- `frontend/src/components/AdminDashboard.tsx`
- `frontend/src/services/usageService.ts`

Behavior:

- every authenticated user gets a Usage page
- admin users additionally get a global Admin dashboard

## Review Findings And Fixes

### A. Existing users could keep blank / invalid roles

Problem:

- adding `users.role` via migration does not guarantee existing rows are backfilled
- blank/invalid role values would break admin gating consistency and frontend role display

Fix:

- added `migrateLegacyUserRoleColumn()` in `backend/config/migrate.go`
- existing rows are normalized to `user` unless explicitly set to `admin`
- backend now normalizes role values before:
  - serializing profile responses
  - writing `user_role` into auth context

### B. Usage metrics conflicted with `resume`

Problem:

- `analysis_run_metrics.task_id` is unique
- `ResumeAnalysis` reuses the same `task_id`
- old usage rows could collide with the next ingestion run

Fix:

- added `ClearTaskUsage(...)`
- resume now clears:
  - `llm_usage_events`
  - `analysis_run_metrics`
  - `usage:events:{task_id}` in Redis

### C. Failed / cancelled runs could leave usage data stranded in Redis

Problem:

- usage collector flushes on failure/cancel too
- but ingestion was primarily triggered from the completed-task runtime path
- terminal non-completed runs could therefore miss persistence

Fix:

- added `EnsureTaskUsageIngested(...)`
- task result and task list reads now opportunistically ingest terminal run usage when:
  - the task is `completed` / `failed` / `cancelled`
  - no persisted run metrics exist yet
  - Redis still holds usage events for that task

## Verification

- `go test ./...` in `backend` passes
- role normalization has direct unit coverage in `backend/models/user_test.go`

## Remaining Gaps

- usage ingestion is still “eventual” for some terminal paths; it is triggered on task/result reads rather than a dedicated background usage ingestor
- no dedicated API yet for role management / promotion; admin promotion is still operational/manual
- frontend usage/admin pages currently surface API errors directly and do not yet share the global session-expiry handling pattern
