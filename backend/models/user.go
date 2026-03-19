package models

import (
	"strings"

	"gorm.io/gorm"
)

const (
	UserRoleUser  = "user"
	UserRoleAdmin = "admin"
)

func NormalizeUserRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case UserRoleAdmin:
		return UserRoleAdmin
	default:
		return UserRoleUser
	}
}

type User struct {
	gorm.Model
	Username      string  `gorm:"type:varchar(100);not null;uniqueIndex"`
	PasswordHash  string  `gorm:"column:password_hash;type:text;not null"`
	Email         *string `gorm:"type:varchar(255);uniqueIndex"`
	EmailVerified bool    `gorm:"default:false"`
	DisplayName   string  `gorm:"type:varchar(100);default:''"`
	AvatarURL     string  `gorm:"type:text;default:''"`
	Role          string  `gorm:"type:varchar(20);default:'user';not null"`
}
