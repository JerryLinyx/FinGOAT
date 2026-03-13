# v0.1.1 Interfaces

## External-facing (Go API boundary)

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/exchangeRates`
- `POST /api/exchangeRates`
- `GET /api/articles`
- `GET /api/articles/refresh`
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

## Internal Python service (runtime/worker service)

- `GET /`
- `GET /health`
- `POST /api/v1/analyze`
- `POST /api/v1/analyze/sync`
- `GET /api/v1/analysis/{task_id}`
- `GET /api/v1/tasks`
- `DELETE /api/v1/analysis/{task_id}`
- `GET /api/v1/config`

Note: these task endpoints still exist in v0.1.1 but are not the recommended external product boundary.

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
