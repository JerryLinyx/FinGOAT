# Async Graph Execution

## Background

The branch workflow review showed a direction toward async graph execution and better use of parallelism for independent analyst stages.

## Problem and impact

- Mainline graph execution still called synchronous `stream/invoke`.
- After adding async timing wrappers, live runs failed with:
  - `No synchronous function provided to "Market Analyst"`
- Independent analyst stages were also still effectively serialized in the mainline workflow.

## Final decision

Align the graph execution model with the branch direction by switching the graph runtime to async execution and allowing the independent analyst stage fan-out to run in parallel before the downstream debate flow.

## Implementation design

- `TradingAgents/tradingagents/graph/trading_graph.py`
  - `propagate()` now delegates to `asyncio.run(propagate_async(...))`
  - debug mode uses `astream`
  - normal mode uses `ainvoke`
- `TradingAgents/tradingagents/graph/setup.py`
  - timing wrapper remains async-compatible
  - selected analyst nodes now fan out from `START`
  - added `Analyst Join` and `Analyst Wait` nodes
  - progression to downstream debate only happens after all required analyst reports are present
- downstream bull/bear/trader/risk flow remains unchanged for now

## Testing and validation

Validated locally with:

```bash
python -m py_compile /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/graph/setup.py /Users/linyuxuan/workSpace/FinGOAT/TradingAgents/tradingagents/graph/trading_graph.py /Users/linyuxuan/workSpace/FinGOAT/langchain-v1/trading_service.py
```

Live validation after restart:

- restarted trading service with the updated graph
- submitted task `71dc69aa-3f6a-4e4a-8edf-890826627a0f`
- observed real outbound DashScope chat calls
- previous sync/async runtime error (`No synchronous function provided to "Market Analyst"`) did not reappear during the updated run

## Outcome and follow-up

Status: implemented.

Remaining gap:

- a full completed end-to-end run is still needed after the async graph change to close the broader provider-fidelity task
