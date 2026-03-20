---
id: ADR-039
kind: review
title: v0.1.4 Release Closeout
date: 2026-03-19
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# v0.1.4 Release Closeout

## Background

The repo moved into a new structural state after:

- splitting Python services out of `langchain-v1`
- landing user/profile/BYOK and usage/admin product paths
- introducing the devlog `current / records / appendix / archive` workflow

At that point the repo needed a concrete frozen baseline instead of continuing to describe everything only as `v0.2.0-dev`.

## Problem and impact

Without a frozen baseline:

- the archive lineage would stop at `v0.1.2`
- the changelog would continue to describe releaseable work as unreleased
- devlog baseline references would point to an outdated version
- later work would lose a stable comparison point

## Options considered

### Option A: keep the repo in `v0.2.0-dev` only

Pros:

- no release bookkeeping now

Cons:

- no stable baseline for the current shipped state

### Option B: freeze the current repo as `v0.1.4`

Pros:

- preserves a stable baseline before the next larger cycle
- matches the user's chosen release naming

Cons:

- version numbering is more conservative than the repo's earlier internal `v0.2.0-dev` framing

## Final decision

Choose option B.

Freeze the current validated state as `v0.1.4`, archive it under `docs/devlog/archive/v0.1.4/`, update the devlog baseline references, and treat `current/` as the post-`v0.1.4` workspace for whatever follows next.

This decision affects documentation and release traceability first. It does not claim that every planned `v0.2.0` objective has already shipped.

## Follow-up

- keep `v0.1.4` as the latest archived baseline
- continue active planning in `docs/devlog/current/`
- do not create a Git tag until the release state is committed
