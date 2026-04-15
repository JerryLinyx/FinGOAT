# TradingAgents FastAPI Runtime

This service is the internal execution runtime for trading analysis. It is not the product API boundary; the Go backend owns all user-facing analysis/task/export endpoints.

For normal local development, start the full stack from the repository root:

```bash
docker compose up --build
```

Use the manual commands in this document only when debugging the trading runtime in isolation.

## Responsibilities

- Consume Redis analysis tasks
- Run `TradingAgents` with per-user provider/data-vendor config
- Persist runtime checkpoints and stage results to Redis
- Emit SSE-compatible stream events
- Expose internal result lookup and health endpoints for the Go backend

## Runtime topology

```text
Frontend -> Go backend -> Redis queue -> trading-service -> TradingAgents
Frontend <- Go backend <- Redis runtime/state <- trading-service
Frontend -> Go backend -> market-data-service
```

## Running the Service

### Full Stack (Recommended)

```bash
docker compose up --build
```

### Service-Only Debugging

```bash
cd services/trading-service
python trading_service.py
```

The service will start on `http://localhost:8001`.

## Internal Endpoints

- `GET /health`
- `GET /api/v1/analysis/{task_id}`
- `GET /api/v1/analysis/{task_id}/stream`

Deprecated public task endpoints and duplicate market-data endpoints were removed. New analysis requests must come through Go `POST /api/trading/analyze`, and chart/quote/terminal traffic must go through Go -> `market-data-service`.

## Request Contract Notes

- `selected_analysts` defaults to `["market","social","news","fundamentals"]`
- `selected_analysts` cannot be empty
- `llm_config.max_debate_rounds` and `llm_config.max_risk_discuss_rounds` are constrained to `1-5`
- user/provider secrets are injected by the Go backend before enqueue

## API Documentation

Once the service is running, visit:

- Swagger UI: http://localhost:8001/docs
- ReDoc: http://localhost:8001/redoc

## Logging

Logs are written to stdout with the format:
```
2024-05-10 12:00:00 - trading_service - INFO - Starting analysis for task 123...
```

## Troubleshooting

### Service won't start
- Check that TradingAgents is in the parent directory
- Verify all dependencies are installed
- Check that ports 8001 is available

### Analysis fails
- Verify API keys are set correctly in `.env`
- Check that the ticker symbol is valid
- Ensure date is in correct format (YYYY-MM-DD)
- Check logs for detailed error messages

### Slow performance
- Reduce `max_debate_rounds` in configuration
- Consider using faster LLM models (e.g., gpt-4o-mini)

## License

Same as TradingAgents and FinGOAT projects.
