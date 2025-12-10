package models

import (
	"time"

	"gorm.io/gorm"
)

// TradingAnalysisTask represents a trading analysis task
type TradingAnalysisTask struct {
	gorm.Model
	UserID                uint       `gorm:"not null;index" json:"user_id"`
	TaskID                string     `gorm:"type:varchar(100);unique;not null;index" json:"task_id"`
	Ticker                string     `gorm:"type:varchar(10);not null" json:"ticker"`
	AnalysisDate          string     `gorm:"type:varchar(20);not null" json:"analysis_date"`
	Status                string     `gorm:"type:varchar(20);not null" json:"status"` // pending/processing/completed/failed
	Config                *string    `gorm:"type:jsonb" json:"config,omitempty"`
	LLMProvider           string     `gorm:"type:varchar(50)" json:"llm_provider,omitempty"`
	LLMModel              string     `gorm:"type:varchar(100)" json:"llm_model,omitempty"`
	LLMBaseURL            string     `gorm:"type:text" json:"llm_base_url,omitempty"`
	CompletedAt           *time.Time `json:"completed_at,omitempty"`
	ProcessingTimeSeconds float64    `json:"processing_time_seconds,omitempty"`
	Error                 string     `gorm:"type:text" json:"error,omitempty"`

	// Relationship
	Decision *TradingDecision `gorm:"foreignKey:TaskID;references:TaskID" json:"decision,omitempty"`

	// Track who created this
	User User `gorm:"foreignKey:UserID" json:"-"`
}

// TradingDecision represents the trading decision and analysis results
type TradingDecision struct {
	gorm.Model
	TaskID       string  `gorm:"type:varchar(100);not null;index" json:"task_id"`
	Action       string  `gorm:"type:varchar(10);not null" json:"action"` // BUY/SELL/HOLD
	Confidence   float64 `json:"confidence"`
	PositionSize int     `json:"position_size,omitempty"`

	// Complete analysis report from all agents (stored as JSONB)
	AnalysisReport *string `gorm:"type:jsonb" json:"analysis_report,omitempty"`

	// Raw decision text
	RawDecision *string `gorm:"type:jsonb" json:"raw_decision,omitempty"`
}

// TableName specifies the table name for TradingAnalysisTask
func (TradingAnalysisTask) TableName() string {
	return "trading_analysis_tasks"
}

// TableName specifies the table name for TradingDecision
func (TradingDecision) TableName() string {
	return "trading_decisions"
}
