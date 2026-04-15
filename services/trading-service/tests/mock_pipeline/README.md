# Mock Analysis Pipeline Test

This directory contains a no-network regression test for the trading analysis
pipeline.

What it covers:
- `enqueue_analysis_request(...)` creates a queued task
- the queued payload is processed with a fake `TradingAgentsGraph`
- task state is persisted and later returned by `GET /api/v1/analysis/{task_id}`

What it avoids:
- real LLM calls
- real market/news vendor calls
- real Redis dependency

Run it from `services/trading-service`:

```bash
python -m unittest tests.mock_pipeline.test_mock_analysis_pipeline
```
