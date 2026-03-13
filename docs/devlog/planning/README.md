# Planning

This directory contains the active planning workspace for the current development cycle.

## Files

- `overview.md`: current version development overview and scope
- `milestones.md`: phased delivery plan
- `problems-and-debts.md`: confirmed problems and technical debt inherited from the last baseline
- `task-backlog.md`: executable backlog with priority and ownership fields
- `records/`: topic-based analysis and decision records

## Rules

- Keep this directory version-agnostic while the work is active.
- When the version is finalized, archive the snapshot under `../archive/vX.Y.Z/`.
- Link backlog items to at least one record in `records/` when a topic has non-trivial tradeoffs.

