---
id: ADR-047
kind: requirement
title: Evidence And Report Memory
date: 2026-04-15
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Evidence And Report Memory

## Background

FinGOAT already has a pgvector-backed memory store foundation (`ADR-030`). The current implementation is best understood as reflective agent memory: it stores situations and recommendations produced by post-decision reflection paths.

That is not the same thing as automatically indexing every final analysis report, nor is it enough to handle fast-moving news, sentiment, and fact reversals.

## Problem and impact

Financial evidence changes over time:

- news and sentiment can reverse between adjacent analysis dates
- a filing, management statement, analyst note, or market reaction can invalidate an earlier assumption
- old reports may be correct as-of their analysis date but wrong under later evidence
- future evidence must not leak into historical evaluation

If the system only stores semantically similar past text, later analyses can reuse stale or contradicted context without knowing what changed.

## Requirement

Introduce explicit time-aware evidence and report memory.

The system should separate at least three concepts:

- evidence memory: facts, claims, news, sentiment, filings, and market events with time/version metadata
- report memory: chunked final analysis reports and stage outputs for retrieval and comparison
- reflection memory: post-outcome lessons generated after signal evaluation

These should not be collapsed into one generic memory table.

## Evidence model direction

Future evidence objects should capture:

- ticker and market
- source and source URL
- vendor/provider
- observed time: when FinGOAT saw the evidence
- event time: when the underlying event occurred
- as-of date: the analysis date for which evidence is valid
- claim text and claim type
- evidence confidence
- active/superseded/disputed/retracted status
- optional superseding evidence ID
- optional contradiction group ID

Old evidence should usually be superseded, not deleted. Historical reports must remain auditable as-of the information available at the time.

## Report memory direction

After a valid completed analysis, FinGOAT should chunk and embed:

- final report summary
- stage outputs
- agent stance summaries
- final decision rationale
- source/evidence references used by each stage

Required metadata:

- task ID
- user ID
- ticker and market
- analysis date
- stage ID
- provider/model
- completion timestamp
- report schema version

Only completed tasks under the strict completion contract (`ADR-046`) should be indexed as report memory.

## Retrieval rules

Future analyses should retrieve context with time-aware constraints:

- include only evidence visible as of the requested analysis date
- surface what changed since the user's last analysis of the same ticker
- identify superseded or contradicted prior assumptions
- avoid using future evidence in historical backtests or signal evaluation
- separate factual evidence from prior model interpretation

## User-facing behavior

When a ticker is reanalyzed, the product should eventually show:

- what evidence is new since the prior analysis
- what prior facts or assumptions were superseded
- why the model's stance changed or stayed the same
- which historical report chunks were reused

## Non-goals

- Do not treat pgvector as the only source of truth.
- Do not overwrite historical facts just because newer facts exist.
- Do not make stale reports appear current without as-of metadata.
- Do not index incomplete analysis checkpoints as report memory.

## Follow-up

- Add evidence tables and versioning semantics.
- Add report chunk table with vector embeddings and metadata.
- Add retrieval API constrained by ticker, market, user, and as-of date.
- Add analysis delta view for repeated ticker analysis.
- Update prompts to distinguish current evidence, historical reports, and reflection lessons.

## Traceability Note

Implementation work should reference `ADR-047`.
