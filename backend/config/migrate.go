package config

import (
	"fmt"
	"log"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
)

// MigrateDB runs database migrations
func MigrateDB() {
	err := global.DB.AutoMigrate(
		&models.User{},
		&models.UserAPIKey{},
		&models.EmailToken{},
		&models.FeedSource{},
		&models.FeedItem{},
		&models.FeedTag{},
		&models.UserFeedPreference{},
		&models.UserFeedSave{},
		&models.UserFeedLike{},
		&models.ExchangeRate{},
		&models.TradingAnalysisTask{},
		&models.TradingDecision{},
		&models.LLMUsageEvent{},
		&models.AnalysisRunMetrics{},
	)
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}
	if err := migrateLegacyUserPasswordColumn(); err != nil {
		log.Fatalf("Failed to migrate legacy user password data: %v", err)
	}
	if err := migrateLegacyUserRoleColumn(); err != nil {
		log.Fatalf("Failed to migrate legacy user role data: %v", err)
	}
	if err := pgvectorMigrate(); err != nil {
		if AppConfig != nil && AppConfig.Features.RequirePgvector {
			log.Fatalf("Failed to run pgvector migration: %v", err)
		}
		log.Printf("Skipping pgvector migration: %v", err)
	}
	if err := usageMigrate(); err != nil {
		log.Printf("Warning: usage index migration failed: %v", err)
	}
	log.Println("Database migration completed successfully")
}

func migrateLegacyUserRoleColumn() error {
	if !global.DB.Migrator().HasTable(&models.User{}) {
		return nil
	}

	if !global.DB.Migrator().HasColumn(&models.User{}, "Role") {
		if err := global.DB.Migrator().AddColumn(&models.User{}, "Role"); err != nil {
			return err
		}
	}

	if err := global.DB.Exec(`
		UPDATE users
		SET role = 'user'
		WHERE role IS NULL OR TRIM(role) = '' OR role NOT IN ('user', 'admin')
	`).Error; err != nil {
		return err
	}

	return nil
}

// usageMigrate creates composite indexes for usage event queries.
func usageMigrate() error {
	if err := global.DB.Exec(`
		CREATE INDEX IF NOT EXISTS idx_usage_user_started
		ON llm_usage_events (user_id, request_started_at DESC)
	`).Error; err != nil {
		return fmt.Errorf("failed to create idx_usage_user_started: %w", err)
	}
	return nil
}

// pgvectorMigrate creates the pgvector extension and user_memory_entries table.
// Safe to re-run — all statements are idempotent.
func pgvectorMigrate() error {
	// Enable the pgvector extension (requires pgvector/pgvector:pg15 image).
	if err := global.DB.Exec("CREATE EXTENSION IF NOT EXISTS vector").Error; err != nil {
		return fmt.Errorf("failed to create vector extension: %w", err)
	}

	// user_memory_entries: per-user, per-role persistent vector memory.
	// Column `embedding` uses dimensionless vector to support OpenAI (1536-dim),
	// DashScope (1024-dim), and Ollama (768-dim) without zero-padding.
	if err := global.DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_memory_entries (
			id              BIGSERIAL PRIMARY KEY,
			user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			agent_role      VARCHAR(32) NOT NULL,
			ticker          VARCHAR(16),
			situation       TEXT NOT NULL,
			recommendation  TEXT NOT NULL,
			embedding       vector,
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`).Error; err != nil {
		return fmt.Errorf("failed to create user_memory_entries: %w", err)
	}

	if err := global.DB.Exec(`
		CREATE INDEX IF NOT EXISTS idx_memory_user_role
		ON user_memory_entries (user_id, agent_role)
	`).Error; err != nil {
		return fmt.Errorf("failed to create idx_memory_user_role: %w", err)
	}

	return nil
}

// migrateLegacyUserPasswordColumn preserves compatibility with older databases
// that stored bcrypt hashes in users.password before the password_hash rename.
func migrateLegacyUserPasswordColumn() error {
	if !global.DB.Migrator().HasTable(&models.User{}) {
		return nil
	}

	if !global.DB.Migrator().HasColumn(&models.User{}, "PasswordHash") {
		if err := global.DB.Migrator().AddColumn(&models.User{}, "PasswordHash"); err != nil {
			return err
		}
	}

	if global.DB.Migrator().HasColumn(&models.User{}, "password") {
		if err := global.DB.Exec(`
			UPDATE users
			SET password_hash = password
			WHERE (password_hash IS NULL OR password_hash = '')
			  AND password IS NOT NULL
			  AND password <> ''
		`).Error; err != nil {
			return err
		}

		// Older schemas still keep users.password as NOT NULL. Once writes move to
		// password_hash, new inserts will fail unless we relax the legacy column.
		if err := global.DB.Exec(`
			ALTER TABLE users
			ALTER COLUMN password DROP NOT NULL
		`).Error; err != nil {
			return err
		}
	}

	return nil
}
