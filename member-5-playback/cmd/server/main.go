package main

import (
	"context"
	"local.streaming/playback/internal/platform"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	mux := http.NewServeMux()
	service := platform.Env("SERVICE_NAME")
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) {
		platform.JSON(w, 200, map[string]string{"status": "ok", "service": service})
	})
	if service == "playback-session" {
		p := platform.NewPlayback()
		defer p.Redis.Close()
		defer p.Kafka.Close()
		p.Register(mux)
		go p.Run(ctx)
	} else if service == "watch-history" {
		h := platform.NewHistory()
		defer h.DB.Close()
		defer h.Kafka.Close()
		h.Register(mux)
		go h.Run(ctx, "playback.session.ended.v1")
		go h.Run(ctx, "profile.lifecycle.v1")
	} else {
		log.Fatal("Invalid SERVICE_NAME")
	}
	server := &http.Server{Addr: ":" + platform.Env("PORT"), Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		_ = server.Shutdown(shutdown)
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
