package middlewares

import (
	"net/http"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/JerryLinyx/FinGOAT/utils"
	"github.com/gin-gonic/gin"
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("Authorization")
		// Fallback: browser EventSource cannot set custom headers — accept ?token= query param
		if token == "" {
			if qt := c.Query("token"); qt != "" {
				token = "Bearer " + qt
			}
		}
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		username, err := utils.ParseJWT(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}

		// Find user in database to get user ID
		var user models.User
		if err := global.DB.Where("username = ?", username).First(&user).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
			c.Abort()
			return
		}

		c.Set("username", username)
		c.Set("user_id", user.ID)
		c.Next()
	}
}
