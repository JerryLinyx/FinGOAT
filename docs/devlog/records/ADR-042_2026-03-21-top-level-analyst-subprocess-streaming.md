---
id: ADR-042
kind: decision
title: 2026-03-21 Top-Level Analyst Subprocess Streaming
date: 2026-03-21
status: active
supersedes: null
superseded_by: null
implements: []
verified_by: []
---

# 2026-03-21 Top-Level Analyst Subprocess Streaming

## Summary

主线分析链原本已经有 LangGraph 内部并发和 Redis Stream/SSE，但顶层四个 analyst 仍然共享同一个 graph 进程与事件流：

- `market / social / news / fundamentals` 虽然在图里并发 fan-out
- 但它们不是独立执行单元
- 取消、透明性、流式事件粒度和前端可见性仍然受限于单一 graph run

这次改造保留 `LangGraph` 作为总骨架，不改变后续 `research / trader / risk / final` 的主流程；只把四个顶层 analyst 升级为独立子进程任务，并让它们持续写入 analyst-aware Redis Streams 事件。分析页也从“单一阶段面板”升级为“顶部实时 analyst grid + 底部现有 stage/final 结果区”的混合视图。

## What changed

### Python orchestration

- `TradingAgentsGraph` 新增：
  - `top_level_only` 配置，允许只跑一个顶层 analyst 并在报告产出后结束
  - `allow_empty_analysts` 配置，允许跳过顶层 analyst，直接从 `Bull Researcher` 开始续跑下游 graph
  - `propagate_from_state_streaming(...)`，支持从预填充 state 继续流式执行
- `services/trading-service/trading_service.py` 新增顶层 analyst fan-out orchestrator：
  - 为 `market / social / news / fundamentals` 各起一个独立子进程
  - 每个子进程运行单 analyst mini-graph
  - 子进程结束后把 stage 内容、metadata、usage、timing 合并回主 state
  - 四个 analyst 全部完成后，再用已有 LangGraph 继续下游 debate/risk/final 阶段

### Redis Streams / SSE contract

- 保留任务总 stream：`trading:stream:{task_id}`
- 新增每个 analyst 的 stream：
  - `trading:stream:{task_id}:analyst:market`
  - `trading:stream:{task_id}:analyst:social`
  - `trading:stream:{task_id}:analyst:news`
  - `trading:stream:{task_id}:analyst:fundamentals`
- 顶层 analyst 子进程现在会发出：
  - `analyst_start`
  - `token`
  - `tool_start`
  - `tool_end`
  - `partial`
  - `analyst_complete`
  - `analyst_error`
  - 以及兼容现有 UI 的 `stage_end`
- Python SSE endpoint 不再只读单个任务 stream，而是合并读取任务主 stream 与 4 个 analyst stream，再由 Go 继续透传给前端。

### Runtime / stage contract

- 顶层 analyst `stages[]` 现在显式标记 `backend=process`
- 这些 stage 的：
  - `started_at`
  - `completed_at`
  - `duration_seconds`
  - `prompt_tokens`
  - `completion_tokens`
  - `total_tokens`
  - `llm_calls`
  - `error`
  都会进入 canonical `stages`
- `analysis_report` 仍保留兼容层，但顶层 analyst metadata 已来自新的 subprocess 路径

### Frontend mixed view

- 分析页新增顶部 `Analyst Live Grid`
  - 固定展示 `Technical / Social Media / News / Fundamentals`
  - 每卡显示状态、最近更新时间、流式 token 文本、耗时、token、当前 tool、完成摘要、错误
- 底部保留现有 `AgentResultsModule`
  - 继续承接完整 stage progress、debate/risk/final decision、raw report
- 前端状态拆成两层：
  - `analystLive`：只保存顶层 analyst 的实时流式状态
  - `currentTask.stages`：继续作为最终对账与 canonical 结果
- 轮询拿到的 `stages` 不再覆盖更细的实时 token buffer

## Verification

- `python3 -m py_compile services/trading-service/trading_service.py TradingAgents/tradingagents/graph/trading_graph.py TradingAgents/tradingagents/graph/setup.py`
- `python3 -m unittest discover -s services/trading-service/tests/mock_pipeline -p 'test_mock_analysis_pipeline.py'`
- `python3 -m unittest discover -s services/trading-service/tests/mock_pipeline -p 'test_analysis_cancellation.py'`
- `python3 -m unittest discover -s services/trading-service/tests/mock_pipeline -p 'test_key_injection.py'`
- `python3 -m unittest TradingAgents.tests.test_embedding_settings TradingAgents.tests.test_openai_tool_key_routing`
- `cd frontend && npm run build`

## Tradeoffs

- 顶层 analyst 现在会多付出 4 个子进程的启动开销。
- 换来的收益是：
  - 更强的取消能力
  - 更清晰的运行时隔离
  - 更透明的 per-analyst 事件流
  - 更接近后续“每个 analyst 都可独立观察/调试”的方向

## Residual Risks

- 这次只进程化了四个顶层 analyst；`bull / bear / trader / risk / final` 仍然是下游 graph 内节点，不是独立子进程。
- Go 仍是“透传型 SSE 代理”，没有做更强的多 stream 聚合语义；真正的 analyst-aware merge 逻辑目前仍在 Python stream endpoint。
- OpenClaw 顶层 analyst 的 token usage 仍未补齐；这次的 stage-level token 可见性主要覆盖默认 subprocess analyst 路径。
