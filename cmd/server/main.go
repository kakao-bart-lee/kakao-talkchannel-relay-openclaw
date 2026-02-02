package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/config"
	"github.com/openclaw/relay-server-go/internal/database"
	"github.com/openclaw/relay-server-go/internal/handler"
	"github.com/openclaw/relay-server-go/internal/jobs"
	"github.com/openclaw/relay-server-go/internal/middleware"
	"github.com/openclaw/relay-server-go/internal/redis"
	"github.com/openclaw/relay-server-go/internal/repository"
	"github.com/openclaw/relay-server-go/internal/service"
	"github.com/openclaw/relay-server-go/internal/sse"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}

	setLogLevel(cfg.LogLevel)

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := db.Ping(ctx); err != nil {
		log.Fatal().Err(err).Msg("failed to ping database")
	}
	cancel()
	log.Info().Msg("database connected")

	redisClient, err := redis.NewClient(cfg.RedisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to redis")
	}
	defer redisClient.Close()
	log.Info().Msg("redis connected")

	accountRepo := repository.NewAccountRepository(db.DB)
	convRepo := repository.NewConversationRepository(db.DB)
	pairingCodeRepo := repository.NewPairingCodeRepository(db.DB)
	portalUserRepo := repository.NewPortalUserRepository(db.DB)
	portalSessionRepo := repository.NewPortalSessionRepository(db.DB)
	adminSessionRepo := repository.NewAdminSessionRepository(db.DB)
	inboundMsgRepo := repository.NewInboundMessageRepository(db.DB)
	outboundMsgRepo := repository.NewOutboundMessageRepository(db.DB)
	oauthAccountRepo := repository.NewOAuthAccountRepository(db.DB)
	oauthStateRepo := repository.NewOAuthStateRepository(db.DB)
	sessionRepo := repository.NewSessionRepository(db.DB)

	broker := sse.NewBroker(redisClient)
	defer broker.Close()

	convService := service.NewConversationService(convRepo)
	pairingService := service.NewPairingService(pairingCodeRepo, convRepo)
	messageService := service.NewMessageService(inboundMsgRepo, outboundMsgRepo)
	kakaoService := service.NewKakaoService()
	adminService := service.NewAdminService(
		db.DB, adminSessionRepo, accountRepo, convRepo,
		inboundMsgRepo, outboundMsgRepo, portalUserRepo, sessionRepo,
		cfg.AdminPassword, cfg.AdminSessionSecret,
	)
	portalService := service.NewPortalService(
		portalUserRepo, portalSessionRepo, accountRepo,
		cfg.PortalSessionSecret,
	)
	oauthService := service.NewOAuthService(
		cfg, portalUserRepo, oauthAccountRepo, oauthStateRepo,
		portalSessionRepo, accountRepo, portalService,
	)
	sessionService := service.NewSessionService(db, sessionRepo, accountRepo, broker)

	authMiddleware := middleware.NewAuthMiddleware(accountRepo, sessionRepo)
	rateLimitMiddleware := middleware.NewRateLimitMiddleware()
	adminSessionMiddleware := middleware.NewAdminSessionMiddleware(
		adminSessionRepo, cfg.AdminPassword, cfg.AdminSessionSecret,
	)
	kakaoSignatureMiddleware := middleware.NewKakaoSignatureMiddleware(cfg.KakaoSignatureSecret)

	isProduction := os.Getenv("FLY_APP_NAME") != ""

	kakaoHandler := handler.NewKakaoHandler(
		convService, sessionService, messageService, broker, cfg.CallbackTTL(),
	)
	eventsHandler := handler.NewEventsHandler(broker, messageService)
	openclawHandler := handler.NewOpenClawHandler(messageService, kakaoService)
	adminHandler := handler.NewAdminHandler(adminService, adminSessionMiddleware.Handler, isProduction)
	portalHandler := handler.NewPortalHandler(
		portalService, pairingService, convService, messageService, isProduction,
	)
	oauthHandler := handler.NewOAuthHandler(oauthService, portalService, isProduction)
	sessionHandler := handler.NewSessionHandler(sessionService)

	r := chi.NewRouter()

	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(middleware.RequestLogger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(60 * time.Second))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"status":    "ok",
			"timestamp": time.Now().UnixMilli(),
		})
	})

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/portal/", http.StatusFound)
	})

	r.Route("/kakao-talkchannel", func(r chi.Router) {
		r.Use(kakaoSignatureMiddleware.Handler)
		r.Post("/webhook", kakaoHandler.Webhook)
	})

	r.Route("/v1", func(r chi.Router) {
		r.Use(authMiddleware.Handler)
		r.Use(rateLimitMiddleware.Handler)
		r.Get("/events", eventsHandler.ServeHTTP)
	})

	r.Route("/openclaw", func(r chi.Router) {
		r.Use(authMiddleware.Handler)
		r.Use(rateLimitMiddleware.Handler)
		r.Mount("/", openclawHandler.Routes())
	})

	r.Route("/v1/sessions", func(r chi.Router) {
		r.Mount("/", sessionHandler.Routes())
	})

	r.Route("/admin", func(r chi.Router) {
		r.Mount("/", adminHandler.Routes())
		r.NotFound(handler.StaticFileServer("static/admin", "/admin").ServeHTTP)
	})

	r.Route("/portal", func(r chi.Router) {
		r.Mount("/", portalHandler.Routes())
		r.Mount("/api/oauth", oauthHandler.Routes())
		r.NotFound(handler.StaticFileServer("static/portal", "/portal").ServeHTTP)
	})

	cleanupJob := jobs.NewCleanupJob(
		adminSessionRepo, portalSessionRepo, pairingCodeRepo, inboundMsgRepo,
		oauthStateRepo, sessionRepo, 5*time.Minute,
	)
	cleanupJob.Start()
	defer cleanupJob.Stop()

	server := &http.Server{
		Addr:         cfg.Addr(),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Info().Str("addr", cfg.Addr()).Msg("starting server")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info().Msg("shutting down server")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("server forced to shutdown")
	}

	log.Info().Msg("server stopped")
}

func setLogLevel(level string) {
	switch level {
	case "debug":
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	case "info":
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	case "warn":
		zerolog.SetGlobalLevel(zerolog.WarnLevel)
	case "error":
		zerolog.SetGlobalLevel(zerolog.ErrorLevel)
	default:
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	}
}
