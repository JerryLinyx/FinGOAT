# 2026-03-18 Review Findings

## Scope

Reviewed the newly added work across:

- email verification / profile email editing
- Alpha Vantage BYOK gating in the frontend
- pgvector-backed persistent memory

This record captures problems discovered after implementation and the fixes applied after review.

## Findings

### 1. Email change did not invalidate verification state

Affected code:

- `backend/controllers/user_controller.go`

Original behavior:

- profile email updates write the new `email`
- `email_verified` is not reset
- no new verification token is sent

Impact:

- a user can verify one address, switch to another address, and remain marked as verified
- verification semantics become incorrect immediately after the first email change

Fix applied:

1. detect whether the submitted email differs from the current email
2. when it changes:
   - set `email_verified = false`
   - delete unused `verify` tokens for the user
   - issue and send a fresh verification token

Status:

- fixed in `backend/controllers/user_controller.go`

### 2. Profile API did not return `email_verified`

Affected code:

- `backend/controllers/user_controller.go`
- `frontend/src/App.tsx`

Original behavior:

- frontend banner logic depends on `currentUser.email_verified`
- profile endpoints only return `id`, `username`, `email`, `display_name`, `avatar_url`, `created_at`
- `email_verified` is never serialized

Impact:

- the verification banner cannot reliably appear after login or profile refresh
- the frontend type was extended, but the backend contract was not updated

Fix applied:

- add `email_verified` to both profile response payloads:
  - `GET /api/user/profile`
  - `PUT /api/user/profile`

Status:

- fixed in `backend/controllers/user_controller.go`

### 3. Alpha Vantage analysis gate was temporarily unsatisfiable during review

Affected code:

- `frontend/src/components/TradingAnalysis.tsx`
- `backend/controllers/user_controller.go`
- `frontend/src/components/ProfilePage.tsx`

Reviewed state:

- analysis submission requires `configuredProviders.has("alpha_vantage")`
- by the time of the code review, `GET /api/user/api-keys` already included `alpha_vantage`
- `ProfilePage` also already labeled it as `Alpha Vantage (data)`

Conclusion:

- this issue was valid during an intermediate state but is no longer an open code problem
- the frontend gate is satisfiable with the current backend/provider inventory

Status:

- verified resolved in current codebase

### 4. pgvector migration was mandatory while runtime fallback remained optional

Affected code:

- `backend/config/migrate.go`
- `TradingAgents/tradingagents/agents/utils/memory.py`

Original behavior:

- backend startup always requires `CREATE EXTENSION vector`
- Python runtime already supports graceful fallback to in-memory memory when DB support is unavailable

Impact:

- deployments on ordinary PostgreSQL can fail at backend startup
- the migration behavior is stricter than the runtime memory-store behavior

Fix applied:

1. gate pgvector migration behind an explicit capability/config flag
2. downgrade unsupported-extension startup failures to warnings in non-pgvector environments
3. let Python fallback remain the final runtime guard

Implementation:

- added `features.require_pgvector: false` in `backend/config/config.yaml`
- added `REQUIRE_PGVECTOR` env override in `backend/config/config.go`
- changed `MigrateDB()` to log-and-continue on pgvector migration failure unless pgvector is explicitly required

Status:

- fixed in `backend/config/config.go` and `backend/config/migrate.go`
