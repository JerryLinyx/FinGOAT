package controllers

import (
	"net/http"
	"strings"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/JerryLinyx/FinGOAT/utils"
	"github.com/gin-gonic/gin"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

func currentUserID(c *gin.Context) (uint, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}
	uid, ok := v.(uint)
	return uid, ok
}

func normalizeAPIKeyProvider(provider string) string {
	normalized := strings.ToLower(strings.TrimSpace(provider))
	if normalized == "aliyun" {
		return "dashscope"
	}
	return normalized
}

// lookupDecryptedKey fetches and decrypts the stored API key for the given
// user and provider. Returns ("", nil) if no key is stored.
func lookupDecryptedKey(userID uint, provider string) (string, error) {
	var rec models.UserAPIKey
	err := global.DB.Where("user_id = ? AND provider = ?", userID, provider).First(&rec).Error
	if err != nil {
		return "", nil // not found = no key set
	}
	return utils.DecryptAPIKey(rec.EncryptedKey)
}

// ─── Profile ──────────────────────────────────────────────────────────────────

// GetProfile returns the authenticated user's public profile.
// Never includes password or encrypted keys.
func GetProfile(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var user models.User
	if err := global.DB.First(&user, uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	email := ""
	if user.Email != nil {
		email = *user.Email
	}

	c.JSON(http.StatusOK, gin.H{
		"id":           user.ID,
		"username":     user.Username,
		"email":        email,
		"display_name": user.DisplayName,
		"avatar_url":   user.AvatarURL,
		"created_at":   user.CreatedAt,
	})
}

// UpdateProfileInput holds the fields the user may self-edit.
type UpdateProfileInput struct {
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
}

// UpdateProfile edits the authenticated user's display name and avatar URL.
func UpdateProfile(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var input UpdateProfileInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{
		"display_name": strings.TrimSpace(input.DisplayName),
		"avatar_url":   strings.TrimSpace(input.AvatarURL),
	}

	if err := global.DB.Model(&models.User{}).Where("id = ?", uid).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Re-fetch and return the updated profile.
	var user models.User
	if err := global.DB.First(&user, uid).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reload profile"})
		return
	}

	email := ""
	if user.Email != nil {
		email = *user.Email
	}

	c.JSON(http.StatusOK, gin.H{
		"id":           user.ID,
		"username":     user.Username,
		"email":        email,
		"display_name": user.DisplayName,
		"avatar_url":   user.AvatarURL,
		"created_at":   user.CreatedAt,
	})
}

// ─── API Keys ────────────────────────────────────────────────────────────────

// APIKeyListEntry is the safe representation returned to the frontend.
// The plaintext key is never included.
type APIKeyListEntry struct {
	Provider string `json:"provider"`
	IsSet    bool   `json:"is_set"`
	KeyMask  string `json:"key_mask,omitempty"` // e.g. "sk-abc123****"
}

// GetAPIKeys returns a list of configured providers for the authenticated user.
// Key values are never returned; only the masked hint is included.
func GetAPIKeys(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var keys []models.UserAPIKey
	if err := global.DB.Where("user_id = ?", uid).Find(&keys).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Build a lookup map.
	setMap := make(map[string]APIKeyListEntry, len(keys))
	for _, k := range keys {
		provider := normalizeAPIKeyProvider(k.Provider)
		setMap[provider] = APIKeyListEntry{
			Provider: provider,
			IsSet:    true,
			KeyMask:  k.KeyMask,
		}
	}

	// Return a fixed ordered list covering all supported providers.
	providers := []string{"openai", "anthropic", "google", "deepseek", "dashscope", "alpha_vantage"}
	result := make([]APIKeyListEntry, 0, len(providers))
	for _, p := range providers {
		if entry, exists := setMap[p]; exists {
			result = append(result, entry)
		} else {
			result = append(result, APIKeyListEntry{Provider: p, IsSet: false})
		}
	}

	c.JSON(http.StatusOK, gin.H{"api_keys": result})
}

// UpsertAPIKeyInput holds the plaintext key sent by the frontend.
type UpsertAPIKeyInput struct {
	Key string `json:"key" binding:"required"`
}

// UpsertAPIKey creates or replaces the API key for the given provider.
// The key is encrypted with AES-256-GCM before storage.
func UpsertAPIKey(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	provider := normalizeAPIKeyProvider(c.Param("provider"))
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider is required"})
		return
	}

	var input UpsertAPIKeyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	plaintext := strings.TrimSpace(input.Key)
	if plaintext == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key must not be empty"})
		return
	}

	encrypted, err := utils.EncryptAPIKey(plaintext)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption failed: " + err.Error()})
		return
	}

	mask := utils.MaskAPIKey(plaintext)

	// Upsert: update if exists, insert if not.
	var existing models.UserAPIKey
	result := global.DB.Where("user_id = ? AND provider IN ?", uid, []string{provider, "aliyun"}).First(&existing)

	if result.Error == nil {
		// Update existing record.
		if err := global.DB.Model(&existing).Updates(map[string]interface{}{
			"provider":      provider,
			"encrypted_key": encrypted,
			"key_mask":      mask,
		}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	} else {
		// Create new record.
		newKey := models.UserAPIKey{
			UserID:       uid,
			Provider:     provider,
			EncryptedKey: encrypted,
			KeyMask:      mask,
		}
		if err := global.DB.Create(&newKey).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"provider": provider,
		"is_set":   true,
		"key_mask": mask,
	})
}

// DeleteAPIKey removes the API key for the given provider.
func DeleteAPIKey(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	provider := normalizeAPIKeyProvider(c.Param("provider"))
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider is required"})
		return
	}

	if err := global.DB.
		Where("user_id = ? AND provider IN ?", uid, []string{provider, "aliyun"}).
		Delete(&models.UserAPIKey{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"provider": provider, "is_set": false})
}
