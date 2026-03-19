package models

import "time"

// LLMUsageEvent captures a single LLM API call's metrics.
type LLMUsageEvent struct {
	ID                 uint      `gorm:"primaryKey" json:"id"`
	TaskID             string    `gorm:"type:varchar(64);not null;index:idx_usage_task" json:"task_id"`
	UserID             uint      `gorm:"not null;index:idx_usage_user_time" json:"user_id"`
	Provider           string    `gorm:"type:varchar(32);not null" json:"provider"`
	Model              string    `gorm:"type:varchar(64);not null" json:"model"`
	NodeName           string    `gorm:"type:varchar(64);not null" json:"node_name"`
	EventType          string    `gorm:"type:varchar(32);not null" json:"event_type"` // chat_completion, embedding, tool_call
	PromptTokens       int       `gorm:"default:0" json:"prompt_tokens"`
	CompletionTokens   int       `gorm:"default:0" json:"completion_tokens"`
	TotalTokens        int       `gorm:"default:0" json:"total_tokens"`
	EstimatedCostUSD   *float64  `gorm:"type:decimal(12,8)" json:"estimated_cost_usd"`
	LatencyMs          int       `gorm:"default:0" json:"latency_ms"`
	Success            bool      `gorm:"default:true" json:"success"`
	ErrorMessage       string    `gorm:"type:text" json:"error_message,omitempty"`
	RequestStartedAt   time.Time `gorm:"not null" json:"request_started_at"`
	RequestCompletedAt time.Time `gorm:"not null" json:"request_completed_at"`
	CreatedAt          time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// AnalysisRunMetrics aggregates usage for a complete analysis task.
type AnalysisRunMetrics struct {
	ID                    uint     `gorm:"primaryKey" json:"id"`
	TaskID                string   `gorm:"type:varchar(64);not null;uniqueIndex" json:"task_id"`
	UserID                uint     `gorm:"not null;index:idx_run_user" json:"user_id"`
	TotalPromptTokens     int      `gorm:"default:0" json:"total_prompt_tokens"`
	TotalCompletionTokens int      `gorm:"default:0" json:"total_completion_tokens"`
	TotalTokens           int      `gorm:"default:0" json:"total_tokens"`
	TotalEstimatedCost    *float64 `gorm:"type:decimal(12,8)" json:"total_estimated_cost"`
	TotalLatencyMs        int      `gorm:"default:0" json:"total_latency_ms"`
	TotalLLMCalls         int      `gorm:"default:0" json:"total_llm_calls"`
	FailedCalls           int      `gorm:"default:0" json:"failed_calls"`
	Provider              string   `gorm:"type:varchar(32)" json:"provider"`
	Model                 string   `gorm:"type:varchar(64)" json:"model"`
	ProcessingTimeSec     float64  `gorm:"default:0" json:"processing_time_sec"`
	CreatedAt             time.Time `gorm:"autoCreateTime" json:"created_at"`
}
