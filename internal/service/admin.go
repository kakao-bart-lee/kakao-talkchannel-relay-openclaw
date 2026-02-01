package service

import (
	"context"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/repository"
	"github.com/openclaw/relay-server-go/internal/util"
)

type AdminService struct {
	db                 *sqlx.DB
	sessionRepo        repository.AdminSessionRepository
	accountRepo        repository.AccountRepository
	convRepo           repository.ConversationRepository
	inboundRepo        repository.InboundMessageRepository
	outboundRepo       repository.OutboundMessageRepository
	portalUserRepo     repository.PortalUserRepository
	pluginSessionRepo  repository.SessionRepository
	adminPassword      string
	sessionSecret      string
}

func NewAdminService(
	db *sqlx.DB,
	sessionRepo repository.AdminSessionRepository,
	accountRepo repository.AccountRepository,
	convRepo repository.ConversationRepository,
	inboundRepo repository.InboundMessageRepository,
	outboundRepo repository.OutboundMessageRepository,
	portalUserRepo repository.PortalUserRepository,
	pluginSessionRepo repository.SessionRepository,
	adminPassword, sessionSecret string,
) *AdminService {
	return &AdminService{
		db:                db,
		sessionRepo:       sessionRepo,
		accountRepo:       accountRepo,
		convRepo:          convRepo,
		inboundRepo:       inboundRepo,
		outboundRepo:      outboundRepo,
		portalUserRepo:    portalUserRepo,
		pluginSessionRepo: pluginSessionRepo,
		adminPassword:     adminPassword,
		sessionSecret:     sessionSecret,
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
	Sessions struct {
		Pending int `json:"pending"`
		Paired  int `json:"paired"`
		Total   int `json:"total"`
	} `json:"sessions"`
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

	// Session stats
	var sessionStats struct {
		Pending int `db:"pending"`
		Paired  int `db:"paired"`
		Total   int `db:"total"`
	}
	s.db.GetContext(ctx, &sessionStats, `
		SELECT
			COUNT(*) FILTER (WHERE status = 'pending_pairing') as pending,
			COUNT(*) FILTER (WHERE status = 'paired') as paired,
			COUNT(*) as total
		FROM sessions
	`)
	stats.Sessions.Pending = sessionStats.Pending
	stats.Sessions.Paired = sessionStats.Paired
	stats.Sessions.Total = sessionStats.Total

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

// Mappings

func (s *AdminService) GetMappings(ctx context.Context, limit, offset int, accountID string) ([]model.ConversationMapping, int, error) {
	var mappings []model.ConversationMapping
	var total int
	var err error

	if accountID != "" {
		mappings, err = s.convRepo.FindByAccountID(ctx, accountID)
		total = len(mappings)
	} else {
		err = s.db.SelectContext(ctx, &mappings, `
			SELECT * FROM conversation_mappings
			ORDER BY first_seen_at DESC
			LIMIT $1 OFFSET $2
		`, limit, offset)
		if err == nil {
			s.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM conversation_mappings`)
		}
	}

	if err != nil {
		return nil, 0, err
	}

	// Apply pagination for accountID case
	if accountID != "" && len(mappings) > 0 {
		start := offset
		end := offset + limit
		if start > len(mappings) {
			mappings = []model.ConversationMapping{}
		} else {
			if end > len(mappings) {
				end = len(mappings)
			}
			mappings = mappings[start:end]
		}
	}

	return mappings, total, nil
}

func (s *AdminService) DeleteMapping(ctx context.Context, id string) error {
	return s.convRepo.Delete(ctx, id)
}

// Messages

func (s *AdminService) GetInboundMessages(ctx context.Context, limit, offset int, accountID, status string) ([]model.InboundMessage, int, error) {
	var messages []model.InboundMessage
	var total int

	query := `SELECT * FROM inbound_messages WHERE 1=1`
	countQuery := `SELECT COUNT(*) FROM inbound_messages WHERE 1=1`
	args := []interface{}{}
	argIndex := 1

	if accountID != "" {
		query += ` AND account_id = $` + strconv.Itoa(argIndex)
		countQuery += ` AND account_id = $` + strconv.Itoa(argIndex)
		args = append(args, accountID)
		argIndex++
	}

	if status != "" {
		query += ` AND status = $` + strconv.Itoa(argIndex)
		countQuery += ` AND status = $` + strconv.Itoa(argIndex)
		args = append(args, status)
		argIndex++
	}

	query += ` ORDER BY created_at DESC LIMIT $` + strconv.Itoa(argIndex) + ` OFFSET $` + strconv.Itoa(argIndex+1)
	args = append(args, limit, offset)

	err := s.db.SelectContext(ctx, &messages, query, args...)
	if err != nil {
		return nil, 0, err
	}

	countArgs := args[:len(args)-2]
	s.db.GetContext(ctx, &total, countQuery, countArgs...)

	return messages, total, nil
}

func (s *AdminService) GetOutboundMessages(ctx context.Context, limit, offset int, accountID, status string) ([]model.OutboundMessage, int, error) {
	var messages []model.OutboundMessage
	var total int

	query := `SELECT * FROM outbound_messages WHERE 1=1`
	countQuery := `SELECT COUNT(*) FROM outbound_messages WHERE 1=1`
	args := []interface{}{}
	argIndex := 1

	if accountID != "" {
		query += ` AND account_id = $` + strconv.Itoa(argIndex)
		countQuery += ` AND account_id = $` + strconv.Itoa(argIndex)
		args = append(args, accountID)
		argIndex++
	}

	if status != "" {
		query += ` AND status = $` + strconv.Itoa(argIndex)
		countQuery += ` AND status = $` + strconv.Itoa(argIndex)
		args = append(args, status)
		argIndex++
	}

	query += ` ORDER BY created_at DESC LIMIT $` + strconv.Itoa(argIndex) + ` OFFSET $` + strconv.Itoa(argIndex+1)
	args = append(args, limit, offset)

	err := s.db.SelectContext(ctx, &messages, query, args...)
	if err != nil {
		return nil, 0, err
	}

	countArgs := args[:len(args)-2]
	s.db.GetContext(ctx, &total, countQuery, countArgs...)

	return messages, total, nil
}

// Users (Portal Users)

func (s *AdminService) GetUsers(ctx context.Context, limit, offset int) ([]model.PortalUser, int, error) {
	var users []model.PortalUser
	var total int

	err := s.db.SelectContext(ctx, &users, `
		SELECT * FROM portal_users
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, 0, err
	}

	s.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM portal_users`)

	return users, total, nil
}

func (s *AdminService) GetUserByID(ctx context.Context, id string) (*model.PortalUser, error) {
	return s.portalUserRepo.FindByID(ctx, id)
}

func (s *AdminService) UpdateUser(ctx context.Context, id string, isActive *bool) (*model.PortalUser, error) {
	if isActive != nil {
		_, err := s.db.ExecContext(ctx, `
			UPDATE portal_users SET is_active = $2 WHERE id = $1
		`, id, *isActive)
		if err != nil {
			return nil, err
		}
	}
	return s.portalUserRepo.FindByID(ctx, id)
}

func (s *AdminService) DeleteUser(ctx context.Context, id string) error {
	return s.portalUserRepo.Delete(ctx, id)
}

// Sessions (Plugin Sessions)

func (s *AdminService) GetSessions(ctx context.Context, limit, offset int, status string) ([]model.Session, int, error) {
	var sessions []model.Session
	var total int

	query := `SELECT * FROM sessions WHERE 1=1`
	countQuery := `SELECT COUNT(*) FROM sessions WHERE 1=1`
	args := []interface{}{}
	argIndex := 1

	if status != "" {
		query += ` AND status = $` + strconv.Itoa(argIndex)
		countQuery += ` AND status = $` + strconv.Itoa(argIndex)
		args = append(args, status)
		argIndex++
	}

	query += ` ORDER BY created_at DESC LIMIT $` + strconv.Itoa(argIndex) + ` OFFSET $` + strconv.Itoa(argIndex+1)
	args = append(args, limit, offset)

	err := s.db.SelectContext(ctx, &sessions, query, args...)
	if err != nil {
		return nil, 0, err
	}

	countArgs := args[:len(args)-2]
	if len(countArgs) > 0 {
		s.db.GetContext(ctx, &total, countQuery, countArgs...)
	} else {
		s.db.GetContext(ctx, &total, countQuery)
	}

	return sessions, total, nil
}

func (s *AdminService) DeleteSession(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = $1`, id)
	return err
}

func (s *AdminService) DisconnectSession(ctx context.Context, id string) error {
	return s.pluginSessionRepo.MarkDisconnected(ctx, id)
}
