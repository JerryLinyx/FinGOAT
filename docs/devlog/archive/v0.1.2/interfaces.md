# v0.1.2 Interfaces

## External-facing (Go API boundary)

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/exchangeRates`
- `POST /api/exchangeRates`
- `GET /api/articles`
  - supports `?refresh=true` smart refresh semantics
- `GET /api/articles/refresh`
  - force ingest / management-style refresh
- `GET /api/articles/:id`
- `POST /api/articles`
- `POST /api/articles/:id/like`
- `GET /api/articles/:id/like`
- `POST /api/trading/analyze`
- `GET /api/trading/analysis/:task_id`
- `POST /api/trading/analysis/:task_id/cancel`
- `POST /api/trading/analysis/:task_id/resume`
- `GET /api/trading/analyses`
- `GET /api/trading/stats`
- `GET /api/trading/health`
- `GET /api/trading/chart/:ticker`

Core analysis payload notes:

- request supports `execution_mode` (`default` / `openclaw`)
- task response includes `execution_mode` and `stages`
- `analysis_report` is still returned for compatibility

## Internal Python service (runtime/worker service)

- `GET /`
- `GET /health`
- `POST /api/v1/analyze`
- `POST /api/v1/analyze/sync`
- `GET /api/v1/analysis/{task_id}`
- `GET /api/v1/tasks`
- `DELETE /api/v1/analysis/{task_id}`
- `GET /api/v1/config`

Note: these task endpoints still exist in `v0.1.2` but are not the recommended external product boundary.

## Frontend-local OpenClaw chat interface

This is not a Go-backed product API yet. The browser connects directly to the local OpenClaw gateway:

- dashboard URL input: `http://127.0.0.1:<port>/#token=...`
- websocket connect to local OpenClaw gateway
- `agents.list`
- `sessions.list`
- `chat.history`
- `chat.send`

## Internal tool/data interface (TradingAgents logical tools)

- `get_stock_data`
- `get_indicators`
- `get_fundamentals`
- `get_balance_sheet`
- `get_cashflow`
- `get_income_statement`
- `get_news`
- `get_global_news`
- `get_insider_sentiment`
- `get_insider_transactions`
