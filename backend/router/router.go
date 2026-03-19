package router

import (
	"os"
	"strings"
	"time"

	"github.com/JerryLinyx/FinGOAT/controllers"
	"github.com/JerryLinyx/FinGOAT/middlewares"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func InitRouter() *gin.Engine {
	r := gin.Default()

	allowedOrigins := []string{"http://localhost:5173", "http://localhost:8080"}
	if raw := os.Getenv("FRONTEND_ORIGINS"); raw != "" {
		split := strings.Split(raw, ",")
		allowedOrigins = allowedOrigins[:0]
		for _, v := range split {
			trimmed := strings.TrimSpace(v)
			if trimmed != "" {
				allowedOrigins = append(allowedOrigins, trimmed)
			}
		}
		if len(allowedOrigins) == 0 {
			allowedOrigins = []string{"*"}
		}
	}

	allowCreds := true
	if len(allowedOrigins) == 1 && allowedOrigins[0] == "*" {
		allowCreds = false
	}

	r.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: allowCreds,
		// AllowOriginFunc: func(origin string) bool {
		// 	return origin == "https://github.com"
		// },
		MaxAge: 12 * time.Hour,
	}))

	// Public health endpoint for liveness/readiness checks
	r.GET("/api/health", controllers.Health)

	auth := r.Group("/api/auth")
	{
		auth.POST("/login", controllers.Login)
		auth.POST("/register", controllers.Register)
		auth.GET("/verify-email", controllers.VerifyEmail)
	}

	api := r.Group("/api")
	api.GET("/exchangeRates", controllers.GetExchangeRates)
	api.Use(middlewares.AuthMiddleware())
	{
		api.POST("/exchangeRates", controllers.CreateExchangeRate)

		api.GET("/articles", controllers.GetArticles)
		api.GET("/articles/refresh", controllers.RefreshRSSArticles)
		api.GET("/articles/:id", controllers.GetArticlesByID)
		api.POST("/articles", controllers.CreateArticle)

		api.POST("/articles/:id/like", controllers.LikeArticle)
		api.GET("/articles/:id/like", controllers.GetArticleLikes)

		feed := api.Group("/feed")
		{
			feed.GET("", controllers.GetFeed)
			feed.GET("/sources", controllers.GetFeedSources)
			feed.GET("/preferences", controllers.GetFeedPreferences)
			feed.PUT("/preferences", controllers.PutFeedPreferences)
			feed.POST("/items/:id/like", controllers.ToggleFeedLike)
			feed.POST("/items/:id/save", controllers.ToggleFeedSave)
		}

		// User profile and API key routes
		user := api.Group("/user")
		{
			user.GET("/profile", controllers.GetProfile)
			user.PUT("/profile", controllers.UpdateProfile)
			user.GET("/api-keys", controllers.GetAPIKeys)
			user.PUT("/api-keys/:provider", controllers.UpsertAPIKey)
			user.DELETE("/api-keys/:provider", controllers.DeleteAPIKey)
			user.POST("/resend-verification", controllers.ResendVerification)
		}

		// Trading analysis routes
		trading := api.Group("/trading")
		{
			trading.POST("/analyze", controllers.RequestAnalysis)
			trading.GET("/analysis/:task_id", controllers.GetAnalysisResult)
			trading.GET("/analysis/:task_id/stream", controllers.StreamAnalysisResult)
			trading.POST("/analysis/:task_id/cancel", controllers.CancelAnalysis)
			trading.POST("/analysis/:task_id/resume", controllers.ResumeAnalysis)
			trading.GET("/analyses", controllers.ListUserAnalyses)
			trading.GET("/stats", controllers.GetAnalysisStats)
			trading.GET("/health", controllers.CheckServiceHealth)
			trading.GET("/chart/:ticker", controllers.GetStockChart)
			trading.GET("/terminal/:ticker", controllers.GetStockTerminal)
			trading.GET("/quote/:ticker", controllers.GetStockQuote)
			trading.GET("/ollama/models", controllers.GetOllamaModels)
		}

		// Usage data routes (user self-service)
		usage := api.Group("/usage")
		{
			usage.GET("/summary", controllers.GetUsageSummary)
			usage.GET("/tasks/:task_id", controllers.GetTaskUsageDetail)
		}

		// Admin-only routes
		admin := api.Group("/admin")
		admin.Use(middlewares.RequireAdmin())
		{
			admin.GET("/usage/summary", controllers.GetAdminUsageSummary)
			admin.GET("/usage/users", controllers.GetAdminUserUsage)
		}
	}

	return r
}
