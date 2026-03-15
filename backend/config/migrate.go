package config

import (
	"log"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
)

// MigrateDB runs database migrations
func MigrateDB() {
	err := global.DB.AutoMigrate(
		&models.User{},
		&models.UserAPIKey{},
		&models.Article{},
		&models.FeedIngestRun{},
		&models.ExchangeRate{},
		&models.TradingAnalysisTask{},
		&models.TradingDecision{},
		&models.RSSFeed{},
	)
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}
	log.Println("Database migration completed successfully")
}
