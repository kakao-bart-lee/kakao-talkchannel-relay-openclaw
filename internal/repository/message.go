package repository

import (
	"context"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/openclaw/relay-server-go/internal/model"
)

type InboundMessageRepository interface {
	FindByID(ctx context.Context, id string) (*model.InboundMessage, error)
	FindQueuedByAccountID(ctx context.Context, accountID string) ([]model.InboundMessage, error)
	FindByAccountID(ctx context.Context, accountID string, limit, offset int) ([]model.InboundMessage, error)
	CountByAccountID(ctx context.Context, accountID string) (int, error)
	Create(ctx context.Context, params model.CreateInboundMessageParams) (*model.InboundMessage, error)
	MarkDelivered(ctx context.Context, id string) error
	MarkAcked(ctx context.Context, id string) error
	MarkExpired(ctx context.Context) (int64, error)
	CountByStatus(ctx context.Context, status model.InboundMessageStatus) (int, error)
}

type inboundMessageRepo struct {
	db *sqlx.DB
}

func NewInboundMessageRepository(db *sqlx.DB) InboundMessageRepository {
	return &inboundMessageRepo{db: db}
}

func (r *inboundMessageRepo) FindByID(ctx context.Context, id string) (*model.InboundMessage, error) {
	var msg model.InboundMessage
	err := r.db.GetContext(ctx, &msg, `SELECT * FROM inbound_messages WHERE id = $1`, id)
	return HandleNotFound(&msg, err)
}

func (r *inboundMessageRepo) FindQueuedByAccountID(ctx context.Context, accountID string) ([]model.InboundMessage, error) {
	var msgs []model.InboundMessage
	err := r.db.SelectContext(ctx, &msgs, `
		SELECT * FROM inbound_messages
		WHERE account_id = $1 AND status = 'queued'
		ORDER BY created_at ASC
	`, accountID)
	return msgs, err
}

func (r *inboundMessageRepo) FindByAccountID(ctx context.Context, accountID string, limit, offset int) ([]model.InboundMessage, error) {
	var msgs []model.InboundMessage
	err := r.db.SelectContext(ctx, &msgs, `
		SELECT * FROM inbound_messages
		WHERE account_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, accountID, limit, offset)
	return msgs, err
}

func (r *inboundMessageRepo) CountByAccountID(ctx context.Context, accountID string) (int, error) {
	var count int
	err := r.db.GetContext(ctx, &count, `
		SELECT COUNT(*) FROM inbound_messages WHERE account_id = $1
	`, accountID)
	return count, err
}

func (r *inboundMessageRepo) Create(ctx context.Context, params model.CreateInboundMessageParams) (*model.InboundMessage, error) {
	var msg model.InboundMessage
	err := r.db.GetContext(ctx, &msg, `
		INSERT INTO inbound_messages
			(account_id, conversation_key, kakao_payload, normalized_message,
			 callback_url, callback_expires_at, source_event_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING *
	`, params.AccountID, params.ConversationKey, params.KakaoPayload,
		params.NormalizedMessage, params.CallbackURL, params.CallbackExpiresAt,
		params.SourceEventID)
	if err != nil {
		return nil, err
	}
	return &msg, nil
}

func (r *inboundMessageRepo) MarkDelivered(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE inbound_messages SET
			status = 'delivered',
			delivered_at = $2
		WHERE id = $1
	`, id, time.Now())
	return err
}

func (r *inboundMessageRepo) MarkAcked(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE inbound_messages SET
			status = 'acked',
			acked_at = $2
		WHERE id = $1
	`, id, time.Now())
	return err
}

func (r *inboundMessageRepo) MarkExpired(ctx context.Context) (int64, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE inbound_messages SET status = 'expired'
		WHERE status = 'queued'
		AND callback_expires_at IS NOT NULL
		AND callback_expires_at < NOW()
	`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (r *inboundMessageRepo) CountByStatus(ctx context.Context, status model.InboundMessageStatus) (int, error) {
	var count int
	err := r.db.GetContext(ctx, &count, `
		SELECT COUNT(*) FROM inbound_messages WHERE status = $1
	`, status)
	return count, err
}

// Outbound Message Repository

type OutboundMessageRepository interface {
	FindByID(ctx context.Context, id string) (*model.OutboundMessage, error)
	FindPendingByAccountID(ctx context.Context, accountID string) ([]model.OutboundMessage, error)
	FindByAccountID(ctx context.Context, accountID string, limit, offset int) ([]model.OutboundMessage, error)
	CountByAccountID(ctx context.Context, accountID string) (int, error)
	Create(ctx context.Context, params model.CreateOutboundMessageParams) (*model.OutboundMessage, error)
	MarkSent(ctx context.Context, id string) error
	MarkFailed(ctx context.Context, id string, errorMsg string) error
}

type outboundMessageRepo struct {
	db *sqlx.DB
}

func NewOutboundMessageRepository(db *sqlx.DB) OutboundMessageRepository {
	return &outboundMessageRepo{db: db}
}

func (r *outboundMessageRepo) FindByID(ctx context.Context, id string) (*model.OutboundMessage, error) {
	var msg model.OutboundMessage
	err := r.db.GetContext(ctx, &msg, `SELECT * FROM outbound_messages WHERE id = $1`, id)
	return HandleNotFound(&msg, err)
}

func (r *outboundMessageRepo) FindPendingByAccountID(ctx context.Context, accountID string) ([]model.OutboundMessage, error) {
	var msgs []model.OutboundMessage
	err := r.db.SelectContext(ctx, &msgs, `
		SELECT * FROM outbound_messages
		WHERE account_id = $1 AND status = 'pending'
		ORDER BY created_at ASC
	`, accountID)
	return msgs, err
}

func (r *outboundMessageRepo) FindByAccountID(ctx context.Context, accountID string, limit, offset int) ([]model.OutboundMessage, error) {
	var msgs []model.OutboundMessage
	err := r.db.SelectContext(ctx, &msgs, `
		SELECT * FROM outbound_messages
		WHERE account_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, accountID, limit, offset)
	return msgs, err
}

func (r *outboundMessageRepo) CountByAccountID(ctx context.Context, accountID string) (int, error) {
	var count int
	err := r.db.GetContext(ctx, &count, `
		SELECT COUNT(*) FROM outbound_messages WHERE account_id = $1
	`, accountID)
	return count, err
}

func (r *outboundMessageRepo) Create(ctx context.Context, params model.CreateOutboundMessageParams) (*model.OutboundMessage, error) {
	var msg model.OutboundMessage
	err := r.db.GetContext(ctx, &msg, `
		INSERT INTO outbound_messages
			(account_id, inbound_message_id, conversation_key, kakao_target, response_payload)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING *
	`, params.AccountID, params.InboundMessageID, params.ConversationKey,
		params.KakaoTarget, params.ResponsePayload)
	if err != nil {
		return nil, err
	}
	return &msg, nil
}

func (r *outboundMessageRepo) MarkSent(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE outbound_messages SET
			status = 'sent',
			sent_at = $2
		WHERE id = $1
	`, id, time.Now())
	return err
}

func (r *outboundMessageRepo) MarkFailed(ctx context.Context, id string, errorMsg string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE outbound_messages SET
			status = 'failed',
			error_message = $2
		WHERE id = $1
	`, id, errorMsg)
	return err
}
