package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/openclaw/relay-server-go/internal/model"
)

type mockAdminSessionRepo struct {
	deleteExpiredCount int64
}

func (m *mockAdminSessionRepo) FindByTokenHash(ctx context.Context, tokenHash string) (*model.AdminSession, error) {
	return nil, nil
}

func (m *mockAdminSessionRepo) Create(ctx context.Context, params model.CreateAdminSessionParams) (*model.AdminSession, error) {
	return nil, nil
}

func (m *mockAdminSessionRepo) Delete(ctx context.Context, id string) error {
	return nil
}

func (m *mockAdminSessionRepo) DeleteByTokenHash(ctx context.Context, tokenHash string) error {
	return nil
}

func (m *mockAdminSessionRepo) DeleteExpired(ctx context.Context) (int64, error) {
	return m.deleteExpiredCount, nil
}

type mockPortalSessionRepo struct {
	deleteExpiredCount int64
}

func (m *mockPortalSessionRepo) FindByTokenHash(ctx context.Context, tokenHash string) (*model.PortalSession, error) {
	return nil, nil
}

func (m *mockPortalSessionRepo) Create(ctx context.Context, params model.CreatePortalSessionParams) (*model.PortalSession, error) {
	return nil, nil
}

func (m *mockPortalSessionRepo) Delete(ctx context.Context, id string) error {
	return nil
}

func (m *mockPortalSessionRepo) DeleteByUserID(ctx context.Context, userID string) error {
	return nil
}

func (m *mockPortalSessionRepo) DeleteExpired(ctx context.Context) (int64, error) {
	return m.deleteExpiredCount, nil
}

type mockPairingCodeRepo struct {
	deleteExpiredCount int64
}

func (m *mockPairingCodeRepo) FindByCode(ctx context.Context, code string) (*model.PairingCode, error) {
	return nil, nil
}

func (m *mockPairingCodeRepo) FindActiveByAccountID(ctx context.Context, accountID string) ([]model.PairingCode, error) {
	return nil, nil
}

func (m *mockPairingCodeRepo) CountActiveByAccountID(ctx context.Context, accountID string) (int, error) {
	return 0, nil
}

func (m *mockPairingCodeRepo) Create(ctx context.Context, params model.CreatePairingCodeParams) (*model.PairingCode, error) {
	return nil, nil
}

func (m *mockPairingCodeRepo) MarkUsed(ctx context.Context, code string, usedBy string) error {
	return nil
}

func (m *mockPairingCodeRepo) DeleteExpired(ctx context.Context) (int64, error) {
	return m.deleteExpiredCount, nil
}

type mockInboundMsgRepo struct {
	markExpiredCount int64
}

func (m *mockInboundMsgRepo) FindByID(ctx context.Context, id string) (*model.InboundMessage, error) {
	return nil, nil
}

func (m *mockInboundMsgRepo) FindQueuedByAccountID(ctx context.Context, accountID string) ([]model.InboundMessage, error) {
	return nil, nil
}

func (m *mockInboundMsgRepo) FindByAccountID(ctx context.Context, accountID string, limit, offset int) ([]model.InboundMessage, error) {
	return nil, nil
}

func (m *mockInboundMsgRepo) Create(ctx context.Context, params model.CreateInboundMessageParams) (*model.InboundMessage, error) {
	return nil, nil
}

func (m *mockInboundMsgRepo) MarkDelivered(ctx context.Context, id string) error {
	return nil
}

func (m *mockInboundMsgRepo) MarkAcked(ctx context.Context, id string) error {
	return nil
}

func (m *mockInboundMsgRepo) MarkExpired(ctx context.Context) (int64, error) {
	return m.markExpiredCount, nil
}

func (m *mockInboundMsgRepo) CountByStatus(ctx context.Context, status model.InboundMessageStatus) (int, error) {
	return 0, nil
}

func TestCleanupJob(t *testing.T) {
	t.Run("creates job with correct interval", func(t *testing.T) {
		job := NewCleanupJob(nil, nil, nil, nil, 5*time.Minute)

		assert.NotNil(t, job)
		assert.Equal(t, 5*time.Minute, job.interval)
	})

	t.Run("starts and stops without panic", func(t *testing.T) {
		adminRepo := &mockAdminSessionRepo{}
		portalRepo := &mockPortalSessionRepo{}
		pairingRepo := &mockPairingCodeRepo{}
		msgRepo := &mockInboundMsgRepo{}

		job := NewCleanupJob(adminRepo, portalRepo, pairingRepo, msgRepo, 100*time.Millisecond)

		job.Start()
		time.Sleep(50 * time.Millisecond)
		job.Stop()
	})

	t.Run("runs cleanup on start", func(t *testing.T) {
		adminRepo := &mockAdminSessionRepo{deleteExpiredCount: 2}
		portalRepo := &mockPortalSessionRepo{deleteExpiredCount: 3}
		pairingRepo := &mockPairingCodeRepo{deleteExpiredCount: 1}
		msgRepo := &mockInboundMsgRepo{markExpiredCount: 5}

		job := NewCleanupJob(adminRepo, portalRepo, pairingRepo, msgRepo, 1*time.Hour)

		job.Start()
		time.Sleep(10 * time.Millisecond)
		job.Stop()
	})
}
