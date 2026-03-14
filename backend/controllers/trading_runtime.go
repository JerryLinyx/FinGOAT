package controllers

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

const (
	tradingRuntimeKeyPrefix   = "trading:analysis:runtime:"
	tradingQueueKey           = "trading:analysis:queue"
	tradingProcessingQueueKey = "trading:analysis:processing"
	tradingRuntimeTTL         = 24 * time.Hour
)

var (
	stalePendingTimeout    = loadDurationFromEnv("TRADING_PENDING_STALE_AFTER", 2*time.Minute)
	staleProcessingTimeout = loadDurationFromEnv("TRADING_PROCESSING_STALE_AFTER", 30*time.Minute)
)

type LLMConfig struct {
	DeepThinkLLM         string `json:"deep_think_llm,omitempty"`
	QuickThinkLLM        string `json:"quick_think_llm,omitempty"`
	MaxDebateRounds      int    `json:"max_debate_rounds,omitempty"`
	MaxRiskDiscussRounds int    `json:"max_risk_discuss_rounds,omitempty"`
	Provider             string `json:"provider,omitempty"`
	BaseURL              string `json:"base_url,omitempty"`
	APIKey               string `json:"api_key,omitempty"`
}

type DataVendorConfig struct {
	CoreStockAPIs       string `json:"core_stock_apis,omitempty"`
	TechnicalIndicators string `json:"technical_indicators,omitempty"`
	FundamentalData     string `json:"fundamental_data,omitempty"`
	NewsData            string `json:"news_data,omitempty"`
}

type AnalysisRequest struct {
	TaskID           string            `json:"task_id,omitempty"`
	UserID           uint              `json:"user_id,omitempty"`
	Ticker           string            `json:"ticker" binding:"required"`
	Date             string            `json:"date" binding:"required"`
	ExecutionMode    string            `json:"execution_mode,omitempty"`
	LLMConfig        *LLMConfig        `json:"llm_config,omitempty"`
	DataVendorConfig *DataVendorConfig `json:"data_vendor_config,omitempty"`
}

type TradingDecisionPayload struct {
	Action       string                 `json:"action"`
	Confidence   float64                `json:"confidence"`
	PositionSize *int                   `json:"position_size,omitempty"`
	Reasoning    map[string]interface{} `json:"reasoning,omitempty"`
	RawDecision  map[string]interface{} `json:"raw_decision,omitempty"`
}

type AnalysisTaskStage struct {
	StageID         string      `json:"stage_id"`
	Label           string      `json:"label"`
	Status          string      `json:"status"`
	Backend         string      `json:"backend"`
	Summary         string      `json:"summary,omitempty"`
	Content         interface{} `json:"content,omitempty"`
	AgentID         string      `json:"agent_id,omitempty"`
	SessionKey      string      `json:"session_key,omitempty"`
	RawOutput       interface{} `json:"raw_output,omitempty"`
	StartedAt       string      `json:"started_at,omitempty"`
	CompletedAt     string      `json:"completed_at,omitempty"`
	DurationSeconds float64     `json:"duration_seconds,omitempty"`
	Error           string      `json:"error,omitempty"`
}

type RuntimeTaskState struct {
	TaskID                string                  `json:"task_id"`
	Status                string                  `json:"status"`
	CancelRequested       bool                    `json:"cancel_requested,omitempty"`
	Ticker                string                  `json:"ticker"`
	Date                  string                  `json:"date"`
	ExecutionMode         string                  `json:"execution_mode,omitempty"`
	Decision              *TradingDecisionPayload `json:"decision,omitempty"`
	Stages                []AnalysisTaskStage     `json:"stages,omitempty"`
	AnalysisReport        map[string]interface{}  `json:"analysis_report,omitempty"`
	Error                 string                  `json:"error,omitempty"`
	CreatedAt             string                  `json:"created_at"`
	CompletedAt           string                  `json:"completed_at,omitempty"`
	ProcessingTimeSeconds float64                 `json:"processing_time_seconds,omitempty"`
}

type AnalysisTaskResponse struct {
	ID                    uint                    `json:"id"`
	TaskID                string                  `json:"task_id"`
	Ticker                string                  `json:"ticker"`
	AnalysisDate          string                  `json:"analysis_date"`
	Status                string                  `json:"status"`
	ExecutionMode         string                  `json:"execution_mode"`
	Decision              *TradingDecisionPayload `json:"decision,omitempty"`
	Stages                []AnalysisTaskStage     `json:"stages,omitempty"`
	AnalysisReport        map[string]interface{}  `json:"analysis_report,omitempty"`
	Error                 string                  `json:"error,omitempty"`
	CompletedAt           string                  `json:"completed_at,omitempty"`
	ProcessingTimeSeconds float64                 `json:"processing_time_seconds,omitempty"`
	LLMProvider           string                  `json:"llm_provider,omitempty"`
	LLMModel              string                  `json:"llm_model,omitempty"`
	LLMBaseURL            string                  `json:"llm_base_url,omitempty"`
	CreatedAt             string                  `json:"created_at"`
	UpdatedAt             string                  `json:"updated_at"`
}

func generateTaskID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}

	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80

	return fmt.Sprintf(
		"%x-%x-%x-%x-%x",
		buf[0:4],
		buf[4:6],
		buf[6:8],
		buf[8:10],
		buf[10:16],
	), nil
}

func loadDurationFromEnv(name string, fallback time.Duration) time.Duration {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}

func runtimeStateKey(taskID string) string {
	return tradingRuntimeKeyPrefix + taskID
}

func saveRuntimeState(ctx context.Context, state *RuntimeTaskState) error {
	body, err := json.Marshal(state)
	if err != nil {
		return err
	}

	return global.RedisDB.Set(ctx, runtimeStateKey(state.TaskID), body, tradingRuntimeTTL).Err()
}

func loadRuntimeState(ctx context.Context, taskID string) (*RuntimeTaskState, error) {
	payload, err := global.RedisDB.Get(ctx, runtimeStateKey(taskID)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var state RuntimeTaskState
	if err := json.Unmarshal([]byte(payload), &state); err != nil {
		return nil, err
	}

	return &state, nil
}

func enqueueAnalysisRequest(ctx context.Context, request *AnalysisRequest) error {
	payload, err := json.Marshal(request)
	if err != nil {
		return err
	}

	if request.TaskID != "" {
		if _, err := removeAnalysisPayloads(ctx, tradingQueueKey, request.TaskID); err != nil {
			return err
		}
	}

	return global.RedisDB.LPush(ctx, tradingQueueKey, payload).Err()
}

func queuePayloadTaskID(payload string) string {
	var queued struct {
		TaskID string `json:"task_id"`
	}

	if err := json.Unmarshal([]byte(payload), &queued); err != nil {
		return ""
	}

	return queued.TaskID
}

func filterQueuePayloadsByTaskID(payloads []string, taskID string) ([]string, int) {
	if taskID == "" || len(payloads) == 0 {
		return payloads, 0
	}

	filtered := make([]string, 0, len(payloads))
	removed := 0
	for _, payload := range payloads {
		if queuePayloadTaskID(payload) == taskID {
			removed++
			continue
		}
		filtered = append(filtered, payload)
	}

	return filtered, removed
}

func replaceRedisList(ctx context.Context, key string, payloads []string) error {
	pipe := global.RedisDB.TxPipeline()
	pipe.Del(ctx, key)
	for _, payload := range payloads {
		pipe.RPush(ctx, key, payload)
	}
	_, err := pipe.Exec(ctx)
	return err
}

func removeAnalysisPayloads(ctx context.Context, key string, taskID string) (int, error) {
	if taskID == "" {
		return 0, nil
	}

	payloads, err := global.RedisDB.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		return 0, err
	}

	filtered, removed := filterQueuePayloadsByTaskID(payloads, taskID)
	if removed == 0 {
		return 0, nil
	}

	if err := replaceRedisList(ctx, key, filtered); err != nil {
		return 0, err
	}

	return removed, nil
}

func removeAnalysisPayloadsFromQueues(ctx context.Context, taskID string) error {
	if _, err := removeAnalysisPayloads(ctx, tradingQueueKey, taskID); err != nil {
		return err
	}
	if _, err := removeAnalysisPayloads(ctx, tradingProcessingQueueKey, taskID); err != nil {
		return err
	}
	return nil
}

func normalizeExecutionMode(raw string) string {
	switch raw {
	case "openclaw":
		return "openclaw"
	default:
		return "default"
	}
}

func marshalTaskConfig(request *AnalysisRequest) (*string, error) {
	config := struct {
		ExecutionMode    string            `json:"execution_mode,omitempty"`
		LLMConfig        *LLMConfig        `json:"llm_config,omitempty"`
		DataVendorConfig *DataVendorConfig `json:"data_vendor_config,omitempty"`
	}{
		ExecutionMode:    normalizeExecutionMode(request.ExecutionMode),
		LLMConfig:        request.LLMConfig,
		DataVendorConfig: request.DataVendorConfig,
	}

	body, err := json.Marshal(config)
	if err != nil {
		return nil, err
	}

	value := string(body)
	return &value, nil
}

func parseOptionalJSONMap(raw *string) map[string]interface{} {
	if raw == nil || *raw == "" {
		return nil
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal([]byte(*raw), &decoded); err != nil {
		return nil
	}

	return decoded
}

func parseStagesFromReport(report map[string]interface{}) []AnalysisTaskStage {
	if report == nil {
		return nil
	}

	rawStages, ok := report["__stages"].([]interface{})
	if !ok || len(rawStages) == 0 {
		return nil
	}

	parsed := make([]AnalysisTaskStage, 0, len(rawStages))
	for _, item := range rawStages {
		stageMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		stage := AnalysisTaskStage{
			StageID:     toStringValue(stageMap["stage_id"]),
			Label:       toStringValue(stageMap["label"]),
			Status:      toStringValue(stageMap["status"]),
			Backend:     toStringValue(stageMap["backend"]),
			Summary:     toStringValue(stageMap["summary"]),
			Content:     stageMap["content"],
			AgentID:     toStringValue(stageMap["agent_id"]),
			SessionKey:  toStringValue(stageMap["session_key"]),
			RawOutput:   stageMap["raw_output"],
			StartedAt:   toStringValue(stageMap["started_at"]),
			CompletedAt: toStringValue(stageMap["completed_at"]),
			Error:       toStringValue(stageMap["error"]),
		}
		if duration, ok := stageMap["duration_seconds"].(float64); ok {
			stage.DurationSeconds = duration
		}
		parsed = append(parsed, stage)
	}

	return parsed
}

func toStringValue(value interface{}) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func buildDecisionFromStored(decision *models.TradingDecision) *TradingDecisionPayload {
	if decision == nil {
		return nil
	}

	if decision.RawDecision != nil && *decision.RawDecision != "" {
		var payload TradingDecisionPayload
		if err := json.Unmarshal([]byte(*decision.RawDecision), &payload); err == nil && payload.Action != "" {
			return &payload
		}
	}

	response := &TradingDecisionPayload{
		Action:     decision.Action,
		Confidence: decision.Confidence,
	}
	if decision.PositionSize != 0 {
		positionSize := decision.PositionSize
		response.PositionSize = &positionSize
	}

	if raw := parseOptionalJSONMap(decision.RawDecision); raw != nil {
		response.RawDecision = raw
	}

	return response
}

func buildAnalysisTaskResponse(task *models.TradingAnalysisTask, runtime *RuntimeTaskState) AnalysisTaskResponse {
	response := AnalysisTaskResponse{
		ID:                    task.ID,
		TaskID:                task.TaskID,
		Ticker:                task.Ticker,
		AnalysisDate:          task.AnalysisDate,
		Status:                task.Status,
		ExecutionMode:         normalizeExecutionMode(task.ExecutionMode),
		Error:                 task.Error,
		ProcessingTimeSeconds: task.ProcessingTimeSeconds,
		LLMProvider:           task.LLMProvider,
		LLMModel:              task.LLMModel,
		LLMBaseURL:            task.LLMBaseURL,
		CreatedAt:             task.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:             task.UpdatedAt.UTC().Format(time.RFC3339),
	}

	if task.CompletedAt != nil {
		response.CompletedAt = task.CompletedAt.UTC().Format(time.RFC3339)
	}

	if task.Decision != nil {
		response.Decision = buildDecisionFromStored(task.Decision)
		response.AnalysisReport = parseOptionalJSONMap(task.Decision.AnalysisReport)
		response.Stages = parseStagesFromReport(response.AnalysisReport)
	}

	if runtime == nil {
		return response
	}

	if runtime.Status != "" {
		response.Status = runtime.Status
	}
	if runtime.ExecutionMode != "" {
		response.ExecutionMode = normalizeExecutionMode(runtime.ExecutionMode)
	}
	if runtime.Error != "" {
		response.Error = runtime.Error
	}
	if runtime.CompletedAt != "" {
		response.CompletedAt = runtime.CompletedAt
	}
	if runtime.ProcessingTimeSeconds > 0 {
		response.ProcessingTimeSeconds = runtime.ProcessingTimeSeconds
	}
	if runtime.Decision != nil {
		response.Decision = runtime.Decision
	}
	if len(runtime.Stages) > 0 {
		response.Stages = runtime.Stages
	}
	if runtime.AnalysisReport != nil {
		response.AnalysisReport = runtime.AnalysisReport
		if len(response.Stages) == 0 {
			response.Stages = parseStagesFromReport(runtime.AnalysisReport)
		}
	}

	return response
}

func parseRuntimeTimestamp(raw string) (*time.Time, error) {
	if raw == "" {
		return nil, nil
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999",
		"2006-01-02T15:04:05",
	}

	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			value := parsed.UTC()
			return &value, nil
		}
	}

	return nil, fmt.Errorf("unsupported timestamp %q", raw)
}

func staleTimeoutForStatus(status string) (time.Duration, bool) {
	switch status {
	case "pending":
		return stalePendingTimeout, true
	case "processing":
		return staleProcessingTimeout, true
	default:
		return 0, false
	}
}

func shouldFailMissingRuntimeTask(task *models.TradingAnalysisTask, now time.Time) (bool, string) {
	timeout, ok := staleTimeoutForStatus(task.Status)
	if !ok {
		return false, ""
	}

	lastSeen := task.UpdatedAt.UTC()
	if lastSeen.IsZero() {
		lastSeen = task.CreatedAt.UTC()
	}

	if now.UTC().Sub(lastSeen) < timeout {
		return false, ""
	}

	return true, fmt.Sprintf(
		"task runtime state missing during reconciliation after %s in %s state",
		timeout,
		task.Status,
	)
}

func persistTaskFromRuntime(ctx context.Context, task *models.TradingAnalysisTask, runtime *RuntimeTaskState) error {
	if runtime == nil {
		return nil
	}

	changed := false

	if runtime.Status != "" && task.Status != runtime.Status {
		task.Status = runtime.Status
		changed = true
	}
	if runtime.ExecutionMode != "" && task.ExecutionMode != normalizeExecutionMode(runtime.ExecutionMode) {
		task.ExecutionMode = normalizeExecutionMode(runtime.ExecutionMode)
		changed = true
	}
	if runtime.Error != "" && task.Error != runtime.Error {
		task.Error = runtime.Error
		changed = true
	}
	if runtime.ProcessingTimeSeconds > 0 && task.ProcessingTimeSeconds != runtime.ProcessingTimeSeconds {
		task.ProcessingTimeSeconds = runtime.ProcessingTimeSeconds
		changed = true
	}
	if runtime.CompletedAt != "" {
		completedAt, err := parseRuntimeTimestamp(runtime.CompletedAt)
		if err != nil {
			return err
		}
		if completedAt != nil && (task.CompletedAt == nil || !task.CompletedAt.Equal(*completedAt)) {
			task.CompletedAt = completedAt
			changed = true
		}
	}

	if runtime.Status == "completed" && runtime.Decision != nil {
		reportJSON, err := json.Marshal(runtime.AnalysisReport)
		if err != nil {
			return err
		}
		decisionJSON, err := json.Marshal(runtime.Decision)
		if err != nil {
			return err
		}

		var decision models.TradingDecision
		err = global.DB.WithContext(ctx).Where("task_id = ?", task.TaskID).First(&decision).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		decision.TaskID = task.TaskID
		decision.Action = runtime.Decision.Action
		decision.Confidence = runtime.Decision.Confidence
		if runtime.Decision.PositionSize != nil {
			decision.PositionSize = *runtime.Decision.PositionSize
		}

		reportText := string(reportJSON)
		decisionText := string(decisionJSON)
		decision.AnalysisReport = &reportText
		decision.RawDecision = &decisionText

		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := global.DB.WithContext(ctx).Create(&decision).Error; err != nil {
				return err
			}
		} else {
			if err := global.DB.WithContext(ctx).Save(&decision).Error; err != nil {
				return err
			}
		}

		task.Decision = &decision
	}

	if changed {
		if err := global.DB.WithContext(ctx).Save(task).Error; err != nil {
			return err
		}
	}

	return nil
}

func reconcileTaskRuntime(ctx context.Context, task *models.TradingAnalysisTask) (*RuntimeTaskState, error) {
	if task.Status != "pending" && task.Status != "processing" {
		return nil, nil
	}

	runtime, err := loadRuntimeState(ctx, task.TaskID)
	if err != nil {
		return nil, err
	}
	if runtime != nil {
		if err := persistTaskFromRuntime(ctx, task, runtime); err != nil {
			return nil, err
		}
		return runtime, nil
	}

	shouldFail, reason := shouldFailMissingRuntimeTask(task, time.Now().UTC())
	if !shouldFail {
		return nil, nil
	}

	now := time.Now().UTC()
	task.Status = "failed"
	task.Error = reason
	task.CompletedAt = &now

	if err := global.DB.WithContext(ctx).Save(task).Error; err != nil {
		return nil, err
	}

	return nil, nil
}

func unmarshalTaskConfig(raw *string) (*AnalysisRequest, error) {
	if raw == nil || *raw == "" {
		return &AnalysisRequest{ExecutionMode: "default"}, nil
	}

	var req AnalysisRequest
	if err := json.Unmarshal([]byte(*raw), &req); err != nil {
		return nil, err
	}
	req.ExecutionMode = normalizeExecutionMode(req.ExecutionMode)
	return &req, nil
}
