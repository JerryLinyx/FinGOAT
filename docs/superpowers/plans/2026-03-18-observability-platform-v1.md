# FinGOAT Observability Data Platform v1 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal observability platform covering token/cost tracking, per-user usage isolation, admin global view, and RBAC — all with internal APIs + frontend pages.

**Architecture:** Python-side usage collector captures LLM call metrics (tokens, latency, errors) into Redis. Go backend reads events from Redis on task completion and persists to PostgreSQL. Go serves usage APIs; frontend renders usage cards and admin table. User role field on `users` table + `RequireAdmin` middleware for access control.

**Tech Stack:** Go (Gin/GORM), Python (LangChain callbacks), PostgreSQL, Redis, React/TypeScript

---

## File Structure

### New Files
| Path | Responsibility |
|------|---------------|
| `backend/models/usage.go` | GORM models: `LLMUsageEvent`, `AnalysisRunMetrics` |
| `backend/controllers/usage_controller.go` | 4 usage API handlers (user summary, task detail, admin summary, admin users) |
| `backend/controllers/admin_controller.go` | Admin-only endpoints (user list with usage) |
| `backend/middlewares/role_middleware.go` | `RequireAdmin()` middleware |
| `langchain-v1/usage_collector.py` | `UsageCollector` class: wraps LLM calls, captures metrics, writes to Redis |
| `frontend/src/components/UsagePage.tsx` | User usage card (tokens, cost, task count) |
| `frontend/src/components/AdminDashboard.tsx` | Admin table: user list + per-user usage |
| `frontend/src/services/usageService.ts` | API client for usage endpoints |

### Modified Files
| Path | Change |
|------|--------|
| `backend/models/user.go` | Add `Role` field (`user`/`admin`) |
| `backend/config/migrate.go` | Add `LLMUsageEvent`, `AnalysisRunMetrics` to AutoMigrate + index migration |
| `backend/router/router.go` | Register `/api/usage/*` and `/api/admin/*` routes |
| `backend/middlewares/auth_middleware.go` | Set `c.Set("user_role", user.Role)` in context |
| `backend/controllers/trading_controller.go` | After task completion, read usage events from Redis → persist to DB |
| `langchain-v1/trading_service.py` | Integrate `UsageCollector` into `run_analysis()` and `_run_streaming_analysis_async()` |
| `TradingAgents/tradingagents/graph/trading_graph.py` | Pass usage collector through config, hook into LLM calls |
| `frontend/src/App.tsx` | Add Usage tab, Admin tab (conditional on role), pass role to profile |
| `frontend/src/components/ProfilePage.tsx` | Show usage summary card |
| `frontend/src/types/user.ts` | Add `role` field to `UserProfile` |
| `frontend/src/services/userService.ts` | Include role in profile response type |

---

## Task 1: User Role + RequireAdmin Middleware

**Files:**
- Modify: `backend/models/user.go`
- Create: `backend/middlewares/role_middleware.go`
- Modify: `backend/middlewares/auth_middleware.go`
- Modify: `backend/router/router.go`
- Modify: `backend/controllers/user_controller.go` (GetProfile response)
- Modify: `frontend/src/types/user.ts`

- [ ] **Step 1: Add Role field to User model**

```go
// backend/models/user.go
type User struct {
	gorm.Model
	Username     string  `gorm:"type:varchar(100);not null;uniqueIndex"`
	PasswordHash string  `gorm:"column:password_hash;type:text;not null"`
	Email         *string `gorm:"type:varchar(255);uniqueIndex"`
	EmailVerified bool    `gorm:"default:false"`
	DisplayName   string  `gorm:"type:varchar(100);default:''"`
	AvatarURL    string  `gorm:"type:text;default:''"`
	Role         string  `gorm:"type:varchar(20);default:'user';not null"`
}
```

- [ ] **Step 2: Create RequireAdmin middleware**

```go
// backend/middlewares/role_middleware.go
package middlewares

import (
	"net/http"
	"github.com/gin-gonic/gin"
)

func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("user_role")
		if !exists || role.(string) != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
			c.Abort()
			return
		}
		c.Next()
	}
}
```

- [ ] **Step 3: Set user_role in AuthMiddleware context**

In `backend/middlewares/auth_middleware.go`, after `c.Set("user_id", user.ID)`:
```go
c.Set("user_role", user.Role)
```

- [ ] **Step 4: Add role to GetProfile response**

In `backend/controllers/user_controller.go`, add `"role": user.Role` to both GetProfile and UpdateProfile JSON responses.

- [ ] **Step 5: Update frontend UserProfile type**

```typescript
// frontend/src/types/user.ts
export interface UserProfile {
  id: number
  username: string
  email?: string
  email_verified?: boolean
  display_name?: string
  avatar_url?: string
  role: string  // "user" | "admin"
  created_at: string
}
```

- [ ] **Step 6: Register admin route group in router**

```go
// In backend/router/router.go, after trading routes
admin := api.Group("/admin")
admin.Use(middlewares.RequireAdmin())
{
	// Will be populated in Task 4
}
```

- [ ] **Step 7: Test role middleware**

Run: `cd backend && go build ./...`
Expected: Compiles without errors.

Manual test: existing users should get `role: "user"` by default. Admin user created earlier should be updatable via SQL: `UPDATE users SET role='admin' WHERE username='admin';`

- [ ] **Step 8: Commit**

```bash
git add backend/models/user.go backend/middlewares/role_middleware.go backend/middlewares/auth_middleware.go backend/router/router.go backend/controllers/user_controller.go frontend/src/types/user.ts
git commit -m "feat: add user role field and RequireAdmin middleware"
```

---

## Task 2: LLM Usage Events Table + Migration

**Files:**
- Create: `backend/models/usage.go`
- Modify: `backend/config/migrate.go`

- [ ] **Step 1: Create usage models**

```go
// backend/models/usage.go
package models

import "time"

// LLMUsageEvent captures a single LLM API call's metrics.
type LLMUsageEvent struct {
	ID                uint      `gorm:"primaryKey"`
	TaskID            string    `gorm:"type:varchar(64);not null;index:idx_usage_task"`
	UserID            uint      `gorm:"not null;index:idx_usage_user_time"`
	Provider          string    `gorm:"type:varchar(32);not null"`
	Model             string    `gorm:"type:varchar(64);not null"`
	NodeName          string    `gorm:"type:varchar(64);not null"`
	EventType         string    `gorm:"type:varchar(32);not null"` // chat_completion, embedding, tool_call
	PromptTokens      int       `gorm:"default:0"`
	CompletionTokens  int       `gorm:"default:0"`
	TotalTokens       int       `gorm:"default:0"`
	EstimatedCostUSD  *float64  `gorm:"type:decimal(12,8)"`
	LatencyMs         int       `gorm:"default:0"`
	Success           bool      `gorm:"default:true"`
	ErrorMessage      string    `gorm:"type:text"`
	RequestStartedAt  time.Time `gorm:"not null"`
	RequestCompletedAt time.Time `gorm:"not null"`
	CreatedAt         time.Time `gorm:"autoCreateTime"`
}

// AnalysisRunMetrics aggregates usage for a complete analysis task.
type AnalysisRunMetrics struct {
	ID                  uint     `gorm:"primaryKey"`
	TaskID              string   `gorm:"type:varchar(64);not null;uniqueIndex"`
	UserID              uint     `gorm:"not null;index:idx_run_user"`
	TotalPromptTokens   int      `gorm:"default:0"`
	TotalCompletionTokens int   `gorm:"default:0"`
	TotalTokens         int      `gorm:"default:0"`
	TotalEstimatedCost  *float64 `gorm:"type:decimal(12,8)"`
	TotalLatencyMs      int      `gorm:"default:0"`
	TotalLLMCalls       int      `gorm:"default:0"`
	FailedCalls         int      `gorm:"default:0"`
	Provider            string   `gorm:"type:varchar(32)"`
	Model               string   `gorm:"type:varchar(64)"`
	ProcessingTimeSec   float64  `gorm:"default:0"`
	CreatedAt           time.Time `gorm:"autoCreateTime"`
}
```

- [ ] **Step 2: Add models to AutoMigrate**

In `backend/config/migrate.go`, add to `global.DB.AutoMigrate(...)`:
```go
&models.LLMUsageEvent{},
&models.AnalysisRunMetrics{},
```

- [ ] **Step 3: Add composite index for time-range queries**

In `pgvectorMigrate()` (or a new function), add:
```go
global.DB.Exec(`CREATE INDEX IF NOT EXISTS idx_usage_user_time ON llm_usage_events (user_id, request_started_at DESC)`)
```

- [ ] **Step 4: Verify migration**

Run: `cd backend && go build ./...`
Expected: Compiles. Tables will be created on next startup.

- [ ] **Step 5: Commit**

```bash
git add backend/models/usage.go backend/config/migrate.go
git commit -m "feat: add llm_usage_events and analysis_run_metrics tables"
```

---

## Task 3: Python Usage Collector

**Files:**
- Create: `langchain-v1/usage_collector.py`
- Modify: `langchain-v1/trading_service.py`
- Modify: `TradingAgents/tradingagents/graph/trading_graph.py`
- Modify: `TradingAgents/tradingagents/agents/analysts/market_analyst.py` (and other analysts as pattern)

- [ ] **Step 1: Create UsageCollector class**

```python
# langchain-v1/usage_collector.py
"""
Collects LLM usage metrics (tokens, latency, errors) during analysis runs
and writes them to Redis for Go backend to persist to PostgreSQL.
"""
import json
import logging
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from redis import Redis

logger = logging.getLogger(__name__)

USAGE_EVENTS_KEY_PREFIX = "usage:events"


@dataclass
class UsageEvent:
    task_id: str
    user_id: int
    provider: str
    model: str
    node_name: str
    event_type: str  # chat_completion, embedding, tool_call
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    success: bool = True
    error_message: str = ""
    request_started_at: str = ""
    request_completed_at: str = ""


class UsageCollector:
    """Collects LLM usage events during an analysis run."""

    def __init__(self, task_id: str, user_id: int, provider: str, model: str, redis_client: Redis):
        self.task_id = task_id
        self.user_id = user_id
        self.provider = provider
        self.model = model
        self.redis = redis_client
        self._events: List[UsageEvent] = []

    def record_llm_call(
        self,
        node_name: str,
        result: Any,
        start_time: float,
        event_type: str = "chat_completion",
        error: Optional[str] = None,
    ) -> None:
        """Record a single LLM call's usage from the LangChain result object."""
        end_time = time.time()
        latency_ms = int((end_time - start_time) * 1000)

        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0

        if result is not None:
            # Try LangChain's usage_metadata (preferred)
            usage = getattr(result, "usage_metadata", None)
            if usage and isinstance(usage, dict):
                prompt_tokens = usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0) or 0
                completion_tokens = usage.get("output_tokens", 0) or usage.get("completion_tokens", 0) or 0
                total_tokens = usage.get("total_tokens", 0) or (prompt_tokens + completion_tokens)
            else:
                # Fallback: response_metadata
                resp_meta = getattr(result, "response_metadata", {}) or {}
                token_usage = resp_meta.get("token_usage", resp_meta.get("usage", {})) or {}
                if isinstance(token_usage, dict):
                    prompt_tokens = token_usage.get("prompt_tokens", 0) or 0
                    completion_tokens = token_usage.get("completion_tokens", 0) or 0
                    total_tokens = token_usage.get("total_tokens", 0) or (prompt_tokens + completion_tokens)

        event = UsageEvent(
            task_id=self.task_id,
            user_id=self.user_id,
            provider=self.provider,
            model=self.model,
            node_name=node_name,
            event_type=event_type,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            success=error is None,
            error_message=error or "",
            request_started_at=datetime.fromtimestamp(start_time, tz=timezone.utc).isoformat(),
            request_completed_at=datetime.fromtimestamp(end_time, tz=timezone.utc).isoformat(),
        )
        self._events.append(event)

    def flush_to_redis(self) -> int:
        """Write all collected events to Redis list for Go to pick up."""
        if not self._events:
            return 0
        key = f"{USAGE_EVENTS_KEY_PREFIX}:{self.task_id}"
        pipe = self.redis.pipeline()
        for event in self._events:
            pipe.rpush(key, json.dumps(asdict(event)))
        pipe.expire(key, 86400)  # 24h TTL
        pipe.execute()
        count = len(self._events)
        logger.info("Flushed %d usage events for task %s", count, self.task_id)
        return count
```

- [ ] **Step 2: Integrate collector into trading_service.py run_analysis()**

In `langchain-v1/trading_service.py`, in `run_analysis()` after `_inject_user_keys_to_env(config)`:

```python
from usage_collector import UsageCollector

# Create usage collector
collector = UsageCollector(
    task_id=task_id,
    user_id=request.user_id,
    provider=str(config.get("llm_provider", "unknown")),
    model=str(config.get("quick_think_llm", config.get("deep_think_llm", "unknown"))),
    redis_client=get_redis_client(),
)
config["usage_collector"] = collector
```

After `trading_graph.propagate()` completes (in both success and error paths):
```python
try:
    collector.flush_to_redis()
except Exception as flush_err:
    logger.warning("Failed to flush usage events: %s", flush_err)
```

- [ ] **Step 3: Hook collector into LLM calls in TradingAgents**

Modify `TradingAgents/tradingagents/agents/analysts/market_analyst.py` (and similarly for other analysts) to wrap the chain invoke:

```python
# In market_analyst_node, after chain definition:
collector = state.get("__usage_collector")
start_time = time.time()
result = chain.invoke(sanitize_orphan_tool_calls(state["messages"]))
if collector:
    collector.record_llm_call("Market Analyst", result, start_time)
```

Pass the collector through state by setting it in the initial state in `propagation.py`:
```python
init_state["__usage_collector"] = config.get("usage_collector")
```

- [ ] **Step 4: Apply same pattern to all agent nodes**

Apply the `collector.record_llm_call()` pattern to:
- `social_media_analyst.py` → node_name="Social Analyst"
- `news_analyst.py` → node_name="News Analyst"
- `fundamentals_analyst.py` → node_name="Fundamentals Analyst"
- `bull_researcher.py` → node_name="Bull Researcher"
- `bear_researcher.py` → node_name="Bear Researcher"
- `research_manager.py` → node_name="Research Manager"
- `trader.py` → node_name="Trader"
- Risk debate agents → node_name="Risky/Safe/Neutral Analyst"
- `risk_manager.py` → node_name="Risk Judge"

Each follows the same pattern:
```python
collector = state.get("__usage_collector")
start_time = time.time()
result = chain.invoke(...)
if collector:
    collector.record_llm_call("<Node Name>", result, start_time)
```

- [ ] **Step 5: Test collector standalone**

```bash
cd langchain-v1 && python -c "
from usage_collector import UsageCollector, UsageEvent
import json
e = UsageEvent('test', 1, 'openai', 'gpt-4', 'Market Analyst', 'chat_completion', 100, 50, 150, 1200, True, '', '', '')
print(json.dumps(e.__dict__, indent=2))
print('OK')
"
```

- [ ] **Step 6: Commit**

```bash
git add langchain-v1/usage_collector.py langchain-v1/trading_service.py TradingAgents/
git commit -m "feat: add Python usage collector with Redis event pipeline"
```

---

## Task 4: Go Usage API Endpoints + Redis Event Ingestion

**Files:**
- Create: `backend/controllers/usage_controller.go`
- Modify: `backend/controllers/trading_controller.go` (add usage event ingestion on task complete)
- Modify: `backend/router/router.go`

- [ ] **Step 1: Create cost estimation map**

```go
// In backend/controllers/usage_controller.go
package controllers

// modelPricing holds per-1M-token costs
type modelPricing struct {
	InputPer1M  float64
	OutputPer1M float64
}

var pricingCatalog = map[string]modelPricing{
	// OpenAI
	"gpt-4o":        {InputPer1M: 2.50, OutputPer1M: 10.00},
	"gpt-4o-mini":   {InputPer1M: 0.15, OutputPer1M: 0.60},
	"gpt-4-turbo":   {InputPer1M: 10.00, OutputPer1M: 30.00},
	// Anthropic
	"claude-sonnet-4-20250514": {InputPer1M: 3.00, OutputPer1M: 15.00},
	"claude-haiku-4-20250414":  {InputPer1M: 0.80, OutputPer1M: 4.00},
	// DeepSeek
	"deepseek-chat":   {InputPer1M: 0.14, OutputPer1M: 0.28},
	"deepseek-reasoner": {InputPer1M: 0.55, OutputPer1M: 2.19},
	// DashScope (Qwen)
	"qwen-plus":  {InputPer1M: 0.80, OutputPer1M: 2.00},
	"qwen-turbo": {InputPer1M: 0.30, OutputPer1M: 0.60},
	"qwen-max":   {InputPer1M: 2.40, OutputPer1M: 9.60},
}

func estimateCost(model string, promptTokens, completionTokens int) *float64 {
	pricing, ok := pricingCatalog[model]
	if !ok {
		return nil // unpriced
	}
	cost := float64(promptTokens)/1_000_000*pricing.InputPer1M +
		float64(completionTokens)/1_000_000*pricing.OutputPer1M
	return &cost
}
```

- [ ] **Step 2: Create Redis → PostgreSQL ingestion function**

```go
// In backend/controllers/usage_controller.go

func ingestUsageEventsFromRedis(taskID string, userID uint, provider, model string) {
	ctx := context.Background()
	key := "usage:events:" + taskID

	events, err := global.RedisClient.LRange(ctx, key, 0, -1).Result()
	if err != nil || len(events) == 0 {
		return
	}

	var dbEvents []models.LLMUsageEvent
	var totalPrompt, totalCompletion, totalTokens, totalLatency, totalCalls, failedCalls int
	var totalCost float64
	hasCost := false

	for _, raw := range events {
		var evt struct {
			TaskID            string `json:"task_id"`
			UserID            int    `json:"user_id"`
			Provider          string `json:"provider"`
			Model             string `json:"model"`
			NodeName          string `json:"node_name"`
			EventType         string `json:"event_type"`
			PromptTokens      int    `json:"prompt_tokens"`
			CompletionTokens  int    `json:"completion_tokens"`
			TotalTokens       int    `json:"total_tokens"`
			LatencyMs         int    `json:"latency_ms"`
			Success           bool   `json:"success"`
			ErrorMessage      string `json:"error_message"`
			RequestStartedAt  string `json:"request_started_at"`
			RequestCompletedAt string `json:"request_completed_at"`
		}
		if json.Unmarshal([]byte(raw), &evt) != nil {
			continue
		}

		startedAt, _ := time.Parse(time.RFC3339, evt.RequestStartedAt)
		completedAt, _ := time.Parse(time.RFC3339, evt.RequestCompletedAt)
		cost := estimateCost(evt.Model, evt.PromptTokens, evt.CompletionTokens)

		dbEvents = append(dbEvents, models.LLMUsageEvent{
			TaskID:             evt.TaskID,
			UserID:             userID,
			Provider:           evt.Provider,
			Model:              evt.Model,
			NodeName:           evt.NodeName,
			EventType:          evt.EventType,
			PromptTokens:       evt.PromptTokens,
			CompletionTokens:   evt.CompletionTokens,
			TotalTokens:        evt.TotalTokens,
			EstimatedCostUSD:   cost,
			LatencyMs:          evt.LatencyMs,
			Success:            evt.Success,
			ErrorMessage:       evt.ErrorMessage,
			RequestStartedAt:   startedAt,
			RequestCompletedAt: completedAt,
		})

		totalPrompt += evt.PromptTokens
		totalCompletion += evt.CompletionTokens
		totalTokens += evt.TotalTokens
		totalLatency += evt.LatencyMs
		totalCalls++
		if !evt.Success {
			failedCalls++
		}
		if cost != nil {
			totalCost += *cost
			hasCost = true
		}
	}

	if len(dbEvents) > 0 {
		global.DB.CreateInBatches(dbEvents, 50)
	}

	var costPtr *float64
	if hasCost {
		costPtr = &totalCost
	}
	runMetrics := models.AnalysisRunMetrics{
		TaskID:                taskID,
		UserID:                userID,
		TotalPromptTokens:     totalPrompt,
		TotalCompletionTokens: totalCompletion,
		TotalTokens:           totalTokens,
		TotalEstimatedCost:    costPtr,
		TotalLatencyMs:        totalLatency,
		TotalLLMCalls:         totalCalls,
		FailedCalls:           failedCalls,
		Provider:              provider,
		Model:                 model,
	}
	global.DB.Create(&runMetrics)

	// Clean up Redis
	global.RedisClient.Del(ctx, key)
}
```

- [ ] **Step 3: Hook ingestion into task completion flow**

In `backend/controllers/trading_controller.go`, in `GetAnalysisResult()`, after `reconcileTaskRuntime()` detects status == "completed", call:

```go
if task.Status == "completed" {
	// Check if run metrics already exist
	var existing models.AnalysisRunMetrics
	if global.DB.Where("task_id = ?", task.TaskID).First(&existing).Error != nil {
		go ingestUsageEventsFromRedis(task.TaskID, task.UserID, task.LLMProvider, task.LLMModel)
	}
}
```

- [ ] **Step 4: Create user usage summary endpoint**

```go
// GET /api/usage/summary — returns current user's aggregate usage
func GetUsageSummary(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var totalTokens int64
	var totalCost float64
	var taskCount int64

	global.DB.Model(&models.AnalysisRunMetrics{}).
		Where("user_id = ?", uid).
		Select("COALESCE(SUM(total_tokens), 0)").Scan(&totalTokens)

	global.DB.Model(&models.AnalysisRunMetrics{}).
		Where("user_id = ?", uid).
		Select("COALESCE(SUM(total_estimated_cost), 0)").Scan(&totalCost)

	global.DB.Model(&models.AnalysisRunMetrics{}).
		Where("user_id = ?", uid).Count(&taskCount)

	// Per-provider breakdown
	type ProviderBreakdown struct {
		Provider string  `json:"provider"`
		Tokens   int64   `json:"tokens"`
		Cost     float64 `json:"cost"`
		Tasks    int64   `json:"tasks"`
	}
	var providers []ProviderBreakdown
	global.DB.Model(&models.AnalysisRunMetrics{}).
		Where("user_id = ?", uid).
		Select("provider, SUM(total_tokens) as tokens, COALESCE(SUM(total_estimated_cost), 0) as cost, COUNT(*) as tasks").
		Group("provider").Scan(&providers)

	c.JSON(http.StatusOK, gin.H{
		"total_tokens":  totalTokens,
		"total_cost":    totalCost,
		"total_tasks":   taskCount,
		"by_provider":   providers,
	})
}
```

- [ ] **Step 5: Create task detail endpoint**

```go
// GET /api/usage/tasks/:task_id — returns per-node usage for a specific task
func GetTaskUsageDetail(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	taskID := c.Param("task_id")

	var events []models.LLMUsageEvent
	if err := global.DB.Where("task_id = ? AND user_id = ?", taskID, uid).
		Order("request_started_at ASC").
		Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var runMetrics models.AnalysisRunMetrics
	global.DB.Where("task_id = ?", taskID).First(&runMetrics)

	c.JSON(http.StatusOK, gin.H{
		"task_id":     taskID,
		"events":      events,
		"run_metrics": runMetrics,
	})
}
```

- [ ] **Step 6: Create admin usage summary endpoint**

```go
// GET /api/admin/usage/summary — global usage KPIs (admin only)
func GetAdminUsageSummary(c *gin.Context) {
	var totalTokens int64
	var totalCost float64
	var taskCount int64
	var userCount int64

	global.DB.Model(&models.AnalysisRunMetrics{}).
		Select("COALESCE(SUM(total_tokens), 0)").Scan(&totalTokens)
	global.DB.Model(&models.AnalysisRunMetrics{}).
		Select("COALESCE(SUM(total_estimated_cost), 0)").Scan(&totalCost)
	global.DB.Model(&models.AnalysisRunMetrics{}).Count(&taskCount)
	global.DB.Model(&models.User{}).Count(&userCount)

	c.JSON(http.StatusOK, gin.H{
		"total_tokens": totalTokens,
		"total_cost":   totalCost,
		"total_tasks":  taskCount,
		"total_users":  userCount,
	})
}
```

- [ ] **Step 7: Create admin user list endpoint**

```go
// GET /api/admin/usage/users — per-user usage breakdown (admin only)
func GetAdminUserUsage(c *gin.Context) {
	type UserUsage struct {
		UserID   uint    `json:"user_id"`
		Username string  `json:"username"`
		Role     string  `json:"role"`
		Tokens   int64   `json:"tokens"`
		Cost     float64 `json:"cost"`
		Tasks    int64   `json:"tasks"`
	}

	var results []UserUsage
	global.DB.Raw(`
		SELECT u.id as user_id, u.username, u.role,
			COALESCE(SUM(m.total_tokens), 0) as tokens,
			COALESCE(SUM(m.total_estimated_cost), 0) as cost,
			COUNT(m.id) as tasks
		FROM users u
		LEFT JOIN analysis_run_metrics m ON u.id = m.user_id
		GROUP BY u.id, u.username, u.role
		ORDER BY tokens DESC
	`).Scan(&results)

	c.JSON(http.StatusOK, gin.H{"users": results})
}
```

- [ ] **Step 8: Register routes**

```go
// In backend/router/router.go
usage := api.Group("/usage")
{
	usage.GET("/summary", controllers.GetUsageSummary)
	usage.GET("/tasks/:task_id", controllers.GetTaskUsageDetail)
}

admin := api.Group("/admin")
admin.Use(middlewares.RequireAdmin())
{
	admin.GET("/usage/summary", controllers.GetAdminUsageSummary)
	admin.GET("/usage/users", controllers.GetAdminUserUsage)
}
```

- [ ] **Step 9: Verify compilation**

Run: `cd backend && go build ./...`
Expected: Compiles without errors.

- [ ] **Step 10: Commit**

```bash
git add backend/controllers/usage_controller.go backend/router/router.go backend/controllers/trading_controller.go
git commit -m "feat: add usage API endpoints and Redis event ingestion"
```

---

## Task 5: Frontend Usage Card + Admin Page

**Files:**
- Create: `frontend/src/services/usageService.ts`
- Create: `frontend/src/components/UsagePage.tsx`
- Create: `frontend/src/components/AdminDashboard.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create usage service**

```typescript
// frontend/src/services/usageService.ts
const rawApiUrl = import.meta.env.VITE_API_URL
const API_BASE_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : ''
const TOKEN_STORAGE_KEY = 'fingoat_token'

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  const bearer = token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : ''
  return { 'Content-Type': 'application/json', Authorization: bearer }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface UsageSummary {
  total_tokens: number
  total_cost: number
  total_tasks: number
  by_provider: { provider: string; tokens: number; cost: number; tasks: number }[]
}

export interface AdminUsageSummary {
  total_tokens: number
  total_cost: number
  total_tasks: number
  total_users: number
}

export interface AdminUserUsage {
  user_id: number
  username: string
  role: string
  tokens: number
  cost: number
  tasks: number
}

export async function getUserUsageSummary(): Promise<UsageSummary> {
  const res = await fetch(`${API_BASE_URL}/api/usage/summary`, { headers: getAuthHeaders() })
  return handleResponse<UsageSummary>(res)
}

export async function getAdminUsageSummary(): Promise<AdminUsageSummary> {
  const res = await fetch(`${API_BASE_URL}/api/admin/usage/summary`, { headers: getAuthHeaders() })
  return handleResponse<AdminUsageSummary>(res)
}

export async function getAdminUserUsage(): Promise<AdminUserUsage[]> {
  const res = await fetch(`${API_BASE_URL}/api/admin/usage/users`, { headers: getAuthHeaders() })
  const data = await handleResponse<{ users: AdminUserUsage[] }>(res)
  return data.users
}
```

- [ ] **Step 2: Create UsagePage component**

A simple card showing total tokens, cost, tasks, and per-provider breakdown table.

- [ ] **Step 3: Create AdminDashboard component**

A table showing:
- Global KPIs at top (total tokens, cost, tasks, users)
- User table with columns: username, role, tokens, cost, tasks

- [ ] **Step 4: Add Usage and Admin tabs to App.tsx**

Add `'usage' | 'admin'` to the `ActiveTab` type. Show Usage tab for all users. Show Admin tab only when `profile.role === 'admin'`.

- [ ] **Step 5: Manual test**

Start frontend dev server, verify:
- Usage tab appears for all users
- Admin tab appears only for admin user
- Both pages load without errors (even with empty data)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/usageService.ts frontend/src/components/UsagePage.tsx frontend/src/components/AdminDashboard.tsx frontend/src/App.tsx
git commit -m "feat: add Usage page and Admin dashboard frontend"
```

---

## Task 6: Integration Testing + Documentation

- [ ] **Step 1: Start services and run a test analysis**

```bash
docker compose up --build -d
```

- [ ] **Step 2: Promote admin user**

```bash
docker compose exec postgres psql -U fingoat -d fingoat -c "UPDATE users SET role='admin' WHERE username='admin';"
```

- [ ] **Step 3: Run an analysis and verify usage flow**

1. Login as admin
2. Run a short analysis (e.g., AAPL, recent date)
3. After completion, check `/api/usage/summary` returns non-zero tokens
4. Check `/api/admin/usage/users` shows the admin user with usage

- [ ] **Step 4: Update devlog**

Add entry to `docs/devlog/planning/task-backlog.md` marking observability v1 as completed.

- [ ] **Step 5: Final commit**

```bash
git add docs/
git commit -m "docs: update devlog with observability platform v1 completion"
```
