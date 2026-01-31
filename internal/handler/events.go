package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/middleware"
	"github.com/openclaw/relay-server-go/internal/service"
	"github.com/openclaw/relay-server-go/internal/sse"
)

type EventsHandler struct {
	broker         *sse.Broker
	messageService *service.MessageService
}

func NewEventsHandler(broker *sse.Broker, messageService *service.MessageService) *EventsHandler {
	return &EventsHandler{
		broker:         broker,
		messageService: messageService,
	}
}

func (h *EventsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	account := middleware.GetAccount(r.Context())
	if account == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Streaming not supported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	client := h.broker.Subscribe(account.ID)
	defer h.broker.Unsubscribe(client)

	log.Info().
		Str("accountId", account.ID).
		Msg("sse connection established")

	ctx := r.Context()

	if err := h.sendQueuedMessages(w, flusher, account.ID); err != nil {
		log.Error().Err(err).Msg("failed to send queued messages")
	}

	h.sendEvent(w, flusher, "connected", map[string]string{
		"accountId": account.ID,
		"message":   "SSE connection established",
	})

	heartbeat := time.NewTicker(sse.HeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().
				Str("accountId", account.ID).
				Msg("sse connection closed by client")
			return

		case <-client.Done:
			log.Info().
				Str("accountId", account.ID).
				Msg("sse connection closed by broker")
			return

		case event := <-client.Events:
			if err := h.sendRawEvent(w, flusher, event); err != nil {
				log.Error().Err(err).Msg("failed to send event")
				return
			}

		case <-heartbeat.C:
			if _, err := fmt.Fprintf(w, ": ping\n\n"); err != nil {
				log.Debug().
					Str("accountId", account.ID).
					Msg("heartbeat failed, closing connection")
				return
			}
			flusher.Flush()
		}
	}
}

func (h *EventsHandler) sendQueuedMessages(w http.ResponseWriter, flusher http.Flusher, accountID string) error {
	messages, err := h.messageService.FindQueuedByAccountID(context.Background(), accountID)
	if err != nil {
		return err
	}

	for _, msg := range messages {
		data, _ := json.Marshal(map[string]any{
			"id":              msg.ID,
			"conversationKey": msg.ConversationKey,
			"message":         msg.NormalizedMessage,
			"createdAt":       msg.CreatedAt,
		})

		event := sse.Event{
			Type: "message",
			Data: data,
		}

		if err := h.sendRawEvent(w, flusher, event); err != nil {
			return err
		}

		if err := h.messageService.MarkDelivered(context.Background(), msg.ID); err != nil {
			log.Warn().Err(err).Str("messageId", msg.ID).Msg("failed to mark message as delivered")
		}
	}

	if len(messages) > 0 {
		log.Info().
			Str("accountId", accountID).
			Int("count", len(messages)).
			Msg("sent queued messages")
	}

	return nil
}

func (h *EventsHandler) sendEvent(w http.ResponseWriter, flusher http.Flusher, eventType string, data any) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	return h.sendRawEvent(w, flusher, sse.Event{Type: eventType, Data: jsonData})
}

func (h *EventsHandler) sendRawEvent(w http.ResponseWriter, flusher http.Flusher, event sse.Event) error {
	if _, err := fmt.Fprintf(w, "event: %s\n", event.Type); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", event.Data); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

