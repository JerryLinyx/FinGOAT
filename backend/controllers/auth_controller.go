package controllers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	mathrand "math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/JerryLinyx/FinGOAT/config"
	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/JerryLinyx/FinGOAT/utils"
	"github.com/gin-gonic/gin"
)

// RegisterInput accepts email-first registration.
// For backward compatibility a bare { username, password } body is also supported.
type RegisterInput struct {
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Username    string `json:"username"` // legacy path
	Password    string `json:"password" binding:"required"`
}

// Register creates a new user account.
//
// Email-first path:     { email, password, display_name? }
// Legacy path (compat): { username, password }
func Register(c *gin.Context) {
	var input RegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var username string
	var emailPtr *string

	switch {
	case input.Email != "":
		emailNorm, ok := normalizeEmail(input.Email)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email address"})
			return
		}
		emailPtr = &emailNorm
		username = generateAvailableUsername(emailNorm)

	case input.Username != "":
		username = strings.TrimSpace(input.Username)

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "either email or username is required"})
		return
	}

	hashedPassword, err := utils.HashPassword(input.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	user := models.User{
		Username:     username,
		PasswordHash: hashedPassword,
		Email:        emailPtr,
		DisplayName:  strings.TrimSpace(input.DisplayName),
	}

	if err := global.DB.Create(&user).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, gin.H{"error": "email or username already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Send email verification if the user registered with an email.
	if emailPtr != nil {
		go createAndSendVerificationToken(user)
	}

	token, err := utils.GenerateJWT(user.ID, user.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	displayName := user.DisplayName
	if displayName == "" {
		displayName = user.Username
	}

	c.JSON(http.StatusOK, gin.H{
		"token":        token,
		"username":     user.Username,
		"display_name": displayName,
	})
}

// LoginInput accepts email or username as the identifier.
type LoginInput struct {
	Identifier string `json:"identifier"`
	Username   string `json:"username"`
	Email      string `json:"email"`
	Password   string `json:"password" binding:"required"`
}

// Login authenticates a user via email or username.
//
// Preferred: { identifier, password }
// Compatibility: { email, password } or { username, password }
func Login(c *gin.Context) {
	var input LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	identifier := resolveLoginIdentifier(input)
	if identifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "identifier, email, or username is required"})
		return
	}

	var user models.User
	found := false

	// Try email lookup first when identifier looks like an email.
	if strings.Contains(identifier, "@") {
		emailNorm, ok := normalizeEmail(identifier)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email address"})
			return
		}
		if err := global.DB.Where("email = ?", emailNorm).First(&user).Error; err == nil {
			found = true
		}
	}

	// Fall back to username lookup.
	if !found {
		if err := global.DB.Where("username = ?", identifier).First(&user).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
	}

	if !utils.CheckPassword(input.Password, user.PasswordHash) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	token, err := utils.GenerateJWT(user.ID, user.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	displayName := user.DisplayName
	if displayName == "" {
		displayName = user.Username
	}

	c.JSON(http.StatusOK, gin.H{
		"token":        token,
		"username":     user.Username,
		"display_name": displayName,
	})
}

func normalizeEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if email == "" || !strings.Contains(email, "@") {
		return "", false
	}
	return email, true
}

func sanitizeUsernameBase(email string) string {
	base := strings.Split(email, "@")[0]
	var clean strings.Builder
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			clean.WriteRune(r)
		}
	}
	if clean.Len() == 0 {
		return "user"
	}
	return clean.String()
}

func generateAvailableUsername(email string) string {
	base := sanitizeUsernameBase(email)
	username := base
	for attempts := 0; attempts < 10; attempts++ {
		var existing models.User
		if err := global.DB.Where("username = ?", username).First(&existing).Error; err != nil {
			return username
		}
		username = fmt.Sprintf("%s%04d", base, mathrand.Intn(10000))
	}
	return fmt.Sprintf("%s%04d", base, mathrand.Intn(10000))
}

func resolveLoginIdentifier(input LoginInput) string {
	if identifier := strings.TrimSpace(input.Identifier); identifier != "" {
		return identifier
	}
	if email := strings.TrimSpace(input.Email); email != "" {
		return email
	}
	return strings.TrimSpace(input.Username)
}

// VerifyEmail handles GET /api/auth/verify-email?token=xxx
// Marks the user's email as verified. Public endpoint.
func VerifyEmail(c *gin.Context) {
	tokenStr := strings.TrimSpace(c.Query("token"))
	if tokenStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is required"})
		return
	}

	var tok models.EmailToken
	if err := global.DB.Where("token = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?",
		tokenStr, "verify", time.Now()).First(&tok).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or expired token"})
		return
	}

	now := time.Now()
	if err := global.DB.Model(&tok).Update("used_at", &now).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to consume token"})
		return
	}

	if err := global.DB.Model(&models.User{}).Where("id = ?", tok.UserID).
		Update("email_verified", true).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "email verified successfully"})
}

// ResendVerification handles POST /api/auth/resend-verification
// Sends a new verification email. Requires authentication.
func ResendVerification(c *gin.Context) {
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var user models.User
	if err := global.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if user.EmailVerified {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is already verified"})
		return
	}

	if user.Email == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no email address on this account"})
		return
	}

	// Delete old unused verify tokens for this user.
	global.DB.Where("user_id = ? AND purpose = ? AND used_at IS NULL", user.ID, "verify").
		Delete(&models.EmailToken{})

	go createAndSendVerificationToken(user)

	c.JSON(http.StatusOK, gin.H{"message": "verification email sent"})
}

// createAndSendVerificationToken creates a new verify token in DB and sends the email.
// Intended to be called in a goroutine — errors are logged, not returned.
func createAndSendVerificationToken(user models.User) {
	if user.Email == nil {
		return
	}

	// Generate a cryptographically secure 32-byte token (64 hex chars).
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		fmt.Printf("[email] failed to generate token: %v\n", err)
		return
	}
	tokenStr := hex.EncodeToString(raw)

	tok := models.EmailToken{
		UserID:    user.ID,
		Token:     tokenStr,
		Purpose:   "verify",
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	if err := global.DB.Create(&tok).Error; err != nil {
		fmt.Printf("[email] failed to create email token: %v\n", err)
		return
	}

	emailCfg := config.LoadEmailConfig()
	verifyURL := fmt.Sprintf("%s/api/auth/verify-email?token=%s", emailCfg.VerifyURLBase, tokenStr)

	displayName := user.DisplayName
	if displayName == "" {
		displayName = user.Username
	}

	textBody, htmlBody := config.VerificationEmailBody(displayName, verifyURL)
	if err := config.SendEmail(emailCfg, *user.Email, "Verify your FinGOAT email", textBody, htmlBody); err != nil {
		fmt.Printf("[email] failed to send verification email to %s: %v\n", *user.Email, err)
	}
}
