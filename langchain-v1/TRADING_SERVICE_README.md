# TradingAgents FastAPI Microservice

A FastAPI-based microservice that wraps the TradingAgents multi-agent LLM framework for financial trading analysis.

For normal local development, do not start this service manually first. The repository default startup flow is root-level:

```bash
docker compose up --build
```

Use the manual commands in this document only when you are debugging the trading service in isolation.

## Features

- **Async & Sync Analysis**: Support both asynchronous and synchronous trading analysis
- **RESTful API**: Clean REST endpoints for easy integration with Go backend
- **Task Management**: Track analysis status with unique task IDs
- **Configurable**: Flexible LLM and data vendor configuration
- **CORS Enabled**: Ready for cross-origin requests from frontend
- **Auto Documentation**: Interactive API docs at `/docs` and `/redoc`

## Architecture

```
Go Backend → FastAPI Service → TradingAgents Framework
     ↓              ↓                    ↓
PostgreSQL    Task Queue         Alpha Vantage/yfinance
```

## Installation

1. **Install dependencies**:
```bash
cd langchain-v1
pip install -r requirements.txt
```

2. **Configure environment variables**:
```bash
cp .env.trading .env
# Edit .env with your API keys
```

Required API keys:
- `OPENAI_API_KEY`: OpenAI API key for LLM models
- `ALPHA_VANTAGE_API_KEY`: Alpha Vantage API key for financial data

## Running the Service

### Full Stack (Recommended)

From the repo root:

```bash
docker compose up --build
```

### Service-Only Debugging

### Development Mode
```bash
python trading_service.py
```

The service will start on `http://localhost:8001`

### Production Mode
```bash
uvicorn trading_service:app --host 0.0.0.0 --port 8001 --workers 4
```

## API Endpoints

### Health Check
```bash
GET /health
```

### Analyze Stock (Async)
```bash
POST /api/v1/analyze
Content-Type: application/json

{
  "ticker": "NVDA",
  "date": "2024-05-10",
  "llm_config": {
    "deep_think_llm": "gpt-4o-mini",
    "quick_think_llm": "gpt-4o-mini",
    "max_debate_rounds": 1
  }
}
```

**Response**: Returns immediately with task_id
```json
{
  "task_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "pending",
  "ticker": "NVDA",
  "date": "2024-05-10",
  "created_at": "2024-05-10T12:00:00"
}
```

### Get Analysis Result
```bash
GET /api/v1/analysis/{task_id}
```

**Response**:
```json
{
  "task_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "completed",
  "ticker": "NVDA",
  "date": "2024-05-10",
  "decision": {
    "action": "BUY",
    "confidence": 0.85,
    "position_size": 100,
    "raw_decision": {...}
  },
  "created_at": "2024-05-10T12:00:00",
  "completed_at": "2024-05-10T12:05:30",
  "processing_time_seconds": 330.5
}
```

### Analyze Stock (Sync)
```bash
POST /api/v1/analyze/sync
```
⚠️ **Warning**: This endpoint blocks until analysis completes (may take several minutes)

### List Recent Tasks
```bash
GET /api/v1/tasks?limit=10
```

### Get Default Config
```bash
GET /api/v1/config
```

## Configuration

### LLM Configuration
```json
{
  "llm_config": {
    "deep_think_llm": "gpt-4o-mini",
    "quick_think_llm": "gpt-4o-mini",
    "max_debate_rounds": 1,
    "max_risk_discuss_rounds": 1
  }
}
```

### Data Vendor Configuration
```json
{
  "data_vendor_config": {
    "core_stock_apis": "yfinance",
    "technical_indicators": "yfinance",
    "fundamental_data": "alpha_vantage",
    "news_data": "alpha_vantage"
  }
}
```

## Integration with Go Backend

### Example Go HTTP Client

```go
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
)

type AnalysisRequest struct {
    Ticker string `json:"ticker"`
    Date   string `json:"date"`
}

type AnalysisResponse struct {
    TaskID string `json:"task_id"`
    Status string `json:"status"`
    Ticker string `json:"ticker"`
    Date   string `json:"date"`
}

func requestAnalysis(ticker, date string) (*AnalysisResponse, error) {
    url := "http://localhost:8001/api/v1/analyze"
    
    reqBody := AnalysisRequest{
        Ticker: ticker,
        Date:   date,
    }
    
    jsonData, _ := json.Marshal(reqBody)
    resp, err := http.Post(url, "application/json", bytes.NewBuffer(jsonData))
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var result AnalysisResponse
    json.NewDecoder(resp.Body).Decode(&result)
    
    return &result, nil
}

func getAnalysisResult(taskID string) (*AnalysisResponse, error) {
    url := fmt.Sprintf("http://localhost:8001/api/v1/analysis/%s", taskID)
    
    resp, err := http.Get(url)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var result AnalysisResponse
    json.NewDecoder(resp.Body).Decode(&result)
    
    return &result, nil
}
```

## API Documentation

Once the service is running, visit:
- **Swagger UI**: http://localhost:8001/docs
- **ReDoc**: http://localhost:8001/redoc

## Error Handling

The service returns standard HTTP status codes:
- `200`: Success
- `202`: Accepted (async task created)
- `400`: Bad Request (invalid input)
- `404`: Not Found (task not found)
- `500`: Internal Server Error

Error response format:
```json
{
  "detail": "Error message describing what went wrong"
}
```

## Logging

Logs are written to stdout with the format:
```
2024-05-10 12:00:00 - trading_service - INFO - Starting analysis for task 123...
```

## Performance Notes

- **Async Analysis**: Recommended for production use
  - Returns immediately with task_id
  - Check status via GET `/api/v1/analysis/{task_id}`
  - Typical analysis time: 2-5 minutes

- **Sync Analysis**: For testing only
  - Blocks until complete
  - May timeout in production environments

## TODO / Future Enhancements

- [ ] Replace in-memory task storage with Redis
- [ ] Add Celery for distributed task queue
- [ ] Implement batch analysis optimization
- [ ] Add result caching
- [ ] WebSocket support for real-time updates
- [ ] Add authentication/API keys
- [ ] Rate limiting
- [ ] Docker containerization
- [ ] Metrics and monitoring (Prometheus)

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
- Use async endpoint instead of sync
- Reduce `max_debate_rounds` in configuration
- Consider using faster LLM models (e.g., gpt-4o-mini)

## License

Same as TradingAgents and FinGOAT projects.
