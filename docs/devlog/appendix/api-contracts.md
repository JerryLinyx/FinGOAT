---
title: API Contracts
last_verified: 2026-03-27
verified_against: v0.2.0-dev
---

# API Contracts

本文件是 Go / Python 共享分析契约的人类可读清单。Python 运行时类型仍是实现源，Go 结构体必须覆盖这里列出的字段。

## AnalysisRequest

默认：`market=us`，`execution_mode=default`，`selected_analysts=["market","social","news","fundamentals"]`

- `task_id`
- `user_id`
- `ticker`
- `market`
- `date`
- `execution_mode`
- `selected_analysts`
- `llm_config`
- `data_vendor_config`
- `alpha_vantage_api_key`

约束：

- `selected_analysts` 仅允许 `market`、`social`、`news`、`fundamentals`
- `selected_analysts` 不允许空数组
- `date` 为 `YYYY-MM-DD`
- US ticker 1-10 位；A 股 ticker 为 6 位数字

## LLMConfig

默认：`provider=ollama`，`max_debate_rounds=1`，`max_risk_discuss_rounds=1`

- `deep_think_llm`
- `quick_think_llm`
- `max_debate_rounds`
- `max_risk_discuss_rounds`
- `provider`
- `base_url`
- `api_key`

约束：

- `max_debate_rounds` 范围 `1-5`
- `max_risk_discuss_rounds` 范围 `1-5`

## DataVendorConfig

- `core_stock_apis`
- `technical_indicators`
- `fundamental_data`
- `news_data`

## StageResult

Go 实现名为 `AnalysisTaskStage`，字段必须覆盖 Python `StageResult`：

- `stage_id`
- `label`
- `status`
- `backend`
- `provider`
- `summary`
- `content`
- `agent_id`
- `session_key`
- `raw_output`
- `started_at`
- `completed_at`
- `duration_seconds`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `llm_calls`
- `failed_calls`
- `latency_ms`
- `error`

## Stage IDs / Report Keys

- `market` -> `market_report`
- `social` -> `sentiment_report`
- `news` -> `news_report`
- `fundamentals` -> `fundamentals_report`
- `research_debate` -> `investment_debate_state`
- `portfolio_manager` -> `investment_plan`
- `trader_plan` -> `trader_investment_plan`
- `risk_debate` -> `risk_debate_state`
- `risk_management` -> `final_trade_decision`
