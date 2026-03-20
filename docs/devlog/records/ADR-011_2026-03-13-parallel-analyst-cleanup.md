---
id: ADR-011
kind: decision
title: Parallel Analyst Cleanup
date: 2026-03-13
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# Parallel Analyst Cleanup

## Background

After enabling async graph execution and parallel analyst fan-out, slow providers such as Ollama started exposing a runtime failure that did not appear reliably in faster provider paths.

## Problem and impact

Observed on task `0b85d441-6d70-4d40-a89d-e18c2a8a7681` with:

- provider: `ollama`
- model: `gemma3:27b`
- base URL: `http://localhost:11434`

The task ran for roughly 268 seconds, produced analyst reports, then failed with:

- `Attempting to delete a message with an ID that doesn't exist (...)`

Runtime inspection showed:

- `market_report`, `sentiment_report`, `news_report`, and `fundamentals_report` were already present
- the run failed before the downstream debate flow completed

Root cause:

- each parallel analyst branch still performed its own full-message cleanup
- every cleanup node attempted to delete the entire shared `messages` buffer
- under parallel execution, later branches could try to delete message IDs already removed by an earlier branch

## Final decision

Keep message cleanup, but move it out of individual analyst branches and perform it once after analyst convergence.

## Implementation design

- `TradingAgents/tradingagents/graph/conditional_logic.py`
  - analyst continuation now returns `Analyst Join` after the last non-tool message
  - tool-calling branches still loop back through their corresponding tool nodes
- `TradingAgents/tradingagents/graph/setup.py`
  - removed per-analyst `Msg Clear *` nodes from the parallel branches
  - added a single `Msg Clear Analysts` node after `Analyst Join`
  - downstream debate flow now starts only after:
    - all required analyst reports exist
    - one shared cleanup pass completes
- `TradingAgents/tests/test_parallel_analyst_cleanup.py`
  - verifies analyst conditional logic now converges on `Analyst Join`
  - verifies tool-call routing remains unchanged

## Testing and validation

Validated locally with:

```bash
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/graph/conditional_logic.py /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/graph/setup.py /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tests/test_parallel_analyst_cleanup.py
cd /Users/linyuxuan/workSpace/FinGOAT && python -m unittest TradingAgents.tests.test_parallel_analyst_cleanup
cd /Users/linyuxuan/workSpace/FinGOAT/services/trading-service && python -m unittest tests.mock_pipeline.test_mock_analysis_pipeline
```

Live validation with the updated trading service and a fresh Ollama task:

- submitted task `ba388fdd-d332-4b94-87b1-a0bfedab6a6c`
- confirmed the task progressed beyond the previous failure point
- confirmed runtime state now contains `investment_debate_state` content, which the failing historical run never reached
- no recurrence of the duplicate message deletion error was observed during the validated window

## Outcome and follow-up

Status: implemented.

Remaining gap:

- the Ollama path still surfaces separate provider/config issues outside this cleanup bug, such as non-Ollama embeddings routing and broader provider-fidelity cleanup
