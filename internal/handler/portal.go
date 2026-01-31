package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/middleware"
	"github.com/openclaw/relay-server-go/internal/service"
)

type PortalHandler struct {
	portalService  *service.PortalService
	pairingService *service.PairingService
	convService    *service.ConversationService
	isProduction   bool
}

func NewPortalHandler(
	portalService *service.PortalService,
	pairingService *service.PairingService,
	convService *service.ConversationService,
	isProduction bool,
) *PortalHandler {
	return &PortalHandler{
		portalService:  portalService,
		pairingService: pairingService,
		convService:    convService,
		isProduction:   isProduction,
	}
}

func (h *PortalHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/api/signup", h.Signup)
	r.Post("/api/login", h.Login)
	r.Post("/api/logout", h.Logout)
	r.Get("/api/me", h.Me)
	r.Post("/api/pairing/generate", h.GeneratePairingCode)
	r.Get("/api/connections", h.ListConnections)

	return r
}

func (h *PortalHandler) Signup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if req.Email == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Email and password are required"})
		return
	}

	if len(req.Password) < 6 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Password must be at least 6 characters"})
		return
	}

	user, token, err := h.portalService.Signup(r.Context(), req.Email, req.Password)
	if err != nil {
		if err == service.ErrEmailExists {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Email already exists"})
			return
		}
		log.Error().Err(err).Msg("signup failed")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Signup failed"})
		return
	}

	middleware.SetSessionCookie(w, middleware.PortalSessionCookie, token, "/portal", h.isProduction)
	writeJSON(w, http.StatusCreated, map[string]any{
		"success": true,
		"user": map[string]string{
			"id":    user.ID,
			"email": user.Email,
		},
	})
}

func (h *PortalHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	user, token, err := h.portalService.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		if err == service.ErrInvalidCredentials {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid email or password"})
			return
		}
		log.Error().Err(err).Msg("login failed")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Login failed"})
		return
	}

	middleware.SetSessionCookie(w, middleware.PortalSessionCookie, token, "/portal", h.isProduction)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"user": map[string]string{
			"id":    user.ID,
			"email": user.Email,
		},
	})
}

func (h *PortalHandler) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(middleware.PortalSessionCookie)
	if err == nil && cookie.Value != "" {
		h.portalService.Logout(r.Context(), cookie.Value)
	}

	middleware.ClearSessionCookie(w, middleware.PortalSessionCookie, "/portal")
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *PortalHandler) Me(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":        user.ID,
			"email":     user.Email,
			"accountId": user.AccountID,
			"createdAt": user.CreatedAt.Format(time.RFC3339),
		},
	})
}

func (h *PortalHandler) GeneratePairingCode(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	var req struct {
		ExpirySeconds int `json:"expirySeconds"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	code, err := h.pairingService.GenerateCode(r.Context(), user.AccountID, req.ExpirySeconds, nil)
	if err != nil {
		log.Error().Err(err).Msg("failed to generate pairing code")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"code":      code.Code,
		"expiresAt": code.ExpiresAt.Format(time.RFC3339),
	})
}

func (h *PortalHandler) ListConnections(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	conversations, err := h.convService.ListByAccountID(r.Context(), user.AccountID)
	if err != nil {
		log.Error().Err(err).Msg("failed to list connections")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	formatted := make([]map[string]any, len(conversations))
	for i, conv := range conversations {
		formatted[i] = map[string]any{
			"conversationKey": conv.ConversationKey,
			"state":           conv.State,
			"pairedAt":        formatTime(conv.PairedAt),
			"lastSeenAt":      conv.LastSeenAt.Format(time.RFC3339),
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"connections": formatted,
		"total":       len(conversations),
	})
}

func (h *PortalHandler) getSessionUser(r *http.Request) *portalUser {
	cookie, err := r.Cookie(middleware.PortalSessionCookie)
	if err != nil || cookie.Value == "" {
		return nil
	}

	user, err := h.portalService.ValidateSession(r.Context(), cookie.Value)
	if err != nil || user == nil {
		return nil
	}

	return &portalUser{
		ID:        user.ID,
		Email:     user.Email,
		AccountID: user.AccountID,
		CreatedAt: user.CreatedAt,
	}
}

type portalUser struct {
	ID        string
	Email     string
	AccountID string
	CreatedAt time.Time
}
