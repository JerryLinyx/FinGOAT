package config

import (
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	App struct {
		Name string `yaml:"name"`
		Port string `yaml:"port"`
	} `yaml:"app"`
	Features struct {
		RequirePgvector bool `yaml:"require_pgvector"`
	} `yaml:"features"`
	Database struct {
		Host         string `yaml:"host"`
		Port         string `yaml:"port"`
		User         string `yaml:"user"`
		Password     string `yaml:"password"`
		Name         string `yaml:"name"`
		Sslmode      string `yaml:"sslmode"`
		Timezone     string `yaml:"timezone"`
		MaxIdleConns int    `yaml:"max_idle_conns"`
		MaxOpenConns int    `yaml:"max_open_conns"`
	} `yaml:"database"`
	Redis struct {
		Addr     string `yaml:"addr"`
		Password string `yaml:"password"`
		DB       int    `yaml:"DB"`
	} `yaml:"redis"`
}

var AppConfig *Config

func InitConfig() {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./config")

	err := viper.ReadInConfig()
	if err != nil {
		log.Fatalf("Failed to read config file: %v", err)
	}

	AppConfig = &Config{}
	err = viper.Unmarshal(AppConfig)
	if err != nil {
		log.Fatalf("Failed to unmarshal config: %v", err)
	}

	overrideWithEnv()
	initDB()
	initRedis()
}

// overrideWithEnv allows docker/k8s to inject connection info without changing config files.
func overrideWithEnv() {
	if v := os.Getenv("APP_PORT"); v != "" {
		AppConfig.App.Port = v
	}
	if v := os.Getenv("REQUIRE_PGVECTOR"); v != "" {
		AppConfig.Features.RequirePgvector = strings.EqualFold(v, "true") || v == "1"
	}

	if v := os.Getenv("DB_HOST"); v != "" {
		AppConfig.Database.Host = v
	}
	if v := os.Getenv("DB_PORT"); v != "" {
		AppConfig.Database.Port = v
	}
	if v := os.Getenv("DB_USER"); v != "" {
		AppConfig.Database.User = v
	}
	if v := os.Getenv("DB_PASSWORD"); v != "" {
		AppConfig.Database.Password = v
	}
	if v := os.Getenv("DB_NAME"); v != "" {
		AppConfig.Database.Name = v
	}

	if v := os.Getenv("REDIS_ADDR"); v != "" {
		AppConfig.Redis.Addr = v
	}
	if v := os.Getenv("REDIS_PASSWORD"); v != "" {
		AppConfig.Redis.Password = v
	}
	if v := os.Getenv("REDIS_DB"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			AppConfig.Redis.DB = parsed
		}
	}
}
