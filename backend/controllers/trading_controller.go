package controllers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/template"
	"time"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const defaultTradingServiceURL = "http://localhost:8001"
const defaultMarketDataServiceURL = "http://localhost:8002"
const defaultOpenClawGatewayURL = "http://localhost:8011"

var tradingServiceURL = func() string {
	if v := os.Getenv("TRADING_SERVICE_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return defaultTradingServiceURL
}()

var marketDataServiceURL = func() string {
	if v := os.Getenv("MARKET_DATA_SERVICE_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return defaultMarketDataServiceURL
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

func hydrateAnalysisRequestSecrets(userID uint, req *AnalysisRequest) error {
	if req == nil {
		return nil
	}

	req.Market = normalizeMarket(req.Market)

	if req.LLMConfig != nil {
		req.LLMConfig.Provider = normalizeLLMProviderName(req.LLMConfig.Provider)
		if req.LLMConfig.Provider == "ollama" {
			req.LLMConfig.BaseURL = normalizeOllamaBaseURL(req.LLMConfig.BaseURL)
			req.LLMConfig.APIKey = ""
		} else if req.LLMConfig.Provider != "" {
			key, keyErr := lookupDecryptedKey(userID, req.LLMConfig.Provider)
			if keyErr != nil {
				return fmt.Errorf("failed to retrieve API key")
			}
			if key == "" {
				return fmt.Errorf("no API key configured for provider %q — add it in Profile & API Keys", req.LLMConfig.Provider)
			}
			req.LLMConfig.APIKey = key
		}
	}

	req.AlphaVantageAPIKey = ""
	if req.Market == "us" {
		avKey, avErr := lookupDecryptedKey(userID, "alpha_vantage")
		if avErr != nil {
			return fmt.Errorf("failed to retrieve alpha vantage key")
		}
		if avKey == "" {
			return fmt.Errorf("no Alpha Vantage API key configured — add it in Profile & API Keys")
		}
		req.AlphaVantageAPIKey = avKey
	}

	return nil
}

// RequestAnalysis submits a new trading analysis request
func RequestAnalysis(c *gin.Context) {
	var req AnalysisRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.Market = normalizeMarket(req.Market)
	req.Ticker = normalizeTickerForMarket(req.Ticker, req.Market)
	selectedAnalysts, err := normalizeSelectedAnalysts(req.SelectedAnalysts)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.SelectedAnalysts = selectedAnalysts

	// Validate fields (aligned with Python Pydantic constraints)
	if validationErr := validateAnalysisRequest(&req); validationErr != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": validationErr})
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
	if req.DataVendorConfig == nil {
		req.DataVendorConfig = defaultDataVendorConfigForMarket(req.Market)
	} else {
		defaults := defaultDataVendorConfigForMarket(req.Market)
		if req.DataVendorConfig.CoreStockAPIs == "" {
			req.DataVendorConfig.CoreStockAPIs = defaults.CoreStockAPIs
		}
		if req.DataVendorConfig.TechnicalIndicators == "" {
			req.DataVendorConfig.TechnicalIndicators = defaults.TechnicalIndicators
		}
		if req.DataVendorConfig.FundamentalData == "" {
			req.DataVendorConfig.FundamentalData = defaults.FundamentalData
		}
		if req.DataVendorConfig.NewsData == "" {
			req.DataVendorConfig.NewsData = defaults.NewsData
		}
	}

	if err := hydrateAnalysisRequestSecrets(userID.(uint), &req); err != nil {
		statusCode := http.StatusBadRequest
		if strings.HasPrefix(err.Error(), "failed to retrieve") {
			statusCode = http.StatusInternalServerError
		}
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

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

	// Go remains the durable task owner and queue entrypoint. See ADR-013, ADR-018, and ADR-021.
	task := models.TradingAnalysisTask{
		UserID:        userID.(uint),
		TaskID:        taskID,
		Ticker:        req.Ticker,
		Market:        req.Market,
		AnalysisDate:  req.Date,
		Status:        "pending",
		ExecutionMode: req.ExecutionMode,
		Config:        configJSON,
		LLMProvider:   llmProvider,
		LLMModel:      llmModel,
		LLMBaseURL:    llmBaseURL,
	}

	ctx := c.Request.Context()

	if err := global.DB.WithContext(ctx).Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save task: " + err.Error()})
		return
	}

	runtime := &RuntimeTaskState{
		TaskID:        taskID,
		Status:        "pending",
		Ticker:        req.Ticker,
		Market:        req.Market,
		Date:          req.Date,
		ExecutionMode: req.ExecutionMode,
		CreatedAt:     task.CreatedAt.UTC().Format(time.RFC3339),
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
	if err := EnsureTaskUsageIngested(c.Request.Context(), &task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sync task usage: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, buildAnalysisTaskResponse(&task, runtime))
}

type AnalysisExportStage struct {
	StageID          string  `json:"stage_id"`
	Label            string  `json:"label"`
	Status           string  `json:"status"`
	Backend          string  `json:"backend"`
	Provider         string  `json:"provider,omitempty"`
	Summary          string  `json:"summary,omitempty"`
	StartedAt        string  `json:"started_at,omitempty"`
	CompletedAt      string  `json:"completed_at,omitempty"`
	DurationSeconds  float64 `json:"duration_seconds,omitempty"`
	PromptTokens     int     `json:"prompt_tokens,omitempty"`
	CompletionTokens int     `json:"completion_tokens,omitempty"`
	TotalTokens      int     `json:"total_tokens,omitempty"`
	LLMCalls         int     `json:"llm_calls,omitempty"`
	FailedCalls      int     `json:"failed_calls,omitempty"`
	LatencyMs        int     `json:"latency_ms,omitempty"`
	Error            string  `json:"error,omitempty"`
}

type AnalysisExportPayload struct {
	TaskID                string                  `json:"task_id"`
	Ticker                string                  `json:"ticker"`
	Market                string                  `json:"market"`
	AnalysisDate          string                  `json:"analysis_date"`
	Status                string                  `json:"status"`
	ExecutionMode         string                  `json:"execution_mode"`
	SelectedAnalysts      []string                `json:"selected_analysts"`
	CreatedAt             string                  `json:"created_at"`
	CompletedAt           string                  `json:"completed_at,omitempty"`
	ProcessingTimeSeconds float64                 `json:"processing_time_seconds,omitempty"`
	LLMProvider           string                  `json:"llm_provider,omitempty"`
	LLMModel              string                  `json:"llm_model,omitempty"`
	LLMBaseURL            string                  `json:"llm_base_url,omitempty"`
	Decision              *TradingDecisionPayload `json:"decision,omitempty"`
	FinalDecision         string                  `json:"final_decision,omitempty"`
	Confidence            float64                 `json:"confidence,omitempty"`
	Stages                []AnalysisExportStage   `json:"stages"`
	AnalysisReport        map[string]interface{}  `json:"analysis_report,omitempty"`
}

var analysisMarkdownTemplate = template.Must(template.New("analysis_markdown").Funcs(template.FuncMap{
	"join": strings.Join,
	"json": func(value interface{}) string {
		body, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return "{}"
		}
		return string(body)
	},
	"mul100": func(value float64) float64 {
		return value * 100
	},
	"providerLine": func(payload AnalysisExportPayload) string {
		parts := make([]string, 0, 3)
		if payload.LLMProvider != "" {
			parts = append(parts, payload.LLMProvider)
		}
		if payload.LLMModel != "" {
			parts = append(parts, payload.LLMModel)
		}
		if payload.LLMBaseURL != "" {
			parts = append(parts, payload.LLMBaseURL)
		}
		if len(parts) == 0 {
			return "N/A"
		}
		return strings.Join(parts, " / ")
	},
}).Parse(`# Trading Analysis Report

- Task ID: {{.TaskID}}
- Ticker: {{.Ticker}}
- Market: {{.Market}}
- Analysis Date: {{.AnalysisDate}}
- Execution Mode: {{.ExecutionMode}}
- Selected Analysts: {{join .SelectedAnalysts ", "}}
- Provider: {{providerLine .}}
- Created At: {{.CreatedAt}}
{{- if .CompletedAt }}
- Completed At: {{.CompletedAt}}
{{- end }}
{{- if gt .ProcessingTimeSeconds 0.0 }}
- Processing Time: {{printf "%.2fs" .ProcessingTimeSeconds}}
{{- end }}

## Final Decision

{{- if .Decision }}
- Action: {{.Decision.Action}}
- Confidence: {{printf "%.2f%%" (mul100 .Decision.Confidence)}}
{{- if .Decision.PositionSize }}
- Position Size: {{.Decision.PositionSize}}
{{- end }}
{{- else }}
No final decision is available.
{{- end }}

## Stages Summary

{{- if .Stages }}
{{- range .Stages }}
### {{.Label}} ({{.StageID}})

- Status: {{.Status}}
{{- if .Provider }}
- Provider: {{.Provider}}
{{- end }}
{{- if .Backend }}
- Backend: {{.Backend}}
{{- end }}
{{- if .Summary }}
- Summary: {{.Summary}}
{{- end }}
{{- if .StartedAt }}
- Started At: {{.StartedAt}}
{{- end }}
{{- if .CompletedAt }}
- Completed At: {{.CompletedAt}}
{{- end }}
{{- if gt .DurationSeconds 0.0 }}
- Duration: {{printf "%.2fs" .DurationSeconds}}
{{- end }}
{{- if gt .TotalTokens 0 }}
- Tokens: {{.TotalTokens}} total (prompt {{.PromptTokens}}, completion {{.CompletionTokens}})
{{- end }}
{{- if gt .LLMCalls 0 }}
- LLM Calls: {{.LLMCalls}}
{{- end }}
{{- if gt .FailedCalls 0 }}
- Failed Calls: {{.FailedCalls}}
{{- end }}
{{- if gt .LatencyMs 0 }}
- Latency: {{.LatencyMs}} ms
{{- end }}
{{- if .Error }}
- Error: {{.Error}}
{{- end }}

{{- end }}
{{- else }}
No stage summaries are available.
{{- end }}

## Full Analysis Report

~~~json
{{json .AnalysisReport}}
~~~
`))

func loadOwnedAnalysisTask(c *gin.Context) (*models.TradingAnalysisTask, *RuntimeTaskState, error) {
	userID, exists := c.Get("user_id")
	if !exists {
		return nil, nil, fmt.Errorf("user not authenticated")
	}

	var task models.TradingAnalysisTask
	if err := global.DB.Where("task_id = ? AND user_id = ?", c.Param("task_id"), userID).
		Preload("Decision").
		First(&task).Error; err != nil {
		return nil, nil, err
	}

	var runtime *RuntimeTaskState
	if task.Status == "pending" || task.Status == "processing" {
		reconciled, err := reconcileTaskRuntime(c.Request.Context(), &task)
		if err != nil {
			return nil, nil, err
		}
		runtime = reconciled
	}
	if err := EnsureTaskUsageIngested(c.Request.Context(), &task); err != nil {
		return nil, nil, err
	}

	return &task, runtime, nil
}

func sanitizeExportStages(stages []AnalysisTaskStage) []AnalysisExportStage {
	if len(stages) == 0 {
		return []AnalysisExportStage{}
	}
	sanitized := make([]AnalysisExportStage, 0, len(stages))
	for _, stage := range stages {
		sanitized = append(sanitized, AnalysisExportStage{
			StageID:          stage.StageID,
			Label:            stage.Label,
			Status:           stage.Status,
			Backend:          stage.Backend,
			Provider:         stage.Provider,
			Summary:          stage.Summary,
			StartedAt:        stage.StartedAt,
			CompletedAt:      stage.CompletedAt,
			DurationSeconds:  stage.DurationSeconds,
			PromptTokens:     stage.PromptTokens,
			CompletionTokens: stage.CompletionTokens,
			TotalTokens:      stage.TotalTokens,
			LLMCalls:         stage.LLMCalls,
			FailedCalls:      stage.FailedCalls,
			LatencyMs:        stage.LatencyMs,
			Error:            stage.Error,
		})
	}
	return sanitized
}

func sanitizeAnalysisReportForExport(report map[string]interface{}) map[string]interface{} {
	if report == nil {
		return nil
	}
	body, err := json.Marshal(report)
	if err != nil {
		return report
	}
	var cloned map[string]interface{}
	if err := json.Unmarshal(body, &cloned); err != nil {
		return report
	}

	rawStages, ok := cloned["__stages"].([]interface{})
	if !ok {
		return cloned
	}
	for _, rawStage := range rawStages {
		stage, ok := rawStage.(map[string]interface{})
		if !ok {
			continue
		}
		delete(stage, "raw_output")
	}
	return cloned
}

func buildAnalysisExportPayload(response AnalysisTaskResponse, selectedAnalysts []string) AnalysisExportPayload {
	payload := AnalysisExportPayload{
		TaskID:                response.TaskID,
		Ticker:                response.Ticker,
		Market:                response.Market,
		AnalysisDate:          response.AnalysisDate,
		Status:                response.Status,
		ExecutionMode:         response.ExecutionMode,
		SelectedAnalysts:      selectedAnalysts,
		CreatedAt:             response.CreatedAt,
		CompletedAt:           response.CompletedAt,
		ProcessingTimeSeconds: response.ProcessingTimeSeconds,
		LLMProvider:           response.LLMProvider,
		LLMModel:              response.LLMModel,
		LLMBaseURL:            response.LLMBaseURL,
		Decision:              response.Decision,
		FinalDecision:         "",
		Stages:                sanitizeExportStages(response.Stages),
		AnalysisReport:        sanitizeAnalysisReportForExport(response.AnalysisReport),
	}
	if response.Decision != nil {
		payload.FinalDecision = response.Decision.Action
		payload.Confidence = response.Decision.Confidence
	}
	return payload
}

func renderMarkdownReport(payload AnalysisExportPayload) (string, error) {
	var buffer bytes.Buffer
	if err := analysisMarkdownTemplate.Execute(&buffer, payload); err != nil {
		return "", err
	}
	return buffer.String(), nil
}

func ExportAnalysisJSON(c *gin.Context) {
	task, runtime, err := loadOwnedAnalysisTask(c)
	if err != nil {
		if strings.Contains(err.Error(), "user not authenticated") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load analysis export: " + err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	response := buildAnalysisTaskResponse(task, runtime)
	if response.Status != "completed" {
		c.JSON(http.StatusConflict, gin.H{"error": "analysis export is only available after task completion"})
		return
	}

	req, err := unmarshalTaskConfig(task.Config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse stored task config: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, buildAnalysisExportPayload(response, req.SelectedAnalysts))
}

func ExportAnalysisMarkdown(c *gin.Context) {
	task, runtime, err := loadOwnedAnalysisTask(c)
	if err != nil {
		if strings.Contains(err.Error(), "user not authenticated") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			return
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load analysis export: " + err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}

	response := buildAnalysisTaskResponse(task, runtime)
	if response.Status != "completed" {
		c.JSON(http.StatusConflict, gin.H{"error": "analysis export is only available after task completion"})
		return
	}

	req, err := unmarshalTaskConfig(task.Config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse stored task config: " + err.Error()})
		return
	}

	body, err := renderMarkdownReport(buildAnalysisExportPayload(response, req.SelectedAnalysts))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to render markdown export: " + err.Error()})
		return
	}

	c.Header("Content-Type", "text/markdown; charset=utf-8")
	c.String(http.StatusOK, body)
}

// StreamAnalysisResult proxies the SSE stream from the Python trading service.
// Auth is already handled by the AuthMiddleware (supports ?token= fallback for EventSource).
func StreamAnalysisResult(c *gin.Context) {
	taskID := c.Param("task_id")

	_, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not authenticated"})
		return
	}

	// Build upstream SSE URL (no-timeout client — streams indefinitely)
	upstreamURL := fmt.Sprintf("%s/api/v1/analysis/%s/stream", tradingServiceURL, taskID)
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, upstreamURL, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build upstream request"})
		return
	}

	// Use a client with no timeout for streaming
	streamClient := &http.Client{}
	resp, err := streamClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream stream unavailable: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	// Set SSE response headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // disable nginx buffering

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}

	buf := make([]byte, 4096)
	for {
		select {
		case <-c.Request.Context().Done():
			return
		default:
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if _, writeErr := c.Writer.Write(buf[:n]); writeErr != nil {
					return
				}
				flusher.Flush()
			}
			if readErr != nil {
				if readErr != io.EOF {
					_ = readErr // stream closed normally
				}
				return
			}
		}
	}
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
		if err := EnsureTaskUsageIngested(c.Request.Context(), &tasks[i]); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sync task usage: " + err.Error()})
			return
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
		"status":           "healthy",
		"trading_service":  healthResp,
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
			TaskID:        task.TaskID,
			Status:        "cancelled",
			Ticker:        task.Ticker,
			Market:        normalizeMarket(task.Market),
			Date:          task.AnalysisDate,
			ExecutionMode: normalizeExecutionMode(task.ExecutionMode),
			CreatedAt:     task.CreatedAt.UTC().Format(time.RFC3339),
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
	req.Market = normalizeMarket(task.Market)
	req.Date = task.AnalysisDate
	req.ExecutionMode = normalizeExecutionMode(req.ExecutionMode)
	if err := hydrateAnalysisRequestSecrets(task.UserID, req); err != nil {
		statusCode := http.StatusBadRequest
		if strings.HasPrefix(err.Error(), "failed to retrieve") {
			statusCode = http.StatusInternalServerError
		}
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

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
	if req.LLMConfig != nil {
		task.LLMProvider = req.LLMConfig.Provider
		task.LLMBaseURL = req.LLMConfig.BaseURL
		task.LLMModel = req.LLMConfig.QuickThinkLLM
		if task.LLMModel == "" {
			task.LLMModel = req.LLMConfig.DeepThinkLLM
		}
	}

	ctx := c.Request.Context()
	runtime := &RuntimeTaskState{
		TaskID:        task.TaskID,
		Status:        "pending",
		Ticker:        task.Ticker,
		Market:        normalizeMarket(task.Market),
		Date:          task.AnalysisDate,
		ExecutionMode: req.ExecutionMode,
		CreatedAt:     task.CreatedAt.UTC().Format(time.RFC3339),
	}

	if err := saveRuntimeState(ctx, runtime); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset runtime state: " + err.Error()})
		return
	}
	if err := ClearTaskUsage(ctx, task.TaskID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear stale usage before resume: " + err.Error()})
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
