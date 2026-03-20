# v0.1.4 Interfaces

## External-facing (Go API boundary)

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/verify-email`
- `GET /api/exchangeRates`
- `POST /api/exchangeRates`
- `GET /api/articles`
- `GET /api/articles/refresh`
- `GET /api/articles/:id`
- `POST /api/articles`
- `POST /api/articles/:id/like`
- `GET /api/articles/:id/like`
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
- `POST /api/user/resend-verification`
- `POST /api/trading/analyze`
- `GET /api/trading/analysis/:task_id`
- `GET /api/trading/analysis/:task_id/stream`
- `POST /api/trading/analysis/:task_id/cancel`
- `POST /api/trading/analysis/:task_id/resume`
- `GET /api/trading/analyses`
- `GET /api/trading/stats`
- `GET /api/trading/health`
- `GET /api/trading/chart/:ticker`
- `GET /api/trading/terminal/:ticker`
- `GET /api/trading/quote/:ticker`
- `GET /api/trading/ollama/models`
- `GET /api/usage/summary`
- `GET /api/usage/tasks/:task_id`
- `GET /api/admin/usage/summary`
- `GET /api/admin/usage/users`

Core analysis payload notes:

- request supports `market`
- request supports `execution_mode`
- request may include `llm_config` and `data_vendor_config`
- US market analysis requires an Alpha Vantage API key in the current baseline
- task responses expose `stages` as the main progress/result contract

## Internal Python trading service

- `GET /`
- `GET /health`
- `POST /api/v1/analyze`
- `POST /api/v1/analyze/sync`
- `GET /api/v1/analysis/{task_id}`
- `GET /api/v1/tasks`
- `DELETE /api/v1/analysis/{task_id}`
- `GET /api/v1/config`

Note: these endpoints still exist as runtime-service interfaces, but the intended external product boundary remains the Go API.

## Internal Python market-data service

- `GET /`
- `GET /health`
- `GET /api/v1/quote`
- `GET /api/v1/chart`
- `GET /api/v1/terminal`

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
