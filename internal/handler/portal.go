package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/middleware"
	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/service"
)

type PortalHandler struct {
	portalService  *service.PortalService
	pairingService *service.PairingService
	convService    *service.ConversationService
	msgService     *service.MessageService
	isProduction   bool
}

func NewPortalHandler(
	portalService *service.PortalService,
	pairingService *service.PairingService,
	convService *service.ConversationService,
	msgService *service.MessageService,
	isProduction bool,
) *PortalHandler {
	return &PortalHandler{
		portalService:  portalService,
		pairingService: pairingService,
		convService:    convService,
		msgService:     msgService,
		isProduction:   isProduction,
	}
}

func (h *PortalHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/api/logout", h.Logout)
	r.Get("/api/me", h.Me)
	r.Post("/api/pairing/generate", h.GeneratePairingCode)
	r.Get("/api/connections", h.ListConnections)
	r.Post("/api/connections/{conversationKey}/unpair", h.UnpairConnection)
	r.Patch("/api/connections/{conversationKey}/block", h.BlockConnection)
	r.Get("/api/token", h.GetToken)
	r.Post("/api/token/regenerate", h.RegenerateToken)
	r.Delete("/api/account", h.DeleteAccount)
	r.Get("/api/messages", h.GetMessages)

	return r
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
		formatted[i] = formatConversation(conv)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"connections": formatted,
		"total":       len(conversations),
	})
}

func (h *PortalHandler) getSessionUser(r *http.Request) *model.PortalUser {
	cookie, err := r.Cookie(middleware.PortalSessionCookie)
	if err != nil || cookie.Value == "" {
		return nil
	}

	user, err := h.portalService.ValidateSession(r.Context(), cookie.Value)
	if err != nil {
		return nil
	}
	return user
}

func (h *PortalHandler) UnpairConnection(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	conversationKey := chi.URLParam(r, "conversationKey")
	if conversationKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Conversation key is required"})
		return
	}

	conv, err := h.convService.FindByKey(r.Context(), conversationKey)
	if err != nil {
		log.Error().Err(err).Msg("failed to find conversation")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}
	if conv == nil || conv.AccountID == nil || *conv.AccountID != user.AccountID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Connection not found"})
		return
	}

	if err := h.convService.Unpair(r.Context(), conversationKey); err != nil {
		log.Error().Err(err).Msg("failed to unpair connection")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to unpair connection"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *PortalHandler) BlockConnection(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	conversationKey := chi.URLParam(r, "conversationKey")
	if conversationKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Conversation key is required"})
		return
	}

	conv, err := h.convService.FindByKey(r.Context(), conversationKey)
	if err != nil {
		log.Error().Err(err).Msg("failed to find conversation")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}
	if conv == nil || conv.AccountID == nil || *conv.AccountID != user.AccountID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Connection not found"})
		return
	}

	var newState model.PairingState
	if conv.State == model.PairingStateBlocked {
		newState = model.PairingStatePaired
	} else {
		newState = model.PairingStateBlocked
	}

	if err := h.convService.UpdateState(r.Context(), conversationKey, newState, &user.AccountID); err != nil {
		log.Error().Err(err).Msg("failed to update connection state")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update connection state"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"state":   string(newState),
	})
}

func (h *PortalHandler) GetToken(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	account, err := h.portalService.GetAccountByID(r.Context(), user.AccountID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get account")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}
	if account == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Account not found"})
		return
	}

	var token string
	if account.RelayToken != nil {
		token = *account.RelayToken
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"token":     token,
		"createdAt": account.CreatedAt.Format(time.RFC3339),
	})
}

func (h *PortalHandler) RegenerateToken(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	account, newToken, err := h.portalService.RegenerateToken(r.Context(), user.AccountID)
	if err != nil {
		log.Error().Err(err).Msg("failed to regenerate token")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to regenerate token"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"token":     newToken,
		"createdAt": account.UpdatedAt.Format(time.RFC3339),
	})
}

func (h *PortalHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	var req struct {
		Confirm string `json:"confirm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if req.Confirm != "DELETE" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Please confirm deletion by sending {\"confirm\": \"DELETE\"}"})
		return
	}

	if err := h.portalService.DeleteAccount(r.Context(), user.ID); err != nil {
		log.Error().Err(err).Msg("failed to delete account")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to delete account"})
		return
	}

	middleware.ClearSessionCookie(w, middleware.PortalSessionCookie, "/portal")
	w.WriteHeader(http.StatusNoContent)
}

func (h *PortalHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	msgType := r.URL.Query().Get("type")
	if msgType != "" && msgType != "inbound" && msgType != "outbound" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid type parameter"})
		return
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := parseIntParam(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := parseIntParam(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	result, err := h.msgService.GetMessageHistory(r.Context(), service.MessageHistoryParams{
		AccountID: user.AccountID,
		Type:      msgType,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		log.Error().Err(err).Msg("failed to get message history")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	messages := result.Messages
	if messages == nil {
		messages = []service.MessageHistoryItem{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"messages": messages,
		"total":    result.Total,
		"hasMore":  result.HasMore,
	})
}
