# Records

Active project records use stable `ADR-XXX` identifiers and are grouped by `kind`.

Frontmatter minimum:

- `id`, `kind`, `title`, `date`, `status`
- optional directional links such as `supersedes`, `superseded_by`, `implements`, `verified_by`

Commit messages should reference the stable ADR ID when implementation work lands.

## Decisions

| ID | Date | Kind | Title | Status |
| --- | --- | --- | --- | --- |
| [ADR-001](./ADR-001_2026-03-13-analysis-cancel-and-resume.md) | 2026-03-13 | decision | Analysis Cancel And Resume | active |
| [ADR-002](./ADR-002_2026-03-13-async-graph-execution.md) | 2026-03-13 | decision | Async Graph Execution | active |
| [ADR-006](./ADR-006_2026-03-13-mock-analysis-pipeline-test.md) | 2026-03-13 | decision | Mock Analysis Pipeline Test | active |
| [ADR-007](./ADR-007_2026-03-13-ollama-default-model.md) | 2026-03-13 | decision | Ollama Default Model | active |
| [ADR-008](./ADR-008_2026-03-13-ollama-embedding-routing.md) | 2026-03-13 | decision | Ollama Embedding Routing | active |
| [ADR-009](./ADR-009_2026-03-13-ollama-memory-fallback.md) | 2026-03-13 | decision | Ollama Memory Fallback | active |
| [ADR-010](./ADR-010_2026-03-13-openclaw-analyst-runtime-integration.md) | 2026-03-13 | decision | 2026-03-13 OpenClaw Analyst Runtime Integration | active |
| [ADR-011](./ADR-011_2026-03-13-parallel-analyst-cleanup.md) | 2026-03-13 | decision | Parallel Analyst Cleanup | active |
| [ADR-012](./ADR-012_2026-03-13-processing-checkpoints.md) | 2026-03-13 | decision | Processing Checkpoints | active |
| [ADR-013](./ADR-013_2026-03-13-redis-postgres-boundary.md) | 2026-03-13 | decision | Redis PostgreSQL Boundary | active |
| [ADR-014](./ADR-014_2026-03-13-redis-worker-timeout.md) | 2026-03-13 | decision | Redis Worker Timeout | active |
| [ADR-015](./ADR-015_2026-03-13-rest-vs-grpc.md) | 2026-03-13 | decision | REST Vs gRPC | active |
| [ADR-016](./ADR-016_2026-03-13-rss-refresh-deduplication.md) | 2026-03-13 | decision | RSS Refresh Deduplication | active |
| [ADR-017](./ADR-017_2026-03-13-stage-timing-and-stage-view.md) | 2026-03-13 | decision | Stage Timing And Stage View | active |
| [ADR-018](./ADR-018_2026-03-13-task-state-redesign.md) | 2026-03-13 | decision | Task State Redesign | active |
| [ADR-022](./ADR-022_2026-03-14-chart-feature-and-tactile-ui-implementation.md) | 2026-03-14 | decision | Chart Feature and Tactile UI Implementation | active |
| [ADR-023](./ADR-023_2026-03-14-sse-streaming-flow-graph-compact-ui.md) | 2026-03-14 | decision | SSE Streaming, Agent Flow Graph, and Compact UI | active |
| [ADR-024](./ADR-024_2026-03-15-p1-cleanup-and-dashscope-tool-call-bug.md) | 2026-03-15 | decision | P1 Cleanup and DashScope Tool-Call Bug | active |
| [ADR-025](./ADR-025_2026-03-15-provider-keying-and-toolcall-guard.md) | 2026-03-15 | decision | Provider Key Injection, Alpha Vantage BYOK, and Tool-Call Guard | active |
| [ADR-026](./ADR-026_2026-03-18-deployment-hardening-and-p0-plan.md) | 2026-03-18 | decision | Deployment Hardening & P0 Remediation — 2026-03-18 | active |
| [ADR-027](./ADR-027_2026-03-18-email-registration-module.md) | 2026-03-18 | decision | Email Registration Module | active |
| [ADR-029](./ADR-029_2026-03-18-observability-platform-and-rbac.md) | 2026-03-18 | decision | Observability Platform And RBAC | active |
| [ADR-030](./ADR-030_2026-03-18-pgvector-memory-migration.md) | 2026-03-18 | decision | pgvector Memory Store Migration | active |
| [ADR-032](./ADR-032_2026-03-19-chart-terminal-unification-and-qwen35-plus-validation.md) | 2026-03-19 | decision | 2026-03-19 — Chart Terminal Unification And Qwen3.5-Plus Validation | active |
| [ADR-034](./ADR-034_2026-03-19-ollama-model-discovery-and-local-config-ui.md) | 2026-03-19 | decision | Ollama Model Discovery And Local Config UI | active |
| [ADR-036](./ADR-036_2026-03-19-qwen35-flash-thread-lock-pickle-fix.md) | 2026-03-19 | decision | qwen3.5-flash Thread Lock Pickle Fix | active |
| [ADR-037](./ADR-037_2026-03-19-stage-usage-and-token-visibility.md) | 2026-03-19 | decision | 2026-03-19 — Stage Usage And Token Visibility | active |
| [ADR-038](./ADR-038_2026-03-19-user-profile-and-byok-implementation.md) | 2026-03-19 | decision | User Profile And BYOK Implementation | active |
| [ADR-041](./ADR-041_2026-03-21-hard-cancel-running-analysis.md) | 2026-03-21 | decision | 2026-03-21 Hard Cancel for Running Analysis | active |
| [ADR-042](./ADR-042_2026-03-21-top-level-analyst-subprocess-streaming.md) | 2026-03-21 | decision | 2026-03-21 Top-Level Analyst Subprocess Streaming | active |
| [ADR-044](./ADR-044_2026-03-22-runtime-unification-and-openclaw-7-of-9.md) | 2026-03-22 | decision | 2026-03-22 Runtime Unification And OpenClaw 7-of-9 Rollout | active |
| [ADR-045](./ADR-045_2026-03-27-repo-slimming-and-boundary-convergence.md) | 2026-03-27 | decision | 2026-03-27 Repo Slimming And Boundary Convergence | active |

## Requirements

| ID | Date | Kind | Title | Status |
| --- | --- | --- | --- | --- |
| [ADR-004](./ADR-004_2026-03-13-chart-query-history-requirements.md) | 2026-03-13 | requirement | v0.2.0 Chart Query History Requirements | superseded |
| [ADR-019](./ADR-019_2026-03-13-trading-analysis-duplicate-guard-requirements.md) | 2026-03-13 | requirement | v0.2.0 Trading Analysis Duplicate Guard Requirements | superseded |
| [ADR-020](./ADR-020_2026-03-13-user-account-and-byok-requirements.md) | 2026-03-13 | requirement | v0.2.0 User Account And BYOK Requirements | superseded |
| [ADR-021](./ADR-021_2026-03-13-v020-kickoff-requirements.md) | 2026-03-13 | requirement | v0.2.0 Kickoff Requirements | active |
| [ADR-046](./ADR-046_2026-04-15-strict-analysis-completion-and-recovery.md) | 2026-04-15 | requirement | Strict Analysis Completion And Recovery | active |
| [ADR-047](./ADR-047_2026-04-15-evidence-and-report-memory.md) | 2026-04-15 | requirement | Evidence And Report Memory | active |
| [ADR-048](./ADR-048_2026-04-15-signal-ledger-and-reflection-loop.md) | 2026-04-15 | requirement | Signal Ledger And Reflection Loop | active |

## Reviews

| ID | Date | Kind | Title | Status |
| --- | --- | --- | --- | --- |
| [ADR-003](./ADR-003_2026-03-13-branch-capability-review.md) | 2026-03-13 | review | Branch Capability Review | active |
| [ADR-005](./ADR-005_2026-03-13-dashscope-qwen35-flash-provider-verification.md) | 2026-03-13 | review | DashScope qwen3.5-flash Provider Verification | active |
| [ADR-028](./ADR-028_2026-03-18-feed-board-review-and-fixes.md) | 2026-03-18 | review | 2026-03-18 Feed Board Review And Fixes | active |
| [ADR-031](./ADR-031_2026-03-18-review-findings.md) | 2026-03-18 | review | 2026-03-18 Review Findings | active |
| [ADR-033](./ADR-033_2026-03-19-full-repo-devlog-sync.md) | 2026-03-19 | review | 2026-03-19 Full Repo Devlog Sync | active |
| [ADR-035](./ADR-035_2026-03-19-product-gap-and-vnext-priorities.md) | 2026-03-19 | review | 2026-03-19 — Product Gap And VNext Priorities | active |
| [ADR-039](./ADR-039_2026-03-19-v014-release-closeout.md) | 2026-03-19 | review | v0.1.4 Release Closeout | active |
| [ADR-040](./ADR-040_2026-03-21-analysis-chain-secret-hygiene-review.md) | 2026-03-21 | review | 2026-03-21 Analysis Chain Secret Hygiene Review | active |
| [ADR-043](./ADR-043_2026-03-22-docker-compose-rebuild-validation.md) | 2026-03-22 | review | 2026-03-22 Docker Compose Rebuild Validation | active |
