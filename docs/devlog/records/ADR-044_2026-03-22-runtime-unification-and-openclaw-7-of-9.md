---
id: ADR-044
kind: decision
title: 2026-03-22 Runtime Unification And OpenClaw 7-of-9 Rollout
date: 2026-03-22
status: active
supersedes: null
superseded_by: null
implements:
  - ADR-037
  - ADR-042
verified_by: []
---

# 2026-03-22 Runtime Unification And OpenClaw 7-of-9 Rollout

## Background

主线分析已经具备：

- LangChain provider factory
- canonical `stages[]`
- 顶层四个 analyst 子进程化与 SSE/Redis Streams
- OpenClaw gateway / per-user agent registry

但运行时契约仍有两个缺口：

1. usage/token 归一化没有覆盖 `ollama`
2. OpenClaw workflow 仍主要停留在顶层四个 analyst，`portfolio_manager / trader_plan / risk_management` 没有进入同一套 stage backend 语义

同时，前端配置仍把 `api / ollama / openclaw` 混成一层选择，用户无法明确区分“分析模式”和“底层模型提供方”。

## Problem and impact

- Ollama 分析虽然能运行，但 stage token 统计缺失，usage 面板与 analysis UI 对本地模型不可见。
- OpenClaw 只能覆盖 4 个顶层 analyst，后续 workflow 语义仍断开，无法形成更一致的 stage backend 演进路径。
- `__stage_*` 元数据已经存在，但缺少明确的 runtime contracts 去承载 stage 输入输出，新增 backend 时容易继续散落特判。
- 前端配置混合了 execution backend 和 model provider，导致 `ollama` 被当成整个模式，而不是一个 provider。

## Options considered

### Option A: 新增一层 `ModelProviderAdapter`

不采用。

原因：

- LangChain 已经承担了 provider abstraction
- 这次真实需要补的是 usage normalization，而不是重复包装 `.invoke()` / `.stream()`
- 再叠一层 adapter 会增加抽象成本，但不解决主要缺口

### Option B: 保留 provider factory，只统一 runtime contracts 与 selected-stage backend

采用。

做法：

- 保留现有 `build_llm()`
- 新增 `normalize_usage(provider, result)`
- 正式定义 `StageRequest / StageResult / ExecutionBackend`
- OpenClaw 先扩到 7/9 stage
- `research_debate / risk_debate` 留待下一期 multi-agent protocol

## Final decision

### 1. 保留现有 provider factory，只补 usage normalization

新增 `services/python-common/provider_usage.py`：

- 引入 `UsageMetrics`
- 提供 `normalize_usage(provider, result)`
- 优先读取：
  - `usage_metadata`
  - `response_metadata.token_usage / usage`
- 对 `ollama` 额外读取：
  - `prompt_eval_count`
  - `eval_count`
  - `generation_info.model`

`UsageCollector` 不再自己判断 provider 细节，只依赖统一的 usage 归一化函数。

结果：

- Ollama 现在重新进入 stage token 统计链
- 现有 OpenAI / DashScope 路径保持不变

### 2. 正式定义 runtime contracts

新增 `TradingAgents/tradingagents/runtime/`：

- `StageRequest`
- `StageResult`
- `StageEvent`
- `ExecutionBackend`

并在同目录新增 backend 实现：

- `LangGraphExecutionBackend`
- `OpenClawExecutionBackend`

这次统一不覆盖所有 stage，而是先用于可单 agent 化的 selected stages。

### 3. 提取 3 个单 agent stage 的独立 callable

将以下 stage 从 graph node 逻辑中抽出可复用函数：

- `portfolio_manager`
- `trader_plan`
- `risk_management`

具体包括：

- `build_portfolio_manager_prompt / run_portfolio_manager_stage`
- `build_trader_messages / run_trader_stage`
- `build_risk_management_prompt / run_risk_management_stage`

其中顺手修复了风险管理 prompt 的一个旧 bug：

- `fundamentals_report` 原先误读成了 `news_report`

### 4. Graph node 变成 thin wrapper

`GraphSetup` 现在根据：

- `execution_mode`
- `USE_UNIFIED_BACKEND`

对这 3 个 stage 做 backend 路由：

- `Standard + USE_UNIFIED_BACKEND=true` -> `LangGraphExecutionBackend`
- `OpenClaw` -> `OpenClawExecutionBackend`
- 其他情况继续 legacy path

graph node 的职责只剩：

- 构造 `StageRequest`
- 调 backend
- 把 `StageResult` 写回 state 的 `__stage_*` 元数据

### 5. OpenClaw 扩到 7/9 stage

OpenClaw gateway 与 adapter 这次扩展到：

- `market`
- `social`
- `news`
- `fundamentals`
- `portfolio_manager`
- `trader_plan`
- `risk_management`

不扩展：

- `research_debate`
- `risk_debate`

原因：

- 这两类 stage 本质上是 multi-agent / multi-round debate
- 当前单次 `run_stage()` 协议不适合直接承载

新增 3 个 stage 的 OpenClaw prompt 不是重写，而是直接复用现有 LangGraph stage prompt 生成逻辑，只改变承载形式：

- adapter 把 prompt 文本作为 `instructions.stage_prompt` 传给 gateway
- gateway 优先使用 `stage_prompt`

### 6. StageResult 成为更稳定的主契约

`services/trading-service/trading_service.py` 的 canonical stage rows 现在显式携带：

- `backend`
- `provider`
- `summary`
- `duration_seconds`
- `prompt_tokens / completion_tokens / total_tokens`

内部仍保留 `__stage_*` flat keys 作为兼容层，但 API 与前端消费的事实来源继续收敛到 `stages[]`。

### 7. 前端改成 Analysis Mode + Model Provider

前端配置不再把 `ollama` 当作整个 execution mode。

现在的用户语义是：

- `Analysis Mode`
  - `Standard`
  - `OpenClaw`
- `Model Provider`
  - `OpenAI / Anthropic / Gemini / DeepSeek / DashScope / Ollama`

其中：

- `Standard` 仍会根据 provider 渲染 cloud / ollama 的不同配置项
- `OpenClaw` 也继续使用同一套 provider/model 作为底层模型选择

这让 execution backend 与 model provider 至少在用户界面语义上被拆开了。

## Follow-up

- 设计并实现 `research_debate / risk_debate` 的 multi-agent OpenClaw protocol，把 7/9 推到 9/9
- 让 OpenClaw gateway 返回 stage-level token usage，而不只是 `provider / duration / summary`
- 继续把 legacy `default/openclaw` 执行路径收敛到统一 backend，但通过服务端 rollout 开关逐步切换，不做 big bang

## Review follow-up

实现合并前，又补了一轮契约审查和修复，收口了这批运行时边界问题：

- Go `AnalysisTaskStage` 现在显式保留并解析 `provider`，不再在 Python -> Go -> frontend 这段链路里静默丢字段
- `AgentState` 补充了 `__stage_usage / __stage_times / __stages` 这些运行时扩展键，避免 TypedDict 与 LangGraph state 的隐式漂移继续扩大
- unified runtime 的 summary normalization 与 trading-service 保持一致：
  - dict 优先取语义字段
  - 否则走 JSON 序列化，而不是 Python `repr`
- OpenClaw adapter 的 agent bootstrap 现在优先使用 `StageRequest.user_id`，避免 workflow request 本身带了用户标识时，adapter 仍因为构造期缺失 `self.user_id` 而失败
- OpenClaw adapter 的 HTTP timeout 改为读取 `llm_timeout` 配置，默认 `300s`，避免 `portfolio_manager / trader_plan / risk_management` 在慢模型上被固定 `30s` 提前打断
- `risk_manager.py` 清掉了无意义未使用 import
- Docker Compose 现在显式向 `backend` 和 `trading-service` 注入 `OPENCLAW_GATEWAY_URL=http://host.docker.internal:18789`，避免容器继续回退到错误的 `localhost:8011`
- 同时确认了一个产品边界：
  - 前端聊天页的 4 个 agent match 仍是历史 Chat MVP
  - workflow 执行并不依赖这 4 个手动绑定
  - workflow 走的是 gateway 自动确保的 7 个专用 workflow agents，session namespace 也与聊天页隔离

## Verification

- `python3 -m py_compile TradingAgents/tradingagents/agents/managers/research_manager.py TradingAgents/tradingagents/agents/managers/risk_manager.py TradingAgents/tradingagents/agents/trader/trader.py TradingAgents/tradingagents/openclaw/adapter.py TradingAgents/tradingagents/graph/setup.py TradingAgents/tradingagents/runtime/contracts.py TradingAgents/tradingagents/runtime/execution.py services/python-common/provider_usage.py services/python-common/usage_collector.py services/trading-service/trading_service.py`
- `node --check openclaw-gateway/server.mjs`
- `cd frontend && npm run build`
- `python3 -m unittest services.trading-service.tests.mock_pipeline.test_provider_usage services.trading-service.tests.mock_pipeline.test_openclaw_stage_contract services.trading-service.tests.mock_pipeline.test_mock_analysis_pipeline`
- `go test ./...` in `backend`
- `python3 -m unittest TradingAgents.tests.test_openclaw_adapter TradingAgents.tests.test_openai_tool_key_routing`

## Traceability Note

When implementation work lands, reference the stable ADR ID in commit messages and, for non-obvious architectural choices, in short code comments.
