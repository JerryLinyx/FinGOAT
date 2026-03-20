---
id: ADR-035
kind: review
title: 2026-03-19 — Product Gap And VNext Priorities
date: 2026-03-19
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# 2026-03-19 — Product Gap And VNext Priorities

## Background

After the recent chart-terminal, provider, and observability work, the project now has a materially better technical base:

- multi-service deployment
- BYOK provider routing
- stage-centric task responses
- token / latency visibility
- `US` / `A-share` chart terminal
- internal usage/admin dashboards

However, the product still behaves more like an advanced demo than a production decision tool.

This record captures the honest product diagnosis and defines the next-version priority order.

## Problem and impact

### Core diagnosis

FinGOAT currently spends significant compute and product complexity to produce a final recommendation such as:

- `BUY`
- `SELL`
- `HOLD`

but it still lacks the most important industrial loop:

- decision
- tracking
- validation
- feedback
- optimization

In its current shape, the user journey is still too close to:

```text
input ticker -> burn tokens -> show analysis report -> stop
```

rather than:

```text
input ticker -> generate signal -> track outcome -> score correctness -> feed back into system design
```

### Why that keeps it in “toy project” territory

The system can generate rich analysis, but it still cannot answer the most important product question:

> Is this system actually making better decisions over time?

Without that answer:

- users cannot build trust
- we cannot tell which agents or data sources are useful
- cost optimization is blind
- product iteration direction is mostly guesswork
- the system remains “interesting” rather than “indispensable”

## Current state analysis

### What is already strong

- good engineering momentum
- clear service boundaries emerging
- stage-level observability exists
- live provider validation is now possible
- decision outputs are already structured enough to be captured

### What is missing

#### 1. No signal-performance ledger

We do not persist a first-class “signal” object with:

- ticker
- market
- action
- confidence
- signal-time price
- later realized returns
- correctness labels over defined horizons

So we still cannot compute:

- win rate
- average return by horizon
- confidence calibration
- market-specific performance
- provider / model / strategy comparisons

#### 2. No agent attribution loop

We now collect token and latency at stage level, but we still do not answer:

- which analyst meaningfully contributes signal quality
- which analyst is mostly noise
- which analyst is expensive relative to value

Without attribution, multi-agent orchestration is mostly aesthetic complexity.

#### 3. No smart cost-aware routing

Every analysis still tends to consume a heavy full-graph path even when:

- the ticker is low quality
- data is incomplete
- the expected informational edge is low
- a lighter path would be enough

This matters because recent real `qwen3.5-plus` validation already exposed prompt growth and large token usage in early stages.

## Options considered

### Option A — Keep polishing infrastructure, charts, feeds, and data-source stability first

Pros:

- improves perceived completeness
- reduces obvious rough edges
- helps demo quality

Cons:

- still does not answer whether the core decision engine is useful
- risks over-investing in features around an unvalidated core loop
- makes product direction dependent on taste rather than evidence

### Option B — Make decision validation the next product centerpiece

Pros:

- turns the system from “report generator” into “decision system”
- creates a measurable truth loop
- enables model/agent/product optimization grounded in outcomes
- gives users a reason to return beyond curiosity

Cons:

- less visually flashy than chart/feed work
- requires persistence, cron evaluation, and scorecard UX
- exposes uncomfortable truths if signal quality is weak

## Tradeoff comparison

Choose **Option B**.

Reasoning:

- infrastructure quality matters, but infrastructure without a validated product loop is still supporting a demo
- the next version should prioritize proof of usefulness, not surface breadth
- once signal quality is measurable, technical priorities become much clearer:
  - what to optimize
  - what to cut
  - which agents to downweight
  - which providers are worth the cost

## Final decision

The next version should prioritize three product-level initiatives, in this order:

1. `Signal Ledger`
2. `Agent Attribution`
3. `Smart Routing`

These are the features most likely to move FinGOAT from:

- “interesting multi-agent analysis app”

to:

- “measurable research decision system”

## Implementation direction

### 1. Signal Ledger — top priority

Purpose:

- persist every final decision as a measurable signal
- automatically evaluate its later market outcome
- give users and builders a real scorecard

Required objects:

- `signals`
  - `task_id`
  - `user_id`
  - `ticker`
  - `market`
  - `action`
  - `confidence`
  - `signal_price`
  - `signal_timestamp`
  - `analysis_date`
  - `provider`
  - `model`

- `signal_outcomes`
  - `signal_id`
  - `horizon`
  - `evaluation_price`
  - `return_pct`
  - `is_correct`
  - `evaluated_at`

Evaluation horizons should start simple:

- `T+1`
- `T+5`
- `T+20`

User-facing outputs:

- scorecard page
- per-task “after the fact” result badges
- aggregate win-rate / return / calibration views

Why this is the highest-leverage step:

- it converts outputs into testable claims
- it creates retention-worthy feedback
- it gives all later optimization work an objective target

### 2. Agent Attribution — second priority

Purpose:

- determine which analysts create value and which just consume tokens

Required additions:

- record each agent/stage’s directional contribution
  - bullish / bearish / neutral or equivalent
- connect stage usage and stage stance to eventual signal outcome

Target outputs:

- per-agent hit rate
- per-agent token cost
- per-agent cost / value profile
- market-specific agent effectiveness

Expected product effect:

- move multi-agent design from “theoretical diversity” to evidence-based orchestration
- enable automatic downweighting or removal of low-value analysts

### 3. Smart Routing — third priority

Purpose:

- stop paying full-graph cost for every input

Required behavior:

- lightweight triage before full analysis
- route to:
  - fast path
  - full debate path
  - reject / insufficient-data path

Inputs to routing:

- market/liquidity
- data availability
- event complexity
- expected research payoff

Expected effect:

- reduced latency
- reduced token burn
- clearer product quality floor

## What is explicitly not the next-version centerpiece

The following are still useful, but should not be the main VNext narrative:

- more chart polish
- more feed sophistication
- more agents
- more providers
- deeper AKShare hardening
- more memory/RAG surface area

These improve completeness, but they do not resolve the core product gap.

## Testing and validation direction

The next version should be judged by product metrics, not only technical checks.

Minimum validation targets:

- signal write success rate
- signal evaluation completion rate
- win rate by horizon
- average return by horizon
- confidence calibration
- per-agent attribution coverage
- token cost per successful signal
- fast-path vs full-path routing share

## Outcome and follow-up

### Outcome of this diagnosis

The project is not “bad”; it is simply still pre-closure.

Its strongest next move is not more presentation-layer refinement, but adding the loop that industrial tools require:

- prediction
- measurement
- accountability

### VNext priority order

1. Build `Signal Ledger`
2. Add `Agent Attribution`
3. Add `Smart Routing`

### New requirements created by this decision

- decision outputs must become first-class persisted product objects
- task completion must trigger post-hoc evaluation workflows
- stage/agent outputs need clearer attribution semantics
- optimization work should be judged by outcome quality and cost efficiency, not just latency or polish
