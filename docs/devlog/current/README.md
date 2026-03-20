# Current

This directory contains the active current-version workspace.

## Files

- `overview.md`: concise entry page for the current cycle
- `prd.md`: current version product requirements and solution directions
- `capabilities.md`: module-by-module capability matrix
- `milestones.md`: phased delivery plan
- `problems-and-debts.md`: confirmed problems and technical debt inherited from the last baseline
- `task-backlog.md`: executable backlog with priority and ownership fields

## Rules

- Keep this directory version-agnostic while the work is active.
- When the version is finalized, archive the snapshot under `../archive/vX.Y.Z/`.
- Link backlog items to at least one stable ADR ID when a topic has non-trivial tradeoffs.
- Keep `overview.md` compact; move capability detail to `capabilities.md` and durable structure to `../appendix/`.
- Use `prd.md` for the current version's active product requirements and intended solution directions.
- Keep durable requirements/reviews/decisions in `../records/`, not duplicated here.

## Active cycle

- Baseline: `v0.1.4`
- In-progress target: `v0.2.0`
