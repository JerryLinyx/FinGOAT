package controllers

import (
	"fmt"
	"math/rand"
	"net/http"
	"strings"

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
		// ── Email-first path ──────────────────────────────────────────────
		if !strings.Contains(input.Email, "@") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email address"})
			return
		}
		emailNorm := strings.ToLower(strings.TrimSpace(input.Email))
		emailPtr = &emailNorm

		// Derive a username from the email prefix; append a random 4-digit
		// suffix if the base name is already taken.
		base := strings.Split(emailNorm, "@")[0]
		var clean strings.Builder
		for _, r := range base {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
				clean.WriteRune(r)
			}
		}
		base = clean.String()
		if base == "" {
			base = "user"
		}
		username = base
		var existing models.User
		if err := global.DB.Where("username = ?", username).First(&existing).Error; err == nil {
			username = fmt.Sprintf("%s%04d", base, rand.Intn(10000))
		}

	case input.Username != "":
		// ── Legacy path ───────────────────────────────────────────────────
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

	token, err := utils.GenerateJWT(user.Username)
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
	Identifier string `json:"identifier" binding:"required"`
	Password   string `json:"password"   binding:"required"`
}

// Login authenticates a user via email or username.
//
// { identifier, password } — identifier may be an email address or a username.
func Login(c *gin.Context) {
	var input LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	identifier := strings.TrimSpace(input.Identifier)
	var user models.User
	found := false

	// Try email lookup first when identifier looks like an email.
	if strings.Contains(identifier, "@") {
		emailNorm := strings.ToLower(identifier)
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

	token, err := utils.GenerateJWT(user.Username)
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
