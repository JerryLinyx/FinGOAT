# Changelog

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

- No entries yet.

## v0.1.2

See [archive/v0.1.2/status.md](./archive/v0.1.2/status.md).

## v0.1.1

See [archive/v0.1.1/status.md](./archive/v0.1.1/status.md).

## v0.1.0

See [archive/v0.1.0/status.md](./archive/v0.1.0/status.md).
