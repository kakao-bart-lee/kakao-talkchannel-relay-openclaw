package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/middleware"
	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/service"
)

type AdminHandler struct {
	adminService      *service.AdminService
	sessionMiddleware func(http.Handler) http.Handler
	isProduction      bool
}

func NewAdminHandler(
	adminService *service.AdminService,
	sessionMiddleware func(http.Handler) http.Handler,
	isProduction bool,
) *AdminHandler {
	return &AdminHandler{
		adminService:      adminService,
		sessionMiddleware: sessionMiddleware,
		isProduction:      isProduction,
	}
}

func (h *AdminHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/api/login", h.Login)
	r.Post("/api/logout", h.Logout)

	r.Group(func(r chi.Router) {
		r.Use(h.sessionMiddleware)
		r.Get("/api/stats", h.Stats)
		r.Get("/api/accounts", h.ListAccounts)
		r.Post("/api/accounts", h.CreateAccount)
		r.Get("/api/accounts/{id}", h.GetAccount)
		r.Delete("/api/accounts/{id}", h.DeleteAccount)
		r.Post("/api/accounts/{id}/regenerate-token", h.RegenerateToken)
	})

	return r
}

func (h *AdminHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password is required"})
		return
	}

	token, err := h.adminService.Login(r.Context(), req.Password)
	if err != nil {
		log.Error().Err(err).Msg("admin login error")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Login failed"})
		return
	}

	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid password"})
		return
	}

	middleware.SetSessionCookie(w, middleware.AdminSessionCookie, token, "/admin", h.isProduction)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *AdminHandler) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(middleware.AdminSessionCookie)
	if err == nil && cookie.Value != "" {
		h.adminService.Logout(r.Context(), cookie.Value)
	}

	middleware.ClearSessionCookie(w, middleware.AdminSessionCookie, "/admin")
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *AdminHandler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.adminService.GetStats(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get stats")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	writeJSON(w, http.StatusOK, stats)
}

func (h *AdminHandler) ListAccounts(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	if limit <= 0 || limit > 100 {
		limit = 50
	}

	accounts, err := h.adminService.GetAccounts(r.Context(), limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list accounts")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"data": accounts,
		"pagination": map[string]int{
			"limit":  limit,
			"offset": offset,
		},
	})
}

func (h *AdminHandler) CreateAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OpenclawUserID     *string `json:"openclawUserId"`
		Mode               string  `json:"mode"`
		RateLimitPerMinute int     `json:"rateLimitPerMinute"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	mode := model.AccountModeRelay
	if req.Mode == "direct" {
		mode = model.AccountModeDirect
	}

	rateLimit := req.RateLimitPerMinute
	if rateLimit <= 0 {
		rateLimit = 60
	}

	account, token, err := h.adminService.CreateAccount(r.Context(), req.OpenclawUserID, mode, rateLimit)
	if err != nil {
		log.Error().Err(err).Msg("failed to create account")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":                 account.ID,
		"openclawUserId":     account.OpenclawUserID,
		"mode":               account.Mode,
		"rateLimitPerMinute": account.RateLimitPerMin,
		"createdAt":          account.CreatedAt,
		"relayToken":         token,
	})
}

func (h *AdminHandler) GetAccount(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	account, err := h.adminService.GetAccountByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Msg("failed to get account")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	if account == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Account not found"})
		return
	}

	writeJSON(w, http.StatusOK, account)
}

func (h *AdminHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := h.adminService.DeleteAccount(r.Context(), id); err != nil {
		log.Error().Err(err).Msg("failed to delete account")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *AdminHandler) RegenerateToken(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	token, err := h.adminService.RegenerateToken(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Msg("failed to regenerate token")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"relayToken": token})
}
