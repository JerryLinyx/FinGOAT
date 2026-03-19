package middlewares

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireAdmin rejects requests from non-admin users with 403.
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("user_role")
		if !exists || role.(string) != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
			c.Abort()
			return
		}
		c.Next()
	}
}
