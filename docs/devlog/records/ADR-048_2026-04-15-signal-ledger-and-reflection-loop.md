---
id: ADR-048
kind: requirement
title: Signal Ledger And Reflection Loop
date: 2026-04-15
status: active
supersedes: null
superseded_by: null
implements: [ADR-035]
verified_by: []
---

# Signal Ledger And Reflection Loop

## Background

`ADR-035` identified the main product gap: FinGOAT can generate analysis and `BUY / SELL / HOLD` decisions, but it cannot yet prove whether those decisions are useful.

The next step is not just to persist final reports. The system needs a closed loop:

- generate a valid signal
- measure future outcomes
- attribute signal quality to agents, providers, and evidence
- write post-outcome lessons back into reflection memory

## Problem and impact

Without a first-class signal and outcome loop, the product cannot answer:

- whether recommendations are correct over `T+1 / T+5 / T+20`
- whether higher confidence actually predicts better outcomes
- which agents add signal versus token cost
- which providers/models are worth using
- which historical lessons should influence future decisions

Without strict gating, incomplete or degraded tasks could pollute this evaluation loop.

## Requirement

Only valid completed analyses should produce first-class signals.

Signal creation must depend on `ADR-046`:

- all required stages succeeded
- final decision is present
- no required-stage failure was hidden
- task is not `incomplete`, `failed`, `failed_recoverable`, `cancelled`, or `expired`

## Data model direction

Signal records should include:

- task ID
- user ID
- ticker and market
- action
- confidence
- signal timestamp
- analysis date
- signal price
- provider and model
- execution mode
- selected analysts
- report schema version

Signal outcomes should include:

- signal ID
- horizon (`T+1`, `T+5`, `T+20`)
- evaluation price
- return percentage
- correctness label
- evaluated timestamp
- evaluation status

Agent attribution should include:

- signal ID
- stage ID / agent role
- stance: bullish, bearish, neutral, or insufficient
- confidence or strength where available
- token usage
- latency
- failure/retry/fallback metadata

## Reflection loop

After outcome evaluation, FinGOAT should generate reflection memory:

- what the system got right or wrong
- which evidence streams mattered
- which assumptions were invalidated
- how similar future situations should be treated

Reflection memory should be separate from report memory:

- report memory preserves what the system said at the time
- reflection memory stores lessons after later market outcomes are known

This prevents future agents from treating old reports as validated lessons when they were never evaluated.

## User-facing behavior

The product should eventually expose:

- signal scorecard
- horizon-level win rate and return
- confidence calibration
- per-agent attribution
- model/provider split
- per-task after-the-fact result badges
- explanation of whether a prior thesis was confirmed, invalidated, or still pending

## Non-goals

- Do not evaluate incomplete tasks as if they produced real signals.
- Do not write reflection memory before outcome horizons mature.
- Do not overwrite the original report when a later reflection is produced.
- Do not treat model-generated reflection as market truth; it must be tied to measured outcomes and source evidence.

## Follow-up

- Add Signal Ledger schema and APIs.
- Add horizon evaluation jobs.
- Add agent stance extraction and attribution storage.
- Add scorecard and per-task outcome UI.
- Add reflection job that writes post-outcome lessons into pgvector-backed reflection memory.
- Ensure report memory (`ADR-047`) and reflection memory remain separate.

## Traceability Note

Implementation work should reference `ADR-048`.
