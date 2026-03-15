package models

import "gorm.io/gorm"

// UserAPIKey stores a per-user, per-provider API key encrypted with AES-256-GCM.
// The plaintext key is never persisted; only the encrypted ciphertext and a masked
// display hint are stored.
type UserAPIKey struct {
	gorm.Model
	UserID       uint   `gorm:"not null;uniqueIndex:idx_user_provider"`
	Provider     string `gorm:"type:varchar(50);not null;uniqueIndex:idx_user_provider"` // e.g. openai / anthropic / google / deepseek / dashscope
	EncryptedKey string `gorm:"type:text;not null"`                                      // AES-256-GCM ciphertext, base64-encoded
	KeyMask      string `gorm:"type:varchar(30);default:''"`                             // display hint, e.g. "sk-abc123****"

	User User `gorm:"foreignKey:UserID" json:"-"`
}

// TableName sets the table name for GORM.
func (UserAPIKey) TableName() string {
	return "user_api_keys"
}
