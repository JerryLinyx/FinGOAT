# FinGOAT Devlog Checklists

## Minimal verification commands

Run after most devlog edits:

```bash
python scripts/refresh_devlog_records_index.py
rg -n "planning/|planning-record-template|supporting-plans" docs/devlog --glob '!docs/devlog/archive/**'
```

Useful structure checks:

```bash
find docs/devlog -maxdepth 2 -type d | sort
find docs/devlog/current docs/devlog/records -maxdepth 1 -type f | sort
```

## Trigger-specific checklist

### Bug fix

- Was a new or existing ADR updated?
- Was the bug tracked in `current/task-backlog.md`?
- Did the fix change a capability judgment in `current/capabilities.md`?
- Does it deserve a `CHANGELOG.md` fix entry?

### Requirement or feature delivery

- Does the work need a new `decision` or `requirement` record?
- Did a backlog item move from open to done?
- Did a module move from `gap` to `partial` or `working`?
- Does `current/prd.md` still describe an active unmet requirement, or should it shrink?
- Does the change alter the top-line message in `current/overview.md`?

### Review / validation

- Does the review need its own `review` record?
- Did the review invalidate an older capability claim?
- Did it uncover architecture drift that requires appendix updates?

### Version closeout

- Is `current/` internally consistent?
- Is `records/README.md` regenerated?
- Do appendix files reflect the final state and verified date?
- Is `CHANGELOG.md` current for the release being frozen?
- Has the snapshot been copied into `archive/vX.Y.Z/`?

## Truth-source hierarchy

Use this order when deciding where to edit:

1. code and runtime behavior
2. `docs/devlog/records/`
3. `docs/devlog/current/task-backlog.md`
4. `docs/devlog/current/capabilities.md`
5. `docs/devlog/current/prd.md`
6. `docs/devlog/current/overview.md`
7. `docs/devlog/appendix/`
8. `docs/devlog/CHANGELOG.md`

If a change does not alter the truth of a layer, do not edit that layer.
