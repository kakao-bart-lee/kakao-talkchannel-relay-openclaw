package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/repository"
)

const (
	portalCodeChars      = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	portalCodeTTLMinutes = 30
	sessionTTLMinutes    = 30
)

// PortalCodeSession represents a temporary portal session
type PortalCodeSession struct {
	Token           string
	ConversationKey string
	ExpiresAt       time.Time
}

// PortalAccessService handles portal access code operations
type PortalAccessService struct {
	codeRepo repository.PortalAccessCodeRepository
	convRepo repository.ConversationRepository
}

// NewPortalAccessService creates a new portal access service
func NewPortalAccessService(
	codeRepo repository.PortalAccessCodeRepository,
	convRepo repository.ConversationRepository,
) *PortalAccessService {
	return &PortalAccessService{
		codeRepo: codeRepo,
		convRepo: convRepo,
	}
}

// GenerateCode generates a new portal access code or returns existing valid one
func (s *PortalAccessService) GenerateCode(
	ctx context.Context,
	conversationKey string,
) (*model.PortalAccessCode, error) {
	// Check if there's already an active code for this conversation
	existing, err := s.codeRepo.FindActiveByConversationKey(ctx, conversationKey)
	if err == nil && existing != nil {
		log.Info().
			Str("code", existing.Code).
			Str("conversationKey", conversationKey).
			Time("expiresAt", existing.ExpiresAt).
			Msg("reusing existing portal access code")
		return existing, nil
	}

	// Generate new code
	var code string
	for attempts := 0; attempts < 10; attempts++ {
		code = generatePortalCode()
		existingCode, _ := s.codeRepo.FindActiveByCode(ctx, code)
		if existingCode == nil {
			break
		}
	}

	expiresAt := time.Now().Add(portalCodeTTLMinutes * time.Minute)
	pac, err := s.codeRepo.Create(ctx, model.CreatePortalAccessCodeParams{
		Code:            code,
		ConversationKey: conversationKey,
		ExpiresAt:       expiresAt,
	})
	if err != nil {
		return nil, fmt.Errorf("create portal access code: %w", err)
	}

	log.Info().
		Str("code", code).
		Str("conversationKey", conversationKey).
		Time("expiresAt", pac.ExpiresAt).
		Msg("portal access code created")

	return pac, nil
}

// VerifyCode verifies a portal access code and returns the conversation key
func (s *PortalAccessService) VerifyCode(
	ctx context.Context,
	code string,
) (string, error) {
	normalizedCode := strings.ToUpper(strings.TrimSpace(code))

	pac, err := s.codeRepo.FindActiveByCode(ctx, normalizedCode)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Warn().Str("code", normalizedCode).Msg("invalid or expired portal code")
			return "", fmt.Errorf("invalid or expired code")
		}
		return "", fmt.Errorf("verify portal code: %w", err)
	}

	// Mark code as used
	if err := s.codeRepo.MarkUsed(ctx, normalizedCode); err != nil {
		log.Error().Err(err).Msg("mark portal code as used")
		return "", fmt.Errorf("verify portal code: %w", err)
	}

	log.Info().
		Str("code", normalizedCode).
		Str("conversationKey", pac.ConversationKey).
		Msg("portal code verified")

	return pac.ConversationKey, nil
}

// CreateCodeSession creates a temporary session for portal access
func (s *PortalAccessService) CreateCodeSession(
	conversationKey string,
) (*PortalCodeSession, error) {
	// Generate secure random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, fmt.Errorf("generate session token: %w", err)
	}
	token := base64.URLEncoding.EncodeToString(tokenBytes)

	session := &PortalCodeSession{
		Token:           token,
		ConversationKey: conversationKey,
		ExpiresAt:       time.Now().Add(sessionTTLMinutes * time.Minute),
	}

	log.Info().
		Str("conversationKey", conversationKey).
		Time("expiresAt", session.ExpiresAt).
		Msg("portal code session created")

	return session, nil
}

// ValidateCodeSession validates a portal session token
// In-memory implementation for now. For production, use Redis.
var sessionStore = make(map[string]*PortalCodeSession)

func (s *PortalAccessService) ValidateCodeSession(
	token string,
) (string, error) {
	session, ok := sessionStore[token]
	if !ok {
		return "", fmt.Errorf("invalid session")
	}

	if time.Now().After(session.ExpiresAt) {
		delete(sessionStore, token)
		return "", fmt.Errorf("session expired")
	}

	return session.ConversationKey, nil
}

// StoreSession stores a session in memory (temporary implementation)
func (s *PortalAccessService) StoreSession(session *PortalCodeSession) {
	sessionStore[session.Token] = session
}

// generatePortalCode generates an 8-character code in XXXX-XXXX format
func generatePortalCode() string {
	chars := []byte(portalCodeChars)
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
