package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/repository"
	"github.com/openclaw/relay-server-go/internal/sse"
	"github.com/openclaw/relay-server-go/internal/util"
)

const (
	sessionPairingCodeChars  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	sessionPairingExpiryMins = 5
)

type CreateSessionResult struct {
	SessionToken string    `json:"sessionToken"`
	PairingCode  string    `json:"pairingCode"`
	ExpiresIn    int       `json:"expiresIn"`
	Status       string    `json:"status"`
	ExpiresAt    time.Time `json:"-"`
}

type SessionStatusResult struct {
	Status      model.SessionStatus `json:"status"`
	PairedAt    *time.Time          `json:"pairedAt,omitempty"`
	KakaoUserID *string             `json:"kakaoUserId,omitempty"`
	AccountID   *string             `json:"accountId,omitempty"`
}

type SessionPairResult struct {
	Success   bool
	SessionID string
	AccountID string
	Error     string
}

type SessionService struct {
	sessionRepo repository.SessionRepository
	accountRepo repository.AccountRepository
	broker      *sse.Broker
}

func NewSessionService(
	sessionRepo repository.SessionRepository,
	accountRepo repository.AccountRepository,
	broker *sse.Broker,
) *SessionService {
	return &SessionService{
		sessionRepo: sessionRepo,
		accountRepo: accountRepo,
		broker:      broker,
	}
}

func (s *SessionService) CreateSession(ctx context.Context) (*CreateSessionResult, error) {
	token, err := util.GenerateToken()
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	tokenHash := util.HashToken(token)
	pairingCode := generateSessionPairingCode()
	expiresAt := time.Now().Add(sessionPairingExpiryMins * time.Minute)

	session, err := s.sessionRepo.Create(ctx, model.CreateSessionParams{
		SessionToken:     token,
		SessionTokenHash: tokenHash,
		PairingCode:      pairingCode,
		ExpiresAt:        expiresAt,
	})
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}

	log.Info().
		Str("sessionId", session.ID).
		Str("pairingCode", pairingCode).
		Time("expiresAt", expiresAt).
		Msg("session created")

	return &CreateSessionResult{
		SessionToken: token,
		PairingCode:  pairingCode,
		ExpiresIn:    sessionPairingExpiryMins * 60,
		Status:       string(model.SessionStatusPendingPairing),
		ExpiresAt:    expiresAt,
	}, nil
}

func (s *SessionService) GetStatus(ctx context.Context, tokenHash string) (*SessionStatusResult, error) {
	session, err := s.sessionRepo.FindByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil, fmt.Errorf("find session: %w", err)
	}

	if session == nil {
		return nil, nil
	}

	// Check if pending session has expired
	if session.Status == model.SessionStatusPendingPairing && time.Now().After(session.ExpiresAt) {
		s.sessionRepo.MarkExpired(ctx, session.ID)
		return &SessionStatusResult{
			Status: model.SessionStatusExpired,
		}, nil
	}

	result := &SessionStatusResult{
		Status:    session.Status,
		PairedAt:  session.PairedAt,
		AccountID: session.AccountID,
	}

	// Extract kakaoUserId from conversation key if available
	if session.PairedConversationKey != nil {
		parts := strings.Split(*session.PairedConversationKey, ":")
		if len(parts) >= 2 {
			result.KakaoUserID = &parts[1]
		}
	}

	return result, nil
}

func (s *SessionService) FindByTokenHash(ctx context.Context, tokenHash string) (*model.Session, error) {
	return s.sessionRepo.FindByTokenHash(ctx, tokenHash)
}

func (s *SessionService) FindByID(ctx context.Context, id string) (*model.Session, error) {
	return s.sessionRepo.FindByID(ctx, id)
}

func (s *SessionService) VerifyPairingCode(ctx context.Context, code, conversationKey string) SessionPairResult {
	normalizedCode := strings.ToUpper(strings.TrimSpace(code))

	session, err := s.sessionRepo.FindByPairingCode(ctx, normalizedCode)
	if err != nil {
		log.Error().Err(err).Msg("verify pairing code: database error")
		return SessionPairResult{Success: false, Error: "INVALID_CODE"}
	}

	if session == nil {
		log.Warn().Str("code", normalizedCode).Msg("invalid session pairing code")
		return SessionPairResult{Success: false, Error: "INVALID_CODE"}
	}

	// Create account for this session (if not exists)
	account, err := s.createAccountForSession(ctx, session.ID)
	if err != nil {
		log.Error().Err(err).Msg("verify pairing code: create account")
		return SessionPairResult{Success: false, Error: "INTERNAL_ERROR"}
	}

	// Mark session as paired
	if err := s.sessionRepo.MarkPaired(ctx, session.ID, account.ID, conversationKey); err != nil {
		log.Error().Err(err).Msg("verify pairing code: mark paired")
		return SessionPairResult{Success: false, Error: "INTERNAL_ERROR"}
	}

	log.Info().
		Str("sessionId", session.ID).
		Str("accountId", account.ID).
		Str("conversationKey", conversationKey).
		Msg("session paired successfully")

	return SessionPairResult{
		Success:   true,
		SessionID: session.ID,
		AccountID: account.ID,
	}
}

func (s *SessionService) createAccountForSession(ctx context.Context, sessionID string) (*model.Account, error) {
	token, err := util.GenerateToken()
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	tokenHash := util.HashToken(token)

	account, err := s.accountRepo.Create(ctx, model.CreateAccountParams{
		RelayToken:      token,
		RelayTokenHash:  tokenHash,
		Mode:            model.AccountModeRelay,
		RateLimitPerMin: 60,
	})
	if err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}

	return account, nil
}

func (s *SessionService) PublishPairingComplete(ctx context.Context, session *model.Session, conversationKey string) error {
	if session.AccountID == nil {
		return fmt.Errorf("session not paired")
	}

	// Extract kakaoUserId from conversation key
	var kakaoUserID string
	parts := strings.Split(conversationKey, ":")
	if len(parts) >= 2 {
		kakaoUserID = parts[1]
	}

	eventData := fmt.Sprintf(`{"kakaoUserId":"%s","pairedAt":"%s"}`, kakaoUserID, time.Now().Format(time.RFC3339))

	return s.broker.Publish(ctx, *session.AccountID, sse.Event{
		Type: "pairing_complete",
		Data: []byte(eventData),
	})
}

func (s *SessionService) PublishPairingExpired(ctx context.Context, sessionID string, reason string) error {
	session, err := s.sessionRepo.FindByID(ctx, sessionID)
	if err != nil || session == nil {
		return fmt.Errorf("session not found")
	}

	if session.AccountID == nil {
		return nil // No account to notify
	}

	eventData := fmt.Sprintf(`{"reason":"%s"}`, reason)

	return s.broker.Publish(ctx, *session.AccountID, sse.Event{
		Type: "pairing_expired",
		Data: []byte(eventData),
	})
}

func generateSessionPairingCode() string {
	chars := []byte(sessionPairingCodeChars)
	part1 := make([]byte, 4)
	part2 := make([]byte, 4)

	for i := 0; i < 4; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		part1[i] = chars[n.Int64()]
	}
	for i := 0; i < 4; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		part2[i] = chars[n.Int64()]
	}

	return fmt.Sprintf("%s-%s", string(part1), string(part2))
}
