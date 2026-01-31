package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/repository"
)

type CreateInboundParams struct {
	AccountID         string
	ConversationKey   string
	KakaoPayload      json.RawMessage
	NormalizedMessage json.RawMessage
	CallbackURL       *string
	CallbackExpiresAt *time.Time
	SourceEventID     *string
}

type MessageService struct {
	inboundRepo  repository.InboundMessageRepository
	outboundRepo repository.OutboundMessageRepository
}

func NewMessageService(
	inboundRepo repository.InboundMessageRepository,
	outboundRepo repository.OutboundMessageRepository,
) *MessageService {
	return &MessageService{
		inboundRepo:  inboundRepo,
		outboundRepo: outboundRepo,
	}
}

func (s *MessageService) CreateInbound(ctx context.Context, params CreateInboundParams) (*model.InboundMessage, error) {
	msg, err := s.inboundRepo.Create(ctx, model.CreateInboundMessageParams{
		AccountID:         params.AccountID,
		ConversationKey:   params.ConversationKey,
		KakaoPayload:      params.KakaoPayload,
		NormalizedMessage: params.NormalizedMessage,
		CallbackURL:       params.CallbackURL,
		CallbackExpiresAt: params.CallbackExpiresAt,
		SourceEventID:     params.SourceEventID,
	})
	if err != nil {
		return nil, fmt.Errorf("create inbound message: %w", err)
	}

	log.Info().
		Str("messageId", msg.ID).
		Str("accountId", params.AccountID).
		Str("conversationKey", params.ConversationKey).
		Msg("inbound message created")

	return msg, nil
}

func (s *MessageService) FindInboundByID(ctx context.Context, id string) (*model.InboundMessage, error) {
	return s.inboundRepo.FindByID(ctx, id)
}

func (s *MessageService) FindQueuedByAccountID(ctx context.Context, accountID string) ([]model.InboundMessage, error) {
	return s.inboundRepo.FindQueuedByAccountID(ctx, accountID)
}

func (s *MessageService) MarkDelivered(ctx context.Context, id string) error {
	if err := s.inboundRepo.MarkDelivered(ctx, id); err != nil {
		return fmt.Errorf("mark delivered: %w", err)
	}
	log.Debug().Str("messageId", id).Msg("message marked as delivered")
	return nil
}

func (s *MessageService) MarkAcked(ctx context.Context, id string) error {
	if err := s.inboundRepo.MarkAcked(ctx, id); err != nil {
		return fmt.Errorf("mark acked: %w", err)
	}
	log.Debug().Str("messageId", id).Msg("message marked as acked")
	return nil
}

func (s *MessageService) CreateOutbound(ctx context.Context, params model.CreateOutboundMessageParams) (*model.OutboundMessage, error) {
	msg, err := s.outboundRepo.Create(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("create outbound message: %w", err)
	}

	log.Info().
		Str("messageId", msg.ID).
		Str("accountId", params.AccountID).
		Str("conversationKey", params.ConversationKey).
		Msg("outbound message created")

	return msg, nil
}

func (s *MessageService) MarkOutboundSent(ctx context.Context, id string) error {
	return s.outboundRepo.MarkSent(ctx, id)
}

func (s *MessageService) MarkOutboundFailed(ctx context.Context, id, errorMsg string) error {
	return s.outboundRepo.MarkFailed(ctx, id, errorMsg)
}
