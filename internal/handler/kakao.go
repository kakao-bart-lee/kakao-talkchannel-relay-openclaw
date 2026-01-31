package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/service"
	"github.com/openclaw/relay-server-go/internal/sse"
)

type Command struct {
	Type string // PAIR, UNPAIR, STATUS, HELP
	Code string
}

func parseCommand(utterance string) *Command {
	trimmed := strings.TrimSpace(utterance)

	if strings.HasPrefix(trimmed, "/pair ") {
		code := strings.ToUpper(strings.TrimSpace(trimmed[6:]))
		if code != "" {
			return &Command{Type: "PAIR", Code: code}
		}
	}

	if trimmed == "/unpair" {
		return &Command{Type: "UNPAIR"}
	}

	if trimmed == "/status" {
		return &Command{Type: "STATUS"}
	}

	if trimmed == "/help" {
		return &Command{Type: "HELP"}
	}

	return nil
}

type KakaoHandler struct {
	convService    *service.ConversationService
	pairingService *service.PairingService
	messageService *service.MessageService
	broker         *sse.Broker
	callbackTTL    time.Duration
}

func NewKakaoHandler(
	convService *service.ConversationService,
	pairingService *service.PairingService,
	messageService *service.MessageService,
	broker *sse.Broker,
	callbackTTL time.Duration,
) *KakaoHandler {
	return &KakaoHandler{
		convService:    convService,
		pairingService: pairingService,
		messageService: messageService,
		broker:         broker,
		callbackTTL:    callbackTTL,
	}
}

func (h *KakaoHandler) Webhook(w http.ResponseWriter, r *http.Request) {
	var req KakaoWebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Warn().Err(err).Msg("invalid kakao webhook request")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	channelID := req.GetChannelID()
	userKey := req.GetPlusfriendUserKey()
	utterance := req.UserRequest.Utterance
	callbackURL := req.UserRequest.CallbackURL

	conversationKey := service.BuildConversationKey(channelID, userKey)

	log.Info().
		Str("conversationKey", conversationKey).
		Str("utterance", truncate(utterance, 50)).
		Bool("hasCallback", callbackURL != "").
		Msg("received kakao webhook")

	var callbackURLPtr *string
	var callbackExpiresAt *time.Time
	if callbackURL != "" {
		callbackURLPtr = &callbackURL
		expires := time.Now().Add(h.callbackTTL)
		callbackExpiresAt = &expires
	}

	ctx := r.Context()

	conv, err := h.convService.FindOrCreate(ctx, channelID, userKey, callbackURLPtr, callbackExpiresAt)
	if err != nil {
		log.Error().Err(err).Msg("failed to find or create conversation")
		writeJSON(w, http.StatusOK, NewCallbackResponse())
		return
	}

	cmd := parseCommand(utterance)
	if cmd != nil {
		response := h.handleCommand(r, cmd, conv, conversationKey)
		writeJSON(w, http.StatusOK, response)
		return
	}

	if conv.State != model.PairingStatePaired || conv.AccountID == nil {
		writeJSON(w, http.StatusOK, NewTextResponse(
			"OpenClaw에 연결되지 않았습니다.\n\n"+
				"연결하려면 봇 관리자에게 페어링 코드를 요청한 후:\n"+
				"/pair <코드>\n\n"+
				"를 입력해주세요.\n\n"+
				"도움말: /help",
		))
		return
	}

	normalizedMsg, _ := json.Marshal(map[string]string{
		"userId":    userKey,
		"text":      utterance,
		"channelId": channelID,
	})

	msg, err := h.messageService.CreateInbound(ctx, service.CreateInboundParams{
		AccountID:         *conv.AccountID,
		ConversationKey:   conversationKey,
		KakaoPayload:      req.ToJSON(),
		NormalizedMessage: normalizedMsg,
		CallbackURL:       callbackURLPtr,
		CallbackExpiresAt: callbackExpiresAt,
	})
	if err != nil {
		log.Error().Err(err).Msg("failed to create inbound message")
		writeJSON(w, http.StatusOK, NewCallbackResponse())
		return
	}

	eventData, _ := json.Marshal(map[string]any{
		"id":              msg.ID,
		"conversationKey": conversationKey,
		"message":         json.RawMessage(normalizedMsg),
		"createdAt":       msg.CreatedAt,
	})

	if err := h.broker.Publish(ctx, *conv.AccountID, sse.Event{
		Type: "message",
		Data: eventData,
	}); err != nil {
		log.Warn().Err(err).Msg("failed to publish message event")
	}

	writeJSON(w, http.StatusOK, NewCallbackResponse())
}

func (h *KakaoHandler) handleCommand(r *http.Request, cmd *Command, conv *model.ConversationMapping, conversationKey string) *KakaoResponse {
	ctx := r.Context()

	switch cmd.Type {
	case "PAIR":
		if cmd.Code == "" {
			return NewTextResponse("페어링 코드를 입력해주세요.\n\n예: /pair ABCD-1234")
		}

		if conv.State == model.PairingStatePaired {
			return NewTextResponse(
				"이미 OpenClaw에 연결되어 있습니다.\n\n" +
					"다른 봇에 연결하려면 먼저 /unpair 로 연결을 해제하세요.",
			)
		}

		result := h.pairingService.VerifyCode(ctx, cmd.Code, conversationKey)
		if !result.Success {
			errorMessages := map[string]string{
				"INVALID_CODE": "❌ 유효하지 않은 코드입니다.\n\n코드를 다시 확인하거나 관리자에게 새 코드를 요청하세요.",
				"EXPIRED_CODE": "⏰ 코드가 만료되었습니다.\n\n관리자에게 새 코드를 요청하세요.",
				"ALREADY_USED": "❌ 이미 사용된 코드입니다.\n\n관리자에게 새 코드를 요청하세요.",
			}
			msg := errorMessages[result.Error]
			if msg == "" {
				msg = "페어링에 실패했습니다."
			}
			return NewTextResponse(msg)
		}

		return NewTextResponse("✅ OpenClaw에 연결되었습니다!\n\n이제 자유롭게 대화를 시작하세요.")

	case "UNPAIR":
		if conv.State != model.PairingStatePaired {
			return NewTextResponse("연결된 OpenClaw가 없습니다.")
		}

		if err := h.pairingService.Unpair(ctx, conversationKey); err != nil {
			log.Error().Err(err).Msg("failed to unpair")
			return NewTextResponse("연결 해제에 실패했습니다. 다시 시도해주세요.")
		}

		return NewTextResponse("연결이 해제되었습니다.\n\n다시 연결하려면 /pair <코드>를 사용하세요.")

	case "STATUS":
		if conv.State == model.PairingStatePaired && conv.AccountID != nil {
			pairedAt := "알 수 없음"
			if conv.PairedAt != nil {
				pairedAt = conv.PairedAt.Format("2006-01-02 15:04:05")
			}
			return NewTextResponse("✅ 연결됨\n\n연결 시간: " + pairedAt)
		}
		return NewTextResponse("❌ 연결되지 않음\n\n/pair <코드>로 연결하세요.")

	case "HELP":
		return NewTextResponse(
			"📖 도움말\n\n" +
				"이 봇은 OpenClaw AI 에이전트와 연결하는 중계 서비스입니다.\n\n" +
				"명령어:\n" +
				"• /pair <코드> - OpenClaw에 연결\n" +
				"• /unpair - 연결 해제\n" +
				"• /status - 연결 상태 확인\n" +
				"• /help - 이 도움말\n\n" +
				"페어링 코드는 OpenClaw 관리자에게 요청하세요.",
		)

	default:
		return NewTextResponse("알 수 없는 명령어입니다. /help를 입력해 도움말을 확인하세요.")
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
