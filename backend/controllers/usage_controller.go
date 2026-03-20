package controllers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ── Cost estimation ──────────────────────────────────────────────────────────

type modelPricing struct {
	InputPer1M  float64
	OutputPer1M float64
}

// pricingCatalog holds per-1M-token costs in USD for known models.
// Unknown models will have nil cost (displayed as "unpriced").
var pricingCatalog = map[string]modelPricing{
	// OpenAI
	"gpt-4o":      {InputPer1M: 2.50, OutputPer1M: 10.00},
	"gpt-4o-mini": {InputPer1M: 0.15, OutputPer1M: 0.60},
	"gpt-4-turbo": {InputPer1M: 10.00, OutputPer1M: 30.00},
	// Anthropic
	"claude-sonnet-4-20250514": {InputPer1M: 3.00, OutputPer1M: 15.00},
	"claude-haiku-4-20250414":  {InputPer1M: 0.80, OutputPer1M: 4.00},
	// DeepSeek
	"deepseek-chat":     {InputPer1M: 0.14, OutputPer1M: 0.28},
	"deepseek-reasoner": {InputPer1M: 0.55, OutputPer1M: 2.19},
	// DashScope (Qwen)
	"qwen-plus":  {InputPer1M: 0.80, OutputPer1M: 2.00},
	"qwen-turbo": {InputPer1M: 0.30, OutputPer1M: 0.60},
	"qwen-max":   {InputPer1M: 2.40, OutputPer1M: 9.60},
}

func estimateCost(model string, promptTokens, completionTokens int) *float64 {
	pricing, ok := pricingCatalog[model]
	if !ok {
		return nil
	}
	cost := float64(promptTokens)/1_000_000*pricing.InputPer1M +
		float64(completionTokens)/1_000_000*pricing.OutputPer1M
	return &cost
}

// ── Redis → PostgreSQL ingestion ─────────────────────────────────────────────

type redisUsageEvent struct {
	TaskID             string `json:"task_id"`
	UserID             int    `json:"user_id"`
	Provider           string `json:"provider"`
	Model              string `json:"model"`
	NodeName           string `json:"node_name"`
	EventType          string `json:"event_type"`
	PromptTokens       int    `json:"prompt_tokens"`
	CompletionTokens   int    `json:"completion_tokens"`
	TotalTokens        int    `json:"total_tokens"`
	LatencyMs          int    `json:"latency_ms"`
	Success            bool   `json:"success"`
	ErrorMessage       string `json:"error_message"`
	RequestStartedAt   string `json:"request_started_at"`
	RequestCompletedAt string `json:"request_completed_at"`
}

var usageNodeStageMap = map[string]string{
	"Market Analyst":       "market",
	"Social Analyst":       "social",
	"News Analyst":         "news",
	"Fundamentals Analyst": "fundamentals",
	"Bull Researcher":      "research_debate",
	"Bear Researcher":      "research_debate",
	"Research Manager":     "portfolio_manager",
	"Trader":               "trader_plan",
	"Risky Analyst":        "risk_debate",
	"Neutral Analyst":      "risk_debate",
	"Safe Analyst":         "risk_debate",
	"Risk Judge":           "risk_management",
}

type usageStageBreakdown struct {
	StageID          string   `json:"stage_id"`
	PromptTokens     int      `json:"prompt_tokens"`
	CompletionTokens int      `json:"completion_tokens"`
	TotalTokens      int      `json:"total_tokens"`
	LLMCalls         int      `json:"llm_calls"`
	FailedCalls      int      `json:"failed_calls"`
	LatencyMs        int      `json:"latency_ms"`
	EstimatedCostUSD *float64 `json:"estimated_cost_usd,omitempty"`
}

func usageEventsKey(taskID string) string {
	return "usage:events:" + taskID
}

func ClearTaskUsage(ctx context.Context, taskID string) error {
	if err := global.DB.WithContext(ctx).Where("task_id = ?", taskID).Delete(&models.LLMUsageEvent{}).Error; err != nil {
		return err
	}
	if err := global.DB.WithContext(ctx).Where("task_id = ?", taskID).Delete(&models.AnalysisRunMetrics{}).Error; err != nil {
		return err
	}
	if err := global.RedisDB.Del(ctx, usageEventsKey(taskID)).Err(); err != nil {
		return err
	}
	return nil
}

func EnsureTaskUsageIngested(ctx context.Context, task *models.TradingAnalysisTask) error {
	if task == nil {
		return nil
	}
	switch task.Status {
	case "completed", "failed", "cancelled":
	default:
		return nil
	}

	var existingMetrics models.AnalysisRunMetrics
	err := global.DB.WithContext(ctx).Where("task_id = ?", task.TaskID).First(&existingMetrics).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	eventCount, err := global.RedisDB.LLen(ctx, usageEventsKey(task.TaskID)).Result()
	if err != nil || eventCount == 0 {
		return err
	}

	IngestUsageEventsFromRedis(task.TaskID, task.UserID, task.LLMProvider, task.LLMModel, task.ProcessingTimeSeconds)
	return nil
}

// IngestUsageEventsFromRedis reads usage events from Redis and persists them to PostgreSQL.
// Called asynchronously after a task completes.
func IngestUsageEventsFromRedis(taskID string, userID uint, provider, model string, processingTime float64) {
	ctx := context.Background()
	key := usageEventsKey(taskID)

	rawEvents, err := global.RedisDB.LRange(ctx, key, 0, -1).Result()
	if err != nil || len(rawEvents) == 0 {
		return
	}

	var dbEvents []models.LLMUsageEvent
	var totalPrompt, totalCompletion, totalTokens, totalLatency, totalCalls, failedCalls int
	var totalCost float64
	hasCost := false

	for _, raw := range rawEvents {
		var evt redisUsageEvent
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
		if err := global.DB.CreateInBatches(dbEvents, 50).Error; err != nil {
			log.Printf("Failed to persist usage events for task %s: %v", taskID, err)
			return
		}
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
		ProcessingTimeSec:     processingTime,
	}
	if err := global.DB.Create(&runMetrics).Error; err != nil {
		log.Printf("Failed to persist run metrics for task %s: %v", taskID, err)
		return
	}

	// Clean up Redis
	global.RedisDB.Del(ctx, key)
	log.Printf("Ingested %d usage events for task %s", len(dbEvents), taskID)
}

// ── User usage endpoints ─────────────────────────────────────────────────────

// GetUsageSummary returns the current user's aggregate usage.
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

	type providerBreakdown struct {
		Provider string  `json:"provider"`
		Tokens   int64   `json:"tokens"`
		Cost     float64 `json:"cost"`
		Tasks    int64   `json:"tasks"`
	}
	var providers []providerBreakdown
	global.DB.Model(&models.AnalysisRunMetrics{}).
		Where("user_id = ?", uid).
		Select("provider, SUM(total_tokens) as tokens, COALESCE(SUM(total_estimated_cost), 0) as cost, COUNT(*) as tasks").
		Group("provider").Scan(&providers)

	c.JSON(http.StatusOK, gin.H{
		"total_tokens": totalTokens,
		"total_cost":   totalCost,
		"total_tasks":  taskCount,
		"by_provider":  providers,
	})
}

// GetTaskUsageDetail returns per-node usage events for a specific task.
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
	global.DB.Where("task_id = ? AND user_id = ?", taskID, uid).First(&runMetrics)

	byStageMap := map[string]*usageStageBreakdown{}
	for _, event := range events {
		stageID, ok := usageNodeStageMap[event.NodeName]
		if !ok {
			continue
		}
		row := byStageMap[stageID]
		if row == nil {
			row = &usageStageBreakdown{StageID: stageID}
			byStageMap[stageID] = row
		}
		row.PromptTokens += event.PromptTokens
		row.CompletionTokens += event.CompletionTokens
		row.TotalTokens += event.TotalTokens
		row.LLMCalls++
		row.LatencyMs += event.LatencyMs
		if !event.Success {
			row.FailedCalls++
		}
		if event.EstimatedCostUSD != nil {
			if row.EstimatedCostUSD == nil {
				value := 0.0
				row.EstimatedCostUSD = &value
			}
			*row.EstimatedCostUSD += *event.EstimatedCostUSD
		}
	}

	byStage := make([]usageStageBreakdown, 0, len(byStageMap))
	for _, stageID := range []string{
		"market",
		"social",
		"news",
		"fundamentals",
		"research_debate",
		"portfolio_manager",
		"trader_plan",
		"risk_debate",
		"risk_management",
	} {
		if row, ok := byStageMap[stageID]; ok {
			byStage = append(byStage, *row)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"task_id":     taskID,
		"events":      events,
		"run_metrics": runMetrics,
		"by_stage":    byStage,
	})
}

// ── Admin usage endpoints ────────────────────────────────────────────────────

// GetAdminUsageSummary returns global usage KPIs (admin only).
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

// GetAdminUserUsage returns per-user usage breakdown (admin only).
func GetAdminUserUsage(c *gin.Context) {
	type userUsage struct {
		UserID   uint    `json:"user_id"`
		Username string  `json:"username"`
		Role     string  `json:"role"`
		Tokens   int64   `json:"tokens"`
		Cost     float64 `json:"cost"`
		Tasks    int64   `json:"tasks"`
	}

	var results []userUsage
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
