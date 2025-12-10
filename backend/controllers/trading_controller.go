package controllers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/gin-gonic/gin"
)

const TRADING_SERVICE_URL = "http://localhost:8001"

var tradingHTTPClient = &http.Client{Timeout: 15 * time.Second}

// Request/Response structures for Python service
type AnalysisRequest struct {
	Ticker    string                 `json:"ticker" binding:"required"`
	Date      string                 `json:"date" binding:"required"`
	LLMConfig map[string]interface{} `json:"llm_config,omitempty"`
}

type PythonServiceResponse struct {
	TaskID                string                 `json:"task_id"`
	Status                string                 `json:"status"`
	Ticker                string                 `json:"ticker"`
	Date                  string                 `json:"date"`
	Decision              map[string]interface{} `json:"decision"`
	AnalysisReport        map[string]interface{} `json:"analysis_report"`
	Error                 string                 `json:"error"`
	CreatedAt             string                 `json:"created_at"`
	CompletedAt           string                 `json:"completed_at"`
	ProcessingTimeSeconds float64                `json:"processing_time_seconds"`
}

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

	getStr := func(key string) string {
		if req.LLMConfig == nil {
			return ""
		}
		if v, ok := req.LLMConfig[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
		return ""
	}

	llmProvider := getStr("provider")
	llmModel := getStr("quick_think_llm")
	if llmModel == "" {
		llmModel = getStr("deep_think_llm")
	}
	llmBaseURL := getStr("base_url")

	// Get user ID from JWT context
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	// Call Python trading service
	jsonData, _ := json.Marshal(req)
	resp, err := tradingHTTPClient.Post(
		TRADING_SERVICE_URL+"/api/v1/analyze",
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to call trading service: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusAccepted {
		errMsg := extractTradingServiceError(body, resp.StatusCode)
		c.JSON(http.StatusBadGateway, gin.H{"error": errMsg})
		return
	}

	var pythonResp PythonServiceResponse
	if err := json.Unmarshal(body, &pythonResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse response: " + err.Error()})
		return
	}
	if pythonResp.TaskID == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "trading service did not return a task_id"})
		return
	}
	if pythonResp.Status == "" {
		pythonResp.Status = "pending"
	}

	// Create database record
	task := models.TradingAnalysisTask{
		UserID:       userID.(uint),
		TaskID:       pythonResp.TaskID,
		Ticker:       req.Ticker,
		AnalysisDate: req.Date,
		Status:       pythonResp.Status,
		LLMProvider:  llmProvider,
		LLMModel:     llmModel,
		LLMBaseURL:   llmBaseURL,
	}

	if err := global.DB.Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save task: " + err.Error()})
		return
	}

	c.JSON(http.StatusAccepted, task)
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

	// If task is still processing, fetch latest status from Python service
	if task.Status == "pending" || task.Status == "processing" {
		resp, err := tradingHTTPClient.Get(TRADING_SERVICE_URL + "/api/v1/analysis/" + taskID)
		if err != nil {
			task.Status = "failed"
			task.Error = "failed to reach trading service: " + err.Error()
			global.DB.Save(&task)
			c.JSON(http.StatusBadGateway, gin.H{"error": task.Error})
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)

		if resp.StatusCode != http.StatusOK {
			task.Status = "failed"
			task.Error = extractTradingServiceError(body, resp.StatusCode)
			global.DB.Save(&task)
			c.JSON(http.StatusOK, task)
			return
		}

		var pythonResp PythonServiceResponse
		if err := json.Unmarshal(body, &pythonResp); err != nil {
			task.Status = "failed"
			task.Error = "failed to parse trading service response: " + err.Error()
			global.DB.Save(&task)
			c.JSON(http.StatusOK, task)
			return
		}

		// Update task status
		task.Status = pythonResp.Status

		// If completed, save decision
		if pythonResp.Status == "completed" && pythonResp.Decision != nil {
			// Update task
			if pythonResp.CompletedAt != "" {
				completedAt, _ := time.Parse(time.RFC3339, pythonResp.CompletedAt)
				task.CompletedAt = &completedAt
			}
			task.ProcessingTimeSeconds = pythonResp.ProcessingTimeSeconds

			// Create or update decision
			decision := models.TradingDecision{
				TaskID:     taskID,
				Action:     pythonResp.Decision["action"].(string),
				Confidence: pythonResp.Decision["confidence"].(float64),
			}

			// Save analysis report as JSON
			if pythonResp.AnalysisReport != nil {
				reportJSON, _ := json.Marshal(pythonResp.AnalysisReport)
				reportStr := string(reportJSON)
				decision.AnalysisReport = &reportStr
			}

			// Save raw decision
			if rawDecision, ok := pythonResp.Decision["raw_decision"].(map[string]interface{}); ok {
				rawJSON, _ := json.Marshal(rawDecision)
				rawStr := string(rawJSON)
				decision.RawDecision = &rawStr
			}

			global.DB.Create(&decision)
			task.Decision = &decision
		}

		if pythonResp.Status == "failed" {
			task.Error = pythonResp.Error
		}

		global.DB.Save(&task)
	}

	c.JSON(http.StatusOK, task)
}

// ListUserAnalyses lists all analysis tasks for the current user
func ListUserAnalyses(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	var tasks []models.TradingAnalysisTask
	result := global.DB.Where("user_id = ?", userID).
		Preload("Decision").
		Order("created_at DESC").
		Limit(20).
		Find(&tasks)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tasks": tasks,
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

	global.DB.Model(&models.TradingAnalysisTask{}).Where("user_id = ?", userID).Count(&total)
	global.DB.Model(&models.TradingAnalysisTask{}).Where("user_id = ? AND status = ?", userID, "completed").Count(&completed)
	global.DB.Model(&models.TradingAnalysisTask{}).Where("user_id = ? AND status = ?", userID, "failed").Count(&failed)

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
	resp, err := http.Get(TRADING_SERVICE_URL + "/health")
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

	c.JSON(http.StatusOK, gin.H{
		"status":          "healthy",
		"trading_service": healthResp,
	})
}
