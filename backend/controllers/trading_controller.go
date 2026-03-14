package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/gin-gonic/gin"
)

const defaultTradingServiceURL = "http://localhost:8001"
const defaultOpenClawGatewayURL = "http://localhost:8011"

var tradingServiceURL = func() string {
	if v := os.Getenv("TRADING_SERVICE_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return defaultTradingServiceURL
}()

var openClawGatewayURL = func() string {
	if v := os.Getenv("OPENCLAW_GATEWAY_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return defaultOpenClawGatewayURL
}()

var tradingHTTPClient = &http.Client{Timeout: 15 * time.Second}

func extractTradingServiceError(body []byte, statusCode int) string {
	var errResp map[string]interface{}
	if err := json.Unmarshal(body, &errResp); err == nil {
		if msg, ok := errResp["error"].(string); ok && msg != "" {
			return msg
		}
		if detail, ok := errResp["detail"]; ok {
			switch d := detail.(type) {
			case string:
				if d != "" {
					return d
				}
			case []interface{}:
				if len(d) > 0 {
					if first, ok := d[0].(map[string]interface{}); ok {
						if msg, ok := first["msg"].(string); ok && msg != "" {
							return msg
						}
					}
				}
			}
		}
		if msg, ok := errResp["message"].(string); ok && msg != "" {
			return msg
		}
	}

	trimmed := strings.TrimSpace(string(body))
	if trimmed != "" {
		return trimmed
	}
	return fmt.Sprintf("trading service returned status %d", statusCode)
}

// RequestAnalysis submits a new trading analysis request
func RequestAnalysis(c *gin.Context) {
	var req AnalysisRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from JWT context
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	taskID, err := generateTaskID()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate task id: " + err.Error()})
		return
	}
	req.TaskID = taskID
	req.UserID = userID.(uint)
	req.ExecutionMode = normalizeExecutionMode(req.ExecutionMode)

	var llmProvider, llmModel, llmBaseURL string
	if req.LLMConfig != nil {
		llmProvider = req.LLMConfig.Provider
		llmModel = req.LLMConfig.QuickThinkLLM
		if llmModel == "" {
			llmModel = req.LLMConfig.DeepThinkLLM
		}
		llmBaseURL = req.LLMConfig.BaseURL
	}

	configJSON, err := marshalTaskConfig(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to marshal task config: " + err.Error()})
		return
	}

	// Create database record
	task := models.TradingAnalysisTask{
		UserID:       userID.(uint),
		TaskID:       taskID,
		Ticker:       req.Ticker,
		AnalysisDate: req.Date,
		Status:       "pending",
		ExecutionMode: req.ExecutionMode,
		Config:       configJSON,
		LLMProvider:  llmProvider,
		LLMModel:     llmModel,
		LLMBaseURL:   llmBaseURL,
	}

	ctx := c.Request.Context()

	if err := global.DB.WithContext(ctx).Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save task: " + err.Error()})
		return
	}

	runtime := &RuntimeTaskState{
		TaskID:    taskID,
		Status:    "pending",
		Ticker:    req.Ticker,
		Date:      req.Date,
		ExecutionMode: req.ExecutionMode,
		CreatedAt: task.CreatedAt.UTC().Format(time.RFC3339),
	}

	if err := saveRuntimeState(ctx, runtime); err != nil {
		task.Status = "failed"
		task.Error = "failed to initialize runtime state: " + err.Error()
		_ = global.DB.WithContext(ctx).Save(&task).Error
		c.JSON(http.StatusInternalServerError, gin.H{"error": task.Error})
		return
	}

	if err := enqueueAnalysisRequest(ctx, &req); err != nil {
		task.Status = "failed"
		task.Error = "failed to enqueue analysis task: " + err.Error()
		_ = global.DB.WithContext(ctx).Save(&task).Error
		c.JSON(http.StatusInternalServerError, gin.H{"error": task.Error})
		return
	}

	c.JSON(http.StatusAccepted, buildAnalysisTaskResponse(&task, runtime))
}

// GetAnalysisResult retrieves analysis result by task ID
func GetAnalysisResult(c *gin.Context) {
	taskID := c.Param("task_id")

	// Get user ID from JWT
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	// Find task in database
	var task models.TradingAnalysisTask
	if err := global.DB.Where("task_id = ? AND user_id = ?", taskID, userID).
		Preload("Decision").
		First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	var runtime *RuntimeTaskState
	if task.Status == "pending" || task.Status == "processing" {
		var err error
		runtime, err = reconcileTaskRuntime(c.Request.Context(), &task)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sync task state: " + err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, buildAnalysisTaskResponse(&task, runtime))
}

// ListUserAnalyses lists all analysis tasks for the current user
func ListUserAnalyses(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	var tasks []models.TradingAnalysisTask
	result := global.DB.WithContext(c.Request.Context()).Where("user_id = ?", userID).
		Preload("Decision").
		Order("created_at DESC").
		Limit(20).
		Find(&tasks)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	responses := make([]AnalysisTaskResponse, 0, len(tasks))
	for i := range tasks {
		var runtime *RuntimeTaskState
		if tasks[i].Status == "pending" || tasks[i].Status == "processing" {
			runtime, _ = reconcileTaskRuntime(c.Request.Context(), &tasks[i])
		}
		responses = append(responses, buildAnalysisTaskResponse(&tasks[i], runtime))
	}

	c.JSON(http.StatusOK, gin.H{
		"tasks": responses,
		"total": len(tasks),
	})
}

// GetAnalysisStats returns statistics about user's trading analyses
func GetAnalysisStats(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	var total int64
	var completed int64
	var failed int64

	var activeTasks []models.TradingAnalysisTask
	_ = global.DB.WithContext(c.Request.Context()).
		Where("user_id = ? AND status IN ?", userID, []string{"pending", "processing"}).
		Find(&activeTasks).Error
	for i := range activeTasks {
		_, _ = reconcileTaskRuntime(c.Request.Context(), &activeTasks[i])
	}

	global.DB.WithContext(c.Request.Context()).Model(&models.TradingAnalysisTask{}).Where("user_id = ?", userID).Count(&total)
	global.DB.WithContext(c.Request.Context()).Model(&models.TradingAnalysisTask{}).Where("user_id = ? AND status = ?", userID, "completed").Count(&completed)
	global.DB.WithContext(c.Request.Context()).Model(&models.TradingAnalysisTask{}).Where("user_id = ? AND status = ?", userID, "failed").Count(&failed)

	// Count decisions by action
	var buyCount, sellCount, holdCount int64
	global.DB.Table("trading_decisions").
		Joins("JOIN trading_analysis_tasks ON trading_decisions.task_id = trading_analysis_tasks.task_id").
		Where("trading_analysis_tasks.user_id = ? AND trading_decisions.action = ?", userID, "BUY").
		Count(&buyCount)

	global.DB.Table("trading_decisions").
		Joins("JOIN trading_analysis_tasks ON trading_decisions.task_id = trading_analysis_tasks.task_id").
		Where("trading_analysis_tasks.user_id = ? AND trading_decisions.action = ?", userID, "SELL").
		Count(&sellCount)

	global.DB.Table("trading_decisions").
		Joins("JOIN trading_analysis_tasks ON trading_decisions.task_id = trading_analysis_tasks.task_id").
		Where("trading_analysis_tasks.user_id = ? AND trading_decisions.action = ?", userID, "HOLD").
		Count(&holdCount)

	c.JSON(http.StatusOK, gin.H{
		"total_analyses": total,
		"completed":      completed,
		"failed":         failed,
		"pending":        total - completed - failed,
		"decisions": gin.H{
			"buy":  buyCount,
			"sell": sellCount,
			"hold": holdCount,
		},
	})
}

// CheckServiceHealth checks if the Python trading service is available
func CheckServiceHealth(c *gin.Context) {
	resp, err := tradingHTTPClient.Get(tradingServiceURL + "/health")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unavailable",
			"message": fmt.Sprintf("trading service is down: %v", err),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "unavailable",
			"message": "trading service returned non-200 status",
		})
		return
	}

	body, _ := io.ReadAll(resp.Body)
	var healthResp map[string]interface{}
	json.Unmarshal(body, &healthResp)

	openclawHealth := gin.H{
		"status": "unavailable",
	}
	if gatewayResp, gatewayErr := tradingHTTPClient.Get(openClawGatewayURL + "/health"); gatewayErr == nil {
		defer gatewayResp.Body.Close()
		gatewayBody, _ := io.ReadAll(gatewayResp.Body)
		_ = json.Unmarshal(gatewayBody, &openclawHealth)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":          "healthy",
		"trading_service": healthResp,
		"openclaw_gateway": openclawHealth,
	})
}

// CancelAnalysis requests cooperative cancellation of a pending/processing task.
func CancelAnalysis(c *gin.Context) {
	taskID := c.Param("task_id")

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	var task models.TradingAnalysisTask
	if err := global.DB.Where("task_id = ? AND user_id = ?", taskID, userID).
		Preload("Decision").
		First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if task.Status == "completed" || task.Status == "failed" || task.Status == "cancelled" {
		c.JSON(http.StatusConflict, gin.H{"error": "task is not cancellable"})
		return
	}

	ctx := c.Request.Context()
	runtime, err := loadRuntimeState(ctx, task.TaskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load runtime state: " + err.Error()})
		return
	}
	if runtime == nil {
		runtime = &RuntimeTaskState{
			TaskID:    task.TaskID,
			Status:    "cancelled",
			Ticker:    task.Ticker,
			Date:      task.AnalysisDate,
			ExecutionMode: normalizeExecutionMode(task.ExecutionMode),
			CreatedAt: task.CreatedAt.UTC().Format(time.RFC3339),
		}
	}

	now := time.Now().UTC()
	runtime.Status = "cancelled"
	runtime.CancelRequested = true
	runtime.Error = "analysis cancelled by user"
	runtime.CompletedAt = now.Format(time.RFC3339)

	if err := saveRuntimeState(ctx, runtime); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save cancellation state: " + err.Error()})
		return
	}
	if err := removeAnalysisPayloadsFromQueues(ctx, task.TaskID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove queued cancellation payloads: " + err.Error()})
		return
	}

	task.Status = "cancelled"
	task.Error = runtime.Error
	task.CompletedAt = &now
	if err := global.DB.WithContext(ctx).Save(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist cancellation: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, buildAnalysisTaskResponse(&task, runtime))
}

// ResumeAnalysis requeues a failed/cancelled task using its stored configuration.
func ResumeAnalysis(c *gin.Context) {
	taskID := c.Param("task_id")

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	var task models.TradingAnalysisTask
	if err := global.DB.Where("task_id = ? AND user_id = ?", taskID, userID).
		Preload("Decision").
		First(&task).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	if task.Status != "failed" && task.Status != "cancelled" {
		c.JSON(http.StatusConflict, gin.H{"error": "task is not resumable"})
		return
	}

	req, err := unmarshalTaskConfig(task.Config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse stored task config: " + err.Error()})
		return
	}
	req.TaskID = task.TaskID
	req.UserID = task.UserID
	req.Ticker = task.Ticker
	req.Date = task.AnalysisDate
	req.ExecutionMode = normalizeExecutionMode(req.ExecutionMode)

	configJSON, err := marshalTaskConfig(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to marshal task config: " + err.Error()})
		return
	}

	task.Config = configJSON
	task.Status = "pending"
	task.Error = ""
	task.CompletedAt = nil
	task.ProcessingTimeSeconds = 0
	task.Decision = nil

	ctx := c.Request.Context()
	runtime := &RuntimeTaskState{
		TaskID:    task.TaskID,
		Status:    "pending",
		Ticker:    task.Ticker,
		Date:      task.AnalysisDate,
		ExecutionMode: req.ExecutionMode,
		CreatedAt: task.CreatedAt.UTC().Format(time.RFC3339),
	}

	if err := saveRuntimeState(ctx, runtime); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset runtime state: " + err.Error()})
		return
	}
	if err := removeAnalysisPayloadsFromQueues(ctx, task.TaskID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear stale queue entries before resume: " + err.Error()})
		return
	}
	if err := enqueueAnalysisRequest(ctx, req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enqueue resumed task: " + err.Error()})
		return
	}
	if err := global.DB.WithContext(ctx).Save(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist resumed task: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, buildAnalysisTaskResponse(&task, runtime))
}
