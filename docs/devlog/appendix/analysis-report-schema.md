# Analysis Report Schema

## Current shape (v0.1.2)

当前任务响应存在两层阶段数据：

- `stages`：主消费字段（frontend 优先使用）
- `analysis_report`：兼容保留字段（包含历史与扩展信息）

`analysis_report` 常见字段：

- `market_report`
- `sentiment_report`
- `news_report`
- `fundamentals_report`
- `investment_debate_state`
- `investment_plan`
- `trader_investment_plan`
- `risk_debate_state`
- `final_trade_decision`
- `messages`
- `raw_state`
- `__stages`（兼容阶段列表）
- `__stage_times`
- `__key_outputs`
- `__total_elapsed`

## Known issues

- `analysis_report` 仍为半结构化兼容层，字段约束不够硬。
- `stages` 与 `analysis_report.__stages` 并存，存在双维护期复杂度。
- 跨服务结构仍有动态 JSON 区域。

## Planned direction (v0.2.0)

- 把 `stages` 固化为唯一主展示契约。
- 将 `analysis_report` 收敛为“可选补充摘要/原始上下文”，并明确退场路径。
- 为关键字段建立强类型 schema 和版本约束。
