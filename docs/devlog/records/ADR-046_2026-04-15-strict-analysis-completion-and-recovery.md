---
id: ADR-046
kind: requirement
title: Strict Analysis Completion And Recovery
date: 2026-04-15
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Strict Analysis Completion And Recovery

## Background

FinGOAT is moving from an engineering MVP into a measurable financial analysis product. In that product context, a partially successful multi-agent run is not automatically useful: if a required analyst fails, the final report can look complete while silently missing a material evidence stream.

The current runtime already has Redis-backed checkpoints, SSE updates, cancel/resume, stage metadata, and top-level analyst subprocess isolation. Those capabilities are good operational foundations, but they do not yet express a strict product rule for incomplete analysis.

## Problem and impact

If one required agent fails because of network errors, provider timeouts, rate limits, or tool failures, the system must not produce a normal investment recommendation as if the chain were complete.

Partial reports create three risks:

- users may treat incomplete output as a complete trading recommendation
- incomplete outputs can pollute future signal ledgers, report memory, and reflection memory
- downstream agents may infer missing evidence instead of explicitly reasoning from unavailable evidence

## Requirement

FinGOAT should fail closed for required analysis stages.

The runtime may retry, switch equivalent vendors, reuse allowed short-term cache, and preserve checkpoints. But if a required stage still fails, the task must not be marked as a normal completed analysis and must not emit a final `BUY / SELL / HOLD` signal.

Required-stage failure should produce a clear recovery state, not a product report.

## Proposed state model

Extend task semantics beyond the current coarse `pending / processing / completed / failed / cancelled` lifecycle.

Minimum future states:

- `completed`: all required stages succeeded and final decision is valid
- `failed`: unrecoverable failure
- `failed_recoverable`: required stage failed after retry/fallback, user can retry
- `incomplete`: checkpoints exist but no valid final recommendation exists
- `cancelled`: user cancelled
- `expired`: runtime state became too stale to reconcile safely

Only `completed` tasks may enter:

- Signal Ledger
- report vector index
- reflection memory
- performance scoring
- normal historical analysis views

`incomplete` and `failed_recoverable` data may be kept for diagnostics, retry, and reliability analytics.

## Recovery behavior

For transient failures, the runtime should attempt recovery before failing closed:

- retry network/vendor/tool failures with bounded exponential backoff
- switch to an equivalent configured fallback vendor only when semantic coverage is comparable
- use short-lived cached data only when cache freshness rules allow it
- preserve stage checkpoint state and failure metadata
- expose a user action to retry the failed stage or rerun the complete analysis

Recovery must be explicit in metadata. The final valid report should still disclose retry/fallback/cache use.

## User-facing behavior

When a required stage fails, the UI should show:

- failed stage name
- error category and provider/tool involved
- retry/fallback attempts already made
- why no final trading recommendation was produced
- available actions: retry failed stage, change provider/vendor, rerun full analysis

Completed checkpoint content should be labeled as execution details or incomplete checkpoint data, not as a final report.

## Non-goals

- Do not silently continue with missing required evidence.
- Do not generate a normal final recommendation from incomplete required stages.
- Do not write incomplete outputs to long-term decision, signal, report-memory, or reflection-memory loops.
- Do not hide retry/fallback behavior from the user.

## Follow-up

- Define required/optional stage contracts by analysis mode.
- Add recoverable failure state to Go/Python task contracts.
- Add stage-level retry/fallback metadata.
- Add retry failed stage / rerun full analysis UX.
- Gate Signal Ledger, Report Memory, and Reflection Memory writes on valid `completed` state.

## Traceability Note

Implementation work should reference `ADR-046`.
