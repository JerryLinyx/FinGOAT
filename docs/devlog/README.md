# Devlog

This directory is the working documentation area for ongoing development.

## Structure

- `current/`: current-version overview, PRD, capabilities, backlog, milestones, and debts
- `records/`: stable ADR-indexed requirements, reviews, and technical decisions
- `appendix/`: stable reference material for the current system
- `archive/`: frozen snapshots of finished or baseline versions
- `CHANGELOG.md`: current release-facing summary for active work

## Usage

- Put active version work in `current/`.
- Keep decision and review records in `records/`.
- When a version is closed, snapshot the relevant `current/`, `records/`, and `appendix/` materials into `archive/vX.Y.Z/`.
- Keep `appendix/` focused on durable reference material rather than daily progress notes.
- Treat `records/` as the single source of truth for active requirements, reviews, and technical decisions.
- Use stable `ADR-XXX` IDs when referring to records from backlog items, commit messages, or code comments.

## Traceability Rules

- Every active record in `records/` must have frontmatter with `id`, `kind`, `title`, `date`, and `status`.
- Prefer references like `ADR-029` over date-based filenames.
- Commit messages for implementation work should reference the relevant ADR ID.

Example:

```text
feat: add RequireAdmin middleware

Implements ADR-029.
```

- For code comments, use the stable ID only.

Example:

```go
// See ADR-029.
```

## Requirement Maintenance

Use this storage rule for new product or architecture requirements:

- Put durable reasoning in `records/` as an `ADR-XXX` record.
- Put current-version product intent in `current/prd.md`.
- Put executable implementation tasks in `current/task-backlog.md`.
- Put "what works / what is partial / what is missing" truth in `current/capabilities.md`.
- Put stable implemented structures in `appendix/` only after they are real enough to verify against code.
- Keep local external-project clones outside devlog, under the Git-ignored `.reference/` directory. Track source/commit/purpose in `.reference/README.local.md`, and only promote an idea into devlog when it becomes a real PRD/backlog/ADR item.

For speculative or newly discussed requirements, create an active `kind: requirement` record first. Implementation plans, commits, and code comments should then cite that stable ADR ID. This keeps design discussion reusable without pretending the feature has already shipped.

## Current Source Of Truth

- Active current-version product and delivery state: `current/`
- Active requirements, reviews, and decisions: `records/`
- Stable architecture and model references: `appendix/`
- Historical baselines: `archive/v0.1.x/`

## Current baseline

- Archived baseline version: `v0.1.5`
- Current planning target: `v0.2.0`
