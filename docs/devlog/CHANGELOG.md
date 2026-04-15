# Changelog

## v0.1.5

### Added

- analysis export endpoints and frontend download actions for `json` / `markdown` (`ADR-045`)
- advanced analysis controls for `selected_analysts`, `max_debate_rounds`, and `max_risk_discuss_rounds` (`ADR-045`)
- shared Go/Python contract reference plus drift-check script (`ADR-045`)
- active requirements for strict analysis completion, evidence/report memory, and signal-ledger reflection loop (`ADR-046`, `ADR-047`, `ADR-048`)

### Changed

- Go remains the only product API boundary; `trading-service` now keeps only runtime/result/SSE responsibilities (`ADR-045`)
- `feed` is now the only content system; legacy `articles` code path was removed (`ADR-045`)
- historical `langchain-v1` experiments were fully absorbed into the `TradingAgents` mainline and removed from the repo (`ADR-045`)
- `v0.2.0` scope is now explicitly reserved for strict completion, time-aware evidence/report memory, signal evaluation, and validated reflection (`ADR-046`, `ADR-047`, `ADR-048`)

### Removed

- TradingAgents CLI and related console entry / assets (`ADR-045`)
- deprecated Python public task creation endpoints and duplicate Python market-data endpoints (`ADR-045`)

### Known gaps

- strict fail-closed completion and recoverable failure states remain unimplemented (`ADR-046`)
- Evidence Ledger, Report Memory, Signal Ledger, and outcome evaluation remain unimplemented (`ADR-047`, `ADR-048`)
- `.reference/` projects are local-only references and require license review before any implementation work

## v0.1.4

### Added

- user profile, email verification, and BYOK self-service flow (`ADR-027`, `ADR-038`)
- usage/admin visibility and first-pass RBAC (`ADR-029`, `ADR-031`, `ADR-037`)
- unified `chart / quote / terminal` market-data surface and dedicated market-data service (`ADR-032`)
- local Ollama model discovery and local-config UX (`ADR-034`)
- service split into `services/trading-service`, `services/market-data-service`, and `services/python-common` (`ADR-039`)

### Changed

- trading runtime consolidated around Redis-backed execution checkpoints and stage-first UI (`ADR-012`, `ADR-017`, `ADR-018`)
- deployment and service-boundary hardening continued toward a single public Go API (`ADR-021`, `ADR-026`)
- devlog now uses stable ADR IDs, lightweight frontmatter, `current/` active docs, and archive-based version closeout (`ADR-033`, `ADR-039`)

### Fixed

- DashScope/tool-call guard and provider-key injection regressions (`ADR-024`, `ADR-025`)
- qwen3.5-flash thread-lock pickle failure during config copying (`ADR-036`)

## Unreleased

### Added

### Changed

### Removed

## v0.1.2

See [archive/v0.1.2/status.md](./archive/v0.1.2/status.md).

## v0.1.1

See [archive/v0.1.1/status.md](./archive/v0.1.1/status.md).

## v0.1.0

See [archive/v0.1.0/status.md](./archive/v0.1.0/status.md).
