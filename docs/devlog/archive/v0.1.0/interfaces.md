# v0.1.0 Interfaces

## External-facing

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
- `GET /api/trading/analyses`
- `GET /api/trading/stats`
- `GET /api/trading/health`

## Internal Python service

- `GET /`
- `GET /health`
- `POST /api/v1/analyze`
- `POST /api/v1/analyze/sync`
- `GET /api/v1/analysis/{task_id}`
- `GET /api/v1/tasks`
- `DELETE /api/v1/analysis/{task_id}`
- `GET /api/v1/config`

## Internal tool/data interface

Key logical tools include:

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

