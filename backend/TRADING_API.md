# Go Backend Trading API Documentation

## Overview
Go backend now integrates with the TradingAgents Python microservice, providing authenticated endpoints for stock trading analysis.

## API Endpoints

### Authentication Required
All `/api/trading/*` endpoints require JWT authentication via `Authorization: Bearer <token>` header.

---

## 1. Request Trading Analysis

**Endpoint**: `POST /api/trading/analyze`

**Description**: Submit a new stock analysis request to TradingAgents service.

**Request**:
```json
{
  "ticker": "NVDA",
  "date": "2024-05-10"
}
```

**Response** (202 Accepted):
```json
{
  "ID": 1,
  "CreatedAt": "2024-12-08T23:50:00Z",
  "UpdatedAt": "2024-12-08T23:50:00Z",
  "user_id": 1,
  "task_id": "abc-123-def",
  "ticker": "NVDA",
  "analysis_date": "2024-05-10",
  "status": "pending"
}
```

---

## 2. Get Analysis Result

**Endpoint**: `GET /api/trading/analysis/:task_id`

**Description**: Retrieve analysis result by task ID. Auto-updates from Python service if still processing.

**Response** (200 OK):
```json
{
  "ID": 1,
  "task_id": "abc-123-def",
  "ticker": "NVDA",
  "status": "completed",
  "decision": {
    "action": "BUY",
    "confidence": 0.85,
    "analysis_report": "{ ... full JSON report ... }"
  },
  "processing_time_seconds": 234.5,
  "completed_at": "2024-12-08T23:54:00Z"
}
```

---

## 3. List User Analyses

**Endpoint**: `GET /api/trading/analyses`

**Description**: Get all analysis tasks for the authenticated user (last 20).

**Response** (200 OK):
```json
{
  "tasks": [
    {
      "task_id": "...",
      "ticker": "NVDA",
      "status": "completed",
      "decision": { ... }
    }
  ],
  "total": 5
}
```

---

## 4. Get Analysis Statistics

**Endpoint**: `GET /api/trading/stats`

**Description**: Get summary statistics of user's analyses.

**Response** (200 OK):
```json
{
  "total_analyses": 15,
  "completed": 12,
  "failed": 1,
  "pending": 2,
  "decisions": {
    "buy": 5,
    "sell": 3,
    "hold": 4
  }
}
```

---

## 5. Check Service Health

**Endpoint**: `GET /api/trading/health`

**Description**: Check if Python trading service is available.

**Response** (200 OK):
```json
{
  "status": "healthy",
  "trading_service": {
    "status": "healthy",
    "service": "tradingagents-service",
    "version": "1.0.0"
  }
}
```

---

## Database Schema

### trading_analysis_tasks
```sql
- id (auto increment)
- user_id (foreign key → users.id)
- task_id (unique, from Python service)
- ticker (stock symbol)
- analysis_date
- status (pending/processing/completed/failed)
- completed_at
- processing_time_seconds
- error (if failed)
- config (JSONB)
- created_at, updated_at
```

### trading_decisions
```sql
- id (auto increment)
- task_id (foreign key → trading_analysis_tasks.task_id)
- action (BUY/SELL/HOLD)
- confidence (0.0 - 1.0)
- position_size
- analysis_report (JSONB - complete agent outputs)
- raw_decision (JSONB)
- created_at, updated_at
```

---

## Complete Flow Example

### 1. Login/Register
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "user@example.com", "password": "password"}'

# Response: {"token": "eyJ..."}
```

`/api/auth/login` prefers `{ "identifier": "...", "password": "..." }` where
`identifier` may be an email or a username. Legacy `{ "username": "...", "password": "..." }`
and `{ "email": "...", "password": "..." }` request bodies are still accepted for migration compatibility.

### 2. Request Analysis
```bash
curl -X POST http://localhost:8080/api/trading/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJ..." \
  -d '{"ticker": "TSLA", "date": "2024-05-10"}'

# Response: {"task_id": "xyz-789", "status": "pending"}
```

### 3. Check Status (poll every 10s)
```bash
curl http://localhost:8080/api/trading/analysis/xyz-789 \
  -H "Authorization: Bearer eyJ..."

# Initial: {"status": "processing"}
# After 2-5 min: {"status": "completed", "decision": {...}}
```

### 4. View Analysis Report
```bash
# The decision.analysis_report field contains:
# - fundamental_analysis
# - sentiment_analysis  
# - technical_analysis
# - news_analysis
# - bull_researcher / bear_researcher debates
# - trader_analysis
# - risk_assessment
# - Complete message history
```

---

## Error Handling

### Common Errors

**401 Unauthorized**:
```json
{"error": "user not authenticated"}
```

**404 Not Found**:
```json
{"error": "task not found"}
```

**503 Service Unavailable**:
```json
{
  "status": "unavailable",
  "message": "trading service is down"
}
```

---

## Integration Notes

1. **Python Service Must Be Running**: Ensure `trading_service.py` is running on port 8001
2. **Database**: PostgreSQL must be running (auto-migrates on startup)
3. **Authentication**: All endpoints require valid JWT from `/api/auth/login`
4. **CORS**: Frontend (localhost:5173) is whitelisted
5. **Async Processing**: Analysis takes 2-5 minutes, use polling or webhooks

---

## Testing

```bash
# Recommended full-stack startup from repo root
docker compose up --build

# Then test endpoints against the compose stack
# (See examples above)
```

---

## Future Enhancements

- [ ] WebSocket support for real-time progress
- [ ] Background job processing (instead of blocking HTTP)
- [ ] Result caching in Redis
- [ ] Batch analysis endpoints
- [ ] Analysis history export (CSV/JSON)
- [ ] Email notifications when analysis completes
