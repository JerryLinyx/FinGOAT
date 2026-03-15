package models

import "gorm.io/gorm"

type User struct {
	gorm.Model
	Username     string  `gorm:"type:varchar(100);not null;uniqueIndex"`
	PasswordHash string  `gorm:"column:password;type:text;not null"`
	Email        *string `gorm:"type:varchar(255);uniqueIndex"`
	DisplayName  string  `gorm:"type:varchar(100);default:''"`
	AvatarURL    string  `gorm:"type:text;default:''"`
}
