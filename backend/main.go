package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/JerryLinyx/FinGOAT/config"
	"github.com/JerryLinyx/FinGOAT/controllers"
	"github.com/JerryLinyx/FinGOAT/router"
)

func main() {
	config.InitConfig()

	// Run database migrations
	config.MigrateDB()

	r := router.InitRouter()
	port := config.AppConfig.App.Port
	if port == "" {
		port = "8080"
	}
	srv := &http.Server{
		Addr:    port,
		Handler: r,
	}

	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	defer lifecycleCancel()
	controllers.StartFeedScheduler(lifecycleCtx)

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit
	log.Println("Shutdown Server ...")
	lifecycleCancel()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server Shutdown:", err)
	}
	log.Println("Server exiting")
}
