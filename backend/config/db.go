package config

import (
	"fmt"
	"log"
	"time"

	"github.com/JerryLinyx/FinGOAT/global"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func initDB() {
	dbConf := AppConfig.Database

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable TimeZone=Asia/Shanghai",
		dbConf.Host, dbConf.Port, dbConf.User, dbConf.Password, dbConf.Name,
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	sqlDB, err := db.DB()
	sqlDB.SetMaxIdleConns(AppConfig.Database.MaxIdleConns)
	sqlDB.SetMaxOpenConns(AppConfig.Database.MaxOpenConns)
	sqlDB.SetConnMaxLifetime(time.Hour)
	if err != nil {
		log.Fatalf("Failed to set up database: %v", err)
	}

	global.DB = db
}
