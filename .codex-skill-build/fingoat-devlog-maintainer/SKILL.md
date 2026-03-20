---
name: fingoat-devlog-maintainer
description: Maintain the FinGOAT devlog system in `docs/devlog` after bug fixes, feature delivery, requirement changes, review passes, or version closeout. Use when Codex needs to add or update ADR records, propagate changes into `docs/devlog/current`, refresh the records index, update appendix verification metadata, or archive the current cycle into `docs/devlog/archive`.
---

# FinGOAT Devlog Maintainer

Keep FinGOAT's devlog traceable without rewriting every document on every change. Treat `records/` and code reality as the fine-grained truth, then propagate only the necessary deltas into `current/`, `appendix/`, and `archive/`.

## Devlog Topology

Operate on these paths:

- `docs/devlog/current/`: active cycle state
- `docs/devlog/records/`: stable `ADR-XXX` records with frontmatter
- `docs/devlog/appendix/`: stable reference docs with `last_verified`
- `docs/devlog/archive/`: frozen version snapshots
- `docs/devlog/CHANGELOG.md`: release-facing summary
- `scripts/refresh_devlog_records_index.py`: regenerate `docs/devlog/records/README.md`

Treat each layer differently:

- `records/` answers: what changed, why, and what was decided
- `current/task-backlog.md` answers: what is still to do or now done
- `current/capabilities.md` answers: what the system can currently do
- `current/prd.md` answers: what this version still needs
- `current/overview.md` answers: the short top-level state only
- `appendix/` answers: stable structure, contracts, and model references

Do not update every file by default. Propagate only where the change alters the truth of that layer.

## Workflow

### 1. Rebuild context from code and devlog

Before editing, inspect:

- the relevant code paths
- the affected ADRs in `docs/devlog/records/`
- `docs/devlog/current/task-backlog.md`
- `docs/devlog/current/capabilities.md`
- `docs/devlog/current/prd.md` only if the work changes current version scope
- relevant appendix files only if interfaces, models, or architecture changed

Prefer `rg` to find existing ADR IDs, old wording, and stale paths.

## 2. Decide the trigger type

Map the request into one of these flows:

- bug fix
- requirement or feature delivery
- review / validation / repo sync
- version closeout

If multiple apply, do them in this order:

1. `records/`
2. `current/task-backlog.md`
3. `current/capabilities.md`
4. `current/prd.md`
5. `current/overview.md`
6. `appendix/`
7. `CHANGELOG.md`
8. `archive/`

## 3. Apply the right propagation rule

### Bug fix

Use this when behavior was corrected but product scope did not materially expand.

Do:

- add or update a `review` or `decision` record in `docs/devlog/records/`
- update `current/task-backlog.md` if the bug was tracked there
- update `current/capabilities.md` only if the fix changes a `gap` or `partial` judgment
- update `CHANGELOG.md` if the fix is user-facing or release-relevant

Do not:

- rewrite `current/prd.md` unless the bug changes current priorities
- rewrite `current/overview.md` for a local fix

### Requirement or feature delivery

Use this when a new capability lands or a planned requirement meaningfully advances.

Do:

- add or update a `decision` or `requirement` record
- mark related backlog items done or move priority in `current/task-backlog.md`
- update `current/capabilities.md` if the module changed from `gap` to `partial` or `working`
- update `current/prd.md` if the feature removes or narrows an active requirement
- update `CHANGELOG.md` if the feature belongs in the current release summary

Update `current/overview.md` only if the feature changes the top-line current-version judgment.

### Review / validation / repo sync

Use this when doing code review, branch comparison, full-repo devlog sync, or implementation validation.

Do:

- add or update a `review` record
- update `current/task-backlog.md` if the review changes what remains
- update `current/capabilities.md` only if the review proves earlier capability claims were wrong
- update appendix files only if the review found structural drift and you can verify the corrected state

### Version closeout

Use this when a version is being frozen and archived.

Do:

- confirm `current/`, `records/`, `appendix/`, and `CHANGELOG.md` reflect the final state
- create `docs/devlog/archive/vX.Y.Z/`
- snapshot the relevant current-cycle materials into that archive
- update `docs/devlog/archive/README.md`
- reset `current/` only if the user explicitly wants to start the next cycle in the same turn

Do not archive active records just because they are implemented. Archive happens at version freeze, not at feature completion.

## Update Matrix

When a record changes, use this matrix instead of editing everything:

- change affects execution status or priority:
  - update `current/task-backlog.md`
- change affects what the product can do:
  - update `current/capabilities.md`
- change affects what this version still needs:
  - update `current/prd.md`
- change affects the top-level release summary:
  - update `current/overview.md`
- change affects interfaces, models, architecture, or boundaries:
  - update the relevant appendix file and refresh its `last_verified`
- change is only a local implementation note:
  - `records/` may be enough

## ADR Rules

Every active record in `docs/devlog/records/` must keep valid frontmatter:

- `id`
- `kind`
- `title`
- `date`
- `status`

Optional directional fields:

- `supersedes`
- `superseded_by`
- `implements`
- `verified_by`

Prefer stable IDs like `ADR-032` in:

- backlog references
- commit messages
- short code comments for non-obvious architectural choices

When adding a new record, follow the next available `ADR-XXX` number and keep the filename format:

- `ADR-XXX_YYYY-MM-DD_topic.md`

Use the template at `docs/devlog/appendix/templates/adr-record-template.md`.

## Verification

After edits, always:

1. run `python scripts/refresh_devlog_records_index.py`
2. scan for stale path references with `rg`
3. inspect the touched `current/` and `records/` files for scope drift

Use these repo-specific checks from `references/checklists.md`.

## Output Expectations

When finishing a devlog maintenance task, report:

- which trigger flow you used
- which files changed
- what truth was updated: record, backlog, capability, PRD, overview, appendix, changelog, or archive
- what you verified

