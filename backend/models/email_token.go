package models

import (
	"time"

	"gorm.io/gorm"
)

// EmailToken stores short-lived tokens for email verification and password reset.
type EmailToken struct {
	gorm.Model
	UserID    uint       `gorm:"not null;index"`
	Token     string     `gorm:"type:varchar(64);uniqueIndex;not null"`
	Purpose   string     `gorm:"type:varchar(20);not null"` // "verify" | "reset"
	ExpiresAt time.Time  `gorm:"not null"`
	UsedAt    *time.Time `gorm:"default:null"`
}
