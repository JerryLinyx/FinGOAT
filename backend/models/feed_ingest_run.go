package models

import (
	"time"

	"gorm.io/gorm"
)

// FeedIngestRun tracks each article ingest attempt so refresh logic can make
// decisions based on recent successful syncs.
type FeedIngestRun struct {
	gorm.Model
	Trigger      string     `gorm:"index"`
	Status       string     `gorm:"index"`
	StartedAt    time.Time  `gorm:"index"`
	FinishedAt   *time.Time
	NewCount     int
	WarningCount int
	Error        string
}
