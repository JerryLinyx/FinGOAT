---
id: ADR-003
kind: review
title: Branch Capability Review
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Branch Capability Review

## Background

Two relevant remote branches were reviewed in addition to `main`:

- `origin/dev_gq2142`
- `origin/rag_fund`

## Problem and impact

Both branches contain useful work, but they are behind `main` and include unrelated branch drift. Direct merges would introduce noise and risk.

## Current state analysis

### `origin/dev_gq2142`

Observed themes:

- stronger analysis transparency
- stage timing and key outputs
- structured analyst outputs
- valuation analyst introduction
- broader workflow changes in TradingAgents and frontend

### `origin/rag_fund`

Observed themes:

- fundamentals-specific RAG retriever
- ChromaDB-based knowledge base utilities
- fundamentals analyst prompt/context enhancement

## Options considered

### Option A

Merge whole branches.

### Option B

Cherry-pick only selected capabilities.

### Option C

Ignore branch work and rebuild from scratch.

## Tradeoff comparison

### Option A

- Pros: fastest path to importing all work
- Cons: branch drift, unrelated deletions, and behavioral changes would make the merge noisy and risky

### Option B

- Pros: captures value while keeping the mainline coherent
- Cons: requires careful extraction and re-integration work

### Option C

- Pros: clean slate
- Cons: wastes validated team effort

## Final decision

Use selective capability absorption rather than direct branch merges.

## Recommended absorption from `origin/dev_gq2142`

- stage timing concepts
- key output extraction
- stage-based frontend presentation
- structured analyst output constraints
- valuation analyst direction

## Recommended absorption from `origin/rag_fund`

- fundamentals RAG retriever abstraction
- knowledge base organization approach
- scripts pattern for knowledge-base management

## Deferred or risky branch content

- whole-graph workflow replacement in `origin/dev_gq2142`
- broad stale documentation/asset changes from either branch
- immediate production use of static generic RAG corpus without validation

## Testing and validation

Planned after selective absorption:

- schema compatibility checks
- frontend rendering verification
- analysis quality regression checks

## Outcome and follow-up

Status: reviewed. Selective adoption planned.

