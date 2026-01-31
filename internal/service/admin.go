package service

import (
	"context"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/repository"
	"github.com/openclaw/relay-server-go/internal/util"
)

type AdminService struct {
	db              *sqlx.DB
	sessionRepo     repository.AdminSessionRepository
	accountRepo     repository.AccountRepository
	convRepo        repository.ConversationRepository
	inboundRepo     repository.InboundMessageRepository
	outboundRepo    repository.OutboundMessageRepository
	adminPassword   string
	sessionSecret   string
}

func NewAdminService(
	db *sqlx.DB,
	sessionRepo repository.AdminSessionRepository,
	accountRepo repository.AccountRepository,
	convRepo repository.ConversationRepository,
	inboundRepo repository.InboundMessageRepository,
	outboundRepo repository.OutboundMessageRepository,
	adminPassword, sessionSecret string,
) *AdminService {
	return &AdminService{
		db:            db,
		sessionRepo:   sessionRepo,
		accountRepo:   accountRepo,
		convRepo:      convRepo,
		inboundRepo:   inboundRepo,
		outboundRepo:  outboundRepo,
		adminPassword: adminPassword,
		sessionSecret: sessionSecret,
	}
}

func (s *AdminService) Login(ctx context.Context, password string) (string, error) {
	if !util.ConstantTimeEqual(password, s.adminPassword) {
		return "", nil
	}

	token, err := util.GenerateToken()
	if err != nil {
		return "", err
	}

	tokenHash := util.HmacSHA256(s.sessionSecret, token)
	expiresAt := time.Now().Add(24 * time.Hour)

	_, err = s.sessionRepo.Create(ctx, model.CreateAdminSessionParams{
		TokenHash: tokenHash,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return "", err
	}

	return token, nil
}

func (s *AdminService) Logout(ctx context.Context, token string) error {
	tokenHash := util.HmacSHA256(s.sessionSecret, token)
	return s.sessionRepo.DeleteByTokenHash(ctx, tokenHash)
}

func (s *AdminService) ValidateSession(ctx context.Context, token string) bool {
	tokenHash := util.HmacSHA256(s.sessionSecret, token)
	session, err := s.sessionRepo.FindByTokenHash(ctx, tokenHash)
	return err == nil && session != nil
}

type Stats struct {
	Accounts int `json:"accounts"`
	Mappings int `json:"mappings"`
	Messages struct {
		Inbound struct {
			Today  int `json:"today"`
			Week   int `json:"week"`
			Queued int `json:"queued"`
		} `json:"inbound"`
		Outbound struct {
			Today  int `json:"today"`
			Week   int `json:"week"`
			Failed int `json:"failed"`
		} `json:"outbound"`
	} `json:"messages"`
}

func (s *AdminService) GetStats(ctx context.Context) (*Stats, error) {
	stats := &Stats{}

	accounts, _ := s.accountRepo.Count(ctx)
	stats.Accounts = accounts

	pairedCount, _ := s.convRepo.CountByState(ctx, model.PairingStatePaired)
	stats.Mappings = pairedCount

	queuedCount, _ := s.inboundRepo.CountByStatus(ctx, model.InboundStatusQueued)
	stats.Messages.Inbound.Queued = queuedCount

	return stats, nil
}

func (s *AdminService) CreateAccount(ctx context.Context, openclawUserID *string, mode model.AccountMode, rateLimit int) (*model.Account, string, error) {
	token, err := util.GenerateToken()
	if err != nil {
		return nil, "", err
	}

	tokenHash := util.HashToken(token)

	account, err := s.accountRepo.Create(ctx, model.CreateAccountParams{
		OpenclawUserID:  openclawUserID,
		RelayToken:      token,
		RelayTokenHash:  tokenHash,
		Mode:            mode,
		RateLimitPerMin: rateLimit,
	})
	if err != nil {
		return nil, "", err
	}

	return account, token, nil
}

func (s *AdminService) RegenerateToken(ctx context.Context, accountID string) (string, error) {
	token, err := util.GenerateToken()
	if err != nil {
		return "", err
	}

	tokenHash := util.HashToken(token)

	_, err = s.db.ExecContext(ctx, `
		UPDATE accounts SET relay_token_hash = $2, updated_at = NOW()
		WHERE id = $1
	`, accountID, tokenHash)
	if err != nil {
		return "", err
	}

	return token, nil
}

func (s *AdminService) GetAccounts(ctx context.Context, limit, offset int) ([]model.Account, error) {
	return s.accountRepo.FindAll(ctx, limit, offset)
}

func (s *AdminService) GetAccountByID(ctx context.Context, id string) (*model.Account, error) {
	return s.accountRepo.FindByID(ctx, id)
}

func (s *AdminService) DeleteAccount(ctx context.Context, id string) error {
	return s.accountRepo.Delete(ctx, id)
}
