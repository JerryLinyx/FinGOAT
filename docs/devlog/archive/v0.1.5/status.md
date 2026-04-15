# v0.1.5 Status

## Summary

`v0.1.5` 是运行边界收敛与分析治理准备版。它不是 `v0.2.0` 的产品闭环版本，而是把主线从“可运行工程骨架”推进到“更清晰、更可维护、更适合继续做分析质量闭环”的中间稳定快照。

相较于 `v0.1.4`，本次封版最重要的变化是：

- Go trading API 进一步固定为唯一产品边界
- Python `trading-service` 收敛为内部 runtime / result / SSE / health 服务
- legacy `articles`、`langchain-v1`、TradingAgents CLI 和 deprecated Python public endpoints 退出主仓
- Web/API 补齐分析导出和高级分析配置
- Go/Python 分析 payload 增加轻量 contract 文档和漂移检查脚本
- `ADR-046`、`ADR-047`、`ADR-048` 冻结了 `v0.2.0` 的核心分析治理需求

## Confirmed core capabilities

- Go 仍是外部业务 API 主边界，负责 auth / profile / feed / trading / usage / admin。
- Trading analysis 支持：
  - 创建、查询、取消、恢复
  - SSE / stage-first 展示
  - completed task 的 `json` / `markdown` 导出
  - `selected_analysts`
  - `max_debate_rounds`
  - `max_risk_discuss_rounds`
- Python trading service 作为内部执行服务运行：
  - Redis queue 消费
  - runtime checkpoint 写回
  - task usage 采集与回灌
  - internal result / SSE / health endpoints
- market-data service 已独立承担：
  - `quote`
  - `chart`
  - `terminal`
  - `CN / US` 市场参数归一化
- Feed 成为唯一内容域，旧 `articles` 系统已移除。
- PgVector memory 基础存在，但仍主要是 reflection memory 基础，不等同于 completed report vector memory。
- `.reference/` 已作为本地 Git-ignored 外部参考项目目录，相关条目维护在 `.reference/README.local.md`，不进入版本提交。

## Confirmed release limitations

- `v0.1.5` 不包含 strict fail-closed completion：required stage 失败后的完整失败状态、重试 UX 和写入门禁仍未落地。
- `failed_recoverable`、`incomplete`、`expired` 等恢复态仍是 `ADR-046` 需求。
- Evidence Ledger、Report Memory、Signal Ledger 和 outcome evaluation 仍是 `ADR-047` / `ADR-048` 需求。
- OpenClaw workflow 仍是 `7/9` single-agent stages，不包含 `research_debate / risk_debate` multi-agent protocol。
- OpenClaw stage-level token usage 仍未完整回传。
- Feed ingest 仍有 malformed UTF-8 文本清洗缺口。
- Go/Python 分析结果仍保留部分动态 JSON 区域，后续仍要继续收紧 typed contract。

## Test and validation summary

本次封版实际执行：

- `python3 scripts/refresh_devlog_records_index.py`: pass
- `python3 scripts/check_api_contracts.py`: pass
- `git diff --check`: pass
- `backend/`: `go test ./...`: pass
- `frontend/`: `npm run build`: pass, with existing chunk-size and browser data warnings
- `services/trading-service`: containerized `tests.mock_pipeline.test_mock_analysis_pipeline`: pass, 5 tests, with existing FastAPI / Pydantic deprecation warnings
- Docker Compose smoke:
  - all FinGOAT containers reported healthy / running
  - `http://127.0.0.1/api/health`: pass
  - `http://127.0.0.1/`: pass

Not counted as release validation:

- Repository-root `go test ./...` is not applicable because the Go module is under `backend/`.
- Local-host Python unittest execution is not applicable without the service dependencies in the host Python environment.
- Containerized `python -m unittest test_analysis_report_serialization` discovered 0 tests, so it is not counted as a passing test suite.

## Outcome

`v0.1.5` 可以视为“运行边界与仓库结构收口后的治理准备版”：

- 旧入口和重复系统已清理
- Web/API 覆盖原 CLI 的主要用户能力
- 分析配置和导出能力进入产品主线
- `v0.2.0` 的重点被收窄到完整性、时序证据、报告记忆、信号评估和反思闭环

## Follow-up for next version

- 实现 `ADR-046` strict completion / recovery contract
- 实现 `ADR-047` Evidence Ledger 与 Report Memory
- 实现 `ADR-048` Signal Ledger 与 post-outcome reflection loop
- 继续推进 OpenClaw `9/9` multi-agent protocol
- 增加 reference project adoption review 模板，并先完成 license / architecture-fit review
