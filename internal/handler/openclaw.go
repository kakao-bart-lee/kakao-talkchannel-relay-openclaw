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

type OpenClawHandler struct {
	messageService *service.MessageService
	pairingService *service.PairingService
	convService    *service.ConversationService
	kakaoService   *service.KakaoService
}

func NewOpenClawHandler(
	messageService *service.MessageService,
	pairingService *service.PairingService,
	convService *service.ConversationService,
	kakaoService *service.KakaoService,
) *OpenClawHandler {
	return &OpenClawHandler{
		messageService: messageService,
		pairingService: pairingService,
		convService:    convService,
		kakaoService:   kakaoService,
	}
}

func (h *OpenClawHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/reply", h.Reply)
	r.Post("/pairing/generate", h.GeneratePairingCode)
	r.Get("/pairing/list", h.ListPairedConversations)
	r.Post("/pairing/unpair", h.Unpair)
	r.Post("/messages/ack", h.AckMessages)

	return r
}

// POST /v1/reply
func (h *OpenClawHandler) Reply(w http.ResponseWriter, r *http.Request) {
	account := middleware.GetAccount(r.Context())
	if account == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	var req struct {
		MessageID string          `json:"messageId"`
		Response  json.RawMessage `json:"response"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if req.MessageID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "messageId is required"})
		return
	}

	ctx := r.Context()

	inbound, err := h.messageService.FindInboundByID(ctx, req.MessageID)
	if err != nil {
		log.Error().Err(err).Msg("failed to find inbound message")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	if inbound == nil || inbound.AccountID != account.ID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Message not found"})
		return
	}

	hasValidCallback := inbound.CallbackURL != nil &&
		(inbound.CallbackExpiresAt == nil || inbound.CallbackExpiresAt.After(time.Now()))

	if !hasValidCallback {
		log.Warn().
			Str("messageId", req.MessageID).
			Bool("hasCallbackUrl", inbound.CallbackURL != nil).
			Msg("no valid callback URL for reply")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Callback URL expired or not available"})
		return
	}

	outbound, err := h.messageService.CreateOutbound(ctx, model.CreateOutboundMessageParams{
		AccountID:        account.ID,
		InboundMessageID: &req.MessageID,
		ConversationKey:  inbound.ConversationKey,
		KakaoTarget:      json.RawMessage("{}"),
		ResponsePayload:  req.Response,
	})
	if err != nil {
		log.Error().Err(err).Msg("failed to create outbound message")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	var responsePayload any
	json.Unmarshal(req.Response, &responsePayload)

	if err := h.kakaoService.SendCallback(ctx, *inbound.CallbackURL, responsePayload); err != nil {
		h.messageService.MarkOutboundFailed(ctx, outbound.ID, err.Error())
		log.Error().
			Err(err).
			Str("outboundId", outbound.ID).
			Str("messageId", req.MessageID).
			Msg("failed to send callback to Kakao")
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"success":           false,
			"outboundMessageId": outbound.ID,
			"error":             "Failed to send callback to Kakao",
		})
		return
	}

	h.messageService.MarkOutboundSent(ctx, outbound.ID)

	log.Info().
		Str("outboundId", outbound.ID).
		Str("messageId", req.MessageID).
		Str("accountId", account.ID).
		Msg("reply sent to Kakao")

	writeJSON(w, http.StatusOK, map[string]any{
		"success":           true,
		"outboundMessageId": outbound.ID,
		"callbackSent":      true,
	})
}

// POST /v1/pairing/generate
func (h *OpenClawHandler) GeneratePairingCode(w http.ResponseWriter, r *http.Request) {
	account := middleware.GetAccount(r.Context())
	if account == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	var req struct {
		ExpirySeconds int            `json:"expirySeconds"`
		Metadata      map[string]any `json:"metadata"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	ctx := r.Context()

	code, err := h.pairingService.GenerateCode(ctx, account.ID, req.ExpirySeconds, req.Metadata)
	if err != nil {
		log.Error().Err(err).Str("accountId", account.ID).Msg("failed to generate pairing code")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"code":      code.Code,
		"expiresAt": code.ExpiresAt.Format(time.RFC3339),
	})
}

// GET /v1/pairing/list
func (h *OpenClawHandler) ListPairedConversations(w http.ResponseWriter, r *http.Request) {
	account := middleware.GetAccount(r.Context())
	if account == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	ctx := r.Context()

	conversations, err := h.convService.ListByAccountID(ctx, account.ID)
	if err != nil {
		log.Error().Err(err).Str("accountId", account.ID).Msg("failed to list conversations")
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
		"conversations": formatted,
		"total":         len(conversations),
	})
}

// POST /v1/pairing/unpair
func (h *OpenClawHandler) Unpair(w http.ResponseWriter, r *http.Request) {
	account := middleware.GetAccount(r.Context())
	if account == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	var req struct {
		ConversationKey string `json:"conversationKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ConversationKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversationKey is required"})
		return
	}

	ctx := r.Context()

	if err := h.pairingService.Unpair(ctx, req.ConversationKey); err != nil {
		log.Error().Err(err).Str("conversationKey", req.ConversationKey).Msg("failed to unpair")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	log.Info().
		Str("conversationKey", req.ConversationKey).
		Str("accountId", account.ID).
		Msg("conversation unpaired")

	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// POST /v1/messages/ack
func (h *OpenClawHandler) AckMessages(w http.ResponseWriter, r *http.Request) {
	account := middleware.GetAccount(r.Context())
	if account == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	var req struct {
		MessageIDs []string `json:"messageIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.MessageIDs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "messageIds is required"})
		return
	}

	ctx := r.Context()
	acked := 0

	for _, id := range req.MessageIDs {
		if err := h.messageService.MarkAcked(ctx, id); err == nil {
			acked++
		}
	}

	log.Info().
		Str("accountId", account.ID).
		Int("requested", len(req.MessageIDs)).
		Int("acknowledged", acked).
		Msg("messages acknowledged")

	writeJSON(w, http.StatusOK, map[string]any{
		"acknowledged": acked,
		"requested":    len(req.MessageIDs),
	})
}

func formatTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Format(time.RFC3339)
}
