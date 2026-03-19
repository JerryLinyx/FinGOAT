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
		identity, err := utils.ParseJWT(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}

		var user models.User
		switch {
		case identity.UserID != 0:
			err = global.DB.First(&user, identity.UserID).Error
		case identity.Username != "":
			err = global.DB.Where("username = ?", identity.Username).First(&user).Error
		default:
			err = http.ErrNoCookie
		}
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
			c.Abort()
			return
		}

		c.Set("username", user.Username)
		c.Set("user_id", user.ID)
		c.Set("user_role", models.NormalizeUserRole(user.Role))
		c.Next()
	}
}
