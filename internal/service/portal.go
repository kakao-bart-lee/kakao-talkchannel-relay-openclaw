package service

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/repository"
	"github.com/openclaw/relay-server-go/internal/util"
)

var (
	ErrEmailExists       = errors.New("email already exists")
	ErrInvalidCredentials = errors.New("invalid email or password")
)

type PortalService struct {
	userRepo    repository.PortalUserRepository
	sessionRepo repository.PortalSessionRepository
	accountRepo repository.AccountRepository
	sessionSecret string
}

func NewPortalService(
	userRepo repository.PortalUserRepository,
	sessionRepo repository.PortalSessionRepository,
	accountRepo repository.AccountRepository,
	sessionSecret string,
) *PortalService {
	return &PortalService{
		userRepo:      userRepo,
		sessionRepo:   sessionRepo,
		accountRepo:   accountRepo,
		sessionSecret: sessionSecret,
	}
}

func (s *PortalService) Signup(ctx context.Context, email, password string) (*model.PortalUser, string, error) {
	existing, _ := s.userRepo.FindByEmail(ctx, email)
	if existing != nil {
		return nil, "", ErrEmailExists
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", err
	}

	relayToken, _ := util.GenerateToken()
	tokenHash := util.HashToken(relayToken)

	account, err := s.accountRepo.Create(ctx, model.CreateAccountParams{
		Mode:            model.AccountModeRelay,
		RelayToken:      relayToken,
		RelayTokenHash:  tokenHash,
		RateLimitPerMin: 60,
	})
	if err != nil {
		return nil, "", err
	}

	user, err := s.userRepo.Create(ctx, model.CreatePortalUserParams{
		Email:        email,
		PasswordHash: string(hashedPassword),
		AccountID:    account.ID,
	})
	if err != nil {
		return nil, "", err
	}

	token, err := s.createSession(ctx, user.ID)
	if err != nil {
		return nil, "", err
	}

	log.Info().Str("email", email).Str("userId", user.ID).Msg("portal user signed up")

	return user, token, nil
}

func (s *PortalService) Login(ctx context.Context, email, password string) (*model.PortalUser, string, error) {
	user, err := s.userRepo.FindByEmail(ctx, email)
	if err != nil || user == nil {
		return nil, "", ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, "", ErrInvalidCredentials
	}

	s.userRepo.UpdateLastLogin(ctx, user.ID)

	token, err := s.createSession(ctx, user.ID)
	if err != nil {
		return nil, "", err
	}

	log.Info().Str("email", email).Str("userId", user.ID).Msg("portal user logged in")

	return user, token, nil
}

func (s *PortalService) Logout(ctx context.Context, token string) error {
	tokenHash := util.HmacSHA256(s.sessionSecret, token)
	session, _ := s.sessionRepo.FindByTokenHash(ctx, tokenHash)
	if session != nil {
		return s.sessionRepo.Delete(ctx, session.ID)
	}
	return nil
}

func (s *PortalService) ValidateSession(ctx context.Context, token string) (*model.PortalUser, error) {
	tokenHash := util.HmacSHA256(s.sessionSecret, token)
	session, err := s.sessionRepo.FindByTokenHash(ctx, tokenHash)
	if err != nil || session == nil {
		return nil, nil
	}

	return s.userRepo.FindByID(ctx, session.UserID)
}

func (s *PortalService) createSession(ctx context.Context, userID string) (string, error) {
	token, err := util.GenerateToken()
	if err != nil {
		return "", err
	}

	tokenHash := util.HmacSHA256(s.sessionSecret, token)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = s.sessionRepo.Create(ctx, model.CreatePortalSessionParams{
		TokenHash: tokenHash,
		UserID:    userID,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return "", err
	}

	return token, nil
}
