# v0.1.5 Interfaces

## External-facing Go API boundary

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/verify-email`
- `POST /api/user/resend-verification`
- `GET /api/exchangeRates`
- `POST /api/exchangeRates`
- `GET /api/feed`
- `GET /api/feed/sources`
- `GET /api/feed/preferences`
- `PUT /api/feed/preferences`
- `POST /api/feed/items/:id/like`
- `POST /api/feed/items/:id/save`
- `GET /api/user/profile`
- `PUT /api/user/profile`
- `GET /api/user/api-keys`
- `PUT /api/user/api-keys/:provider`
- `DELETE /api/user/api-keys/:provider`
- `GET /api/usage/summary`
- `GET /api/admin/usage/summary`
- `GET /api/admin/usage/users`
- `POST /api/trading/analyze`
- `GET /api/trading/analysis/:task_id`
- `GET /api/trading/analysis/:task_id/stream`
- `GET /api/trading/analysis/:task_id/export.json`
- `GET /api/trading/analysis/:task_id/export.md`
- `POST /api/trading/analysis/:task_id/cancel`
- `POST /api/trading/analysis/:task_id/resume`
- `GET /api/trading/analyses`
- `GET /api/trading/stats`
- `GET /api/trading/health`
- `GET /api/trading/chart/:ticker`
- `GET /api/trading/terminal/:ticker`
- `GET /api/trading/quote/:ticker`
- `GET /api/trading/ollama/models`

## Trading analysis request contract

Core request fields:

- `ticker`
- `market`
- `date`
- `execution_mode`
- `selected_analysts`
- `llm_config`
- `data_vendor_config`

Advanced analysis fields:

- `selected_analysts`: one or more of `market`, `social`, `news`, `fundamentals`
- `llm_config.max_debate_rounds`: `1-5`
- `llm_config.max_risk_discuss_rounds`: `1-5`

## Trading analysis response contract

Core response fields:

- `task_id`
- `ticker`
- `market`
- `analysis_date`
- `status`
- `execution_mode`
- `stages`
- `analysis_report`
- `decision`

`stages` is the primary frontend consumption model. `analysis_report` remains a compatibility payload.

## Export contract

- `GET /api/trading/analysis/:task_id/export.json`
- `GET /api/trading/analysis/:task_id/export.md`

Exports are only available after the task reaches `completed`.

Export payload includes:

- task metadata
- selected analysts
- provider/model metadata when available
- final decision
- stage summaries and usage counters
- sanitized full analysis report

## Python trading-service boundary

Python trading-service is internal. It owns:

- queue consumption
- runtime checkpoint writes
- internal result/SSE reads for Go aggregation
- health reporting

It no longer owns public task creation as a product API.

## Local-only reference corpus

`.reference/` is intentionally Git-ignored and is not an external product interface. It stores local clones and local notes for future design review only.
