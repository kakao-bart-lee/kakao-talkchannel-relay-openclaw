package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/config"
	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/repository"
	"github.com/openclaw/relay-server-go/internal/util"
)

var (
	ErrInvalidState           = errors.New("invalid or expired OAuth state")
	ErrOAuthProviderError     = errors.New("OAuth provider returned an error")
	ErrCannotUnlinkLastMethod = errors.New("cannot unlink last authentication method")
	ErrProviderNotConfigured  = errors.New("OAuth provider not configured")
)

type OAuthService struct {
	cfg         *config.Config
	userRepo    repository.PortalUserRepository
	oauthRepo   repository.OAuthAccountRepository
	stateRepo   repository.OAuthStateRepository
	accountRepo repository.AccountRepository
	portalSvc   *PortalService
}

func NewOAuthService(
	cfg *config.Config,
	userRepo repository.PortalUserRepository,
	oauthRepo repository.OAuthAccountRepository,
	stateRepo repository.OAuthStateRepository,
	sessionRepo repository.PortalSessionRepository,
	accountRepo repository.AccountRepository,
	portalSvc *PortalService,
) *OAuthService {
	return &OAuthService{
		cfg:         cfg,
		userRepo:    userRepo,
		oauthRepo:   oauthRepo,
		stateRepo:   stateRepo,
		accountRepo: accountRepo,
		portalSvc:   portalSvc,
	}
}

func (s *OAuthService) GetAuthURL(ctx context.Context, provider string) (string, error) {
	state, err := util.GenerateToken()
	if err != nil {
		return "", err
	}

	var codeVerifier *string
	if provider == model.OAuthProviderTwitter {
		verifier, err := util.GenerateToken()
		if err != nil {
			return "", fmt.Errorf("failed to generate code verifier: %w", err)
		}
		codeVerifier = &verifier
	}

	_, err = s.stateRepo.Create(ctx, model.CreateOAuthStateParams{
		State:        state,
		Provider:     provider,
		CodeVerifier: codeVerifier,
		ExpiresAt:    time.Now().Add(10 * time.Minute),
	})
	if err != nil {
		return "", err
	}

	switch provider {
	case model.OAuthProviderGoogle:
		return s.buildGoogleAuthURL(state)
	case model.OAuthProviderTwitter:
		return s.buildTwitterAuthURL(state, *codeVerifier)
	default:
		return "", fmt.Errorf("unknown provider: %s", provider)
	}
}

func (s *OAuthService) HandleCallback(ctx context.Context, provider, code, state string) (*model.PortalUser, string, error) {
	storedState, err := s.stateRepo.FindByState(ctx, state)
	if err != nil || storedState == nil {
		return nil, "", ErrInvalidState
	}
	defer s.stateRepo.Delete(ctx, storedState.ID)

	if storedState.Provider != provider {
		return nil, "", ErrInvalidState
	}

	var profile *model.OAuthUserProfile
	switch provider {
	case model.OAuthProviderGoogle:
		profile, err = s.exchangeGoogleCode(ctx, code)
	case model.OAuthProviderTwitter:
		profile, err = s.exchangeTwitterCode(ctx, code, storedState.CodeVerifier)
	default:
		return nil, "", fmt.Errorf("unknown provider: %s", provider)
	}
	if err != nil {
		return nil, "", err
	}

	oauthAccount, err := s.oauthRepo.FindByProviderAndUserID(ctx, provider, profile.ID)
	if err != nil {
		return nil, "", err
	}

	var user *model.PortalUser

	if oauthAccount != nil {
		user, err = s.userRepo.FindByID(ctx, oauthAccount.UserID)
		if err != nil {
			return nil, "", err
		}
	} else {
		if profile.Email != "" {
			user, _ = s.userRepo.FindByEmail(ctx, profile.Email)
		}

		if user != nil {
			err = s.linkOAuthAccount(ctx, user.ID, provider, profile)
		} else {
			user, err = s.createOAuthUser(ctx, provider, profile)
		}
		if err != nil {
			return nil, "", err
		}
	}

	s.userRepo.UpdateLastLogin(ctx, user.ID)

	token, err := s.portalSvc.CreateSession(ctx, user.ID)
	if err != nil {
		return nil, "", err
	}

	log.Info().
		Str("provider", provider).
		Str("userId", user.ID).
		Str("email", user.Email).
		Msg("OAuth login successful")

	return user, token, nil
}

func (s *OAuthService) linkOAuthAccount(ctx context.Context, userID, provider string, profile *model.OAuthUserProfile) error {
	_, err := s.oauthRepo.Create(ctx, model.CreateOAuthAccountParams{
		UserID:         userID,
		Provider:       provider,
		ProviderUserID: profile.ID,
		Email:          &profile.Email,
		RawData:        profile.RawData,
	})
	return err
}

func (s *OAuthService) createOAuthUser(ctx context.Context, provider string, profile *model.OAuthUserProfile) (*model.PortalUser, error) {
	relayToken, err := util.GenerateToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate relay token: %w", err)
	}
	tokenHash := util.HashToken(relayToken)

	account, err := s.accountRepo.Create(ctx, model.CreateAccountParams{
		Mode:            model.AccountModeRelay,
		RelayToken:      relayToken,
		RelayTokenHash:  tokenHash,
		RateLimitPerMin: 60,
	})
	if err != nil {
		return nil, err
	}

	user, err := s.userRepo.Create(ctx, model.CreatePortalUserParams{
		Email:     profile.Email,
		AccountID: account.ID,
	})
	if err != nil {
		return nil, err
	}

	err = s.linkOAuthAccount(ctx, user.ID, provider, profile)
	if err != nil {
		return nil, err
	}

	log.Info().
		Str("provider", provider).
		Str("userId", user.ID).
		Str("email", profile.Email).
		Msg("OAuth user created")

	return user, nil
}

func (s *OAuthService) GetLinkedProviders(ctx context.Context, userID string) ([]*model.OAuthAccount, error) {
	return s.oauthRepo.FindByUserID(ctx, userID)
}

func (s *OAuthService) UnlinkProvider(ctx context.Context, userID, provider string) error {
	accounts, err := s.GetLinkedProviders(ctx, userID)
	if err != nil {
		return err
	}

	otherProviders := 0
	for _, acc := range accounts {
		if acc.Provider != provider {
			otherProviders++
		}
	}

	if otherProviders == 0 {
		return ErrCannotUnlinkLastMethod
	}

	return s.oauthRepo.DeleteByUserAndProvider(ctx, userID, provider)
}

// Google OAuth

func (s *OAuthService) buildGoogleAuthURL(state string) (string, error) {
	if s.cfg.GoogleClientID == "" {
		return "", ErrProviderNotConfigured
	}

	params := url.Values{
		"client_id":     {s.cfg.GoogleClientID},
		"redirect_uri":  {s.cfg.OAuthRedirectBase + "/api/oauth/google/callback"},
		"response_type": {"code"},
		"scope":         {"openid email profile"},
		"state":         {state},
		"access_type":   {"offline"},
		"prompt":        {"select_account"},
	}

	return "https://accounts.google.com/o/oauth2/v2/auth?" + params.Encode(), nil
}

func (s *OAuthService) exchangeGoogleCode(ctx context.Context, code string) (*model.OAuthUserProfile, error) {
	data := url.Values{
		"code":          {code},
		"client_id":     {s.cfg.GoogleClientID},
		"client_secret": {s.cfg.GoogleClientSecret},
		"redirect_uri":  {s.cfg.OAuthRedirectBase + "/api/oauth/google/callback"},
		"grant_type":    {"authorization_code"},
	}

	resp, err := http.PostForm("https://oauth2.googleapis.com/token", data)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Google token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		log.Error().Int("status", resp.StatusCode).Msg("Google token exchange failed")
		return nil, ErrOAuthProviderError
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		IDToken     string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create userinfo request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	userResp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer userResp.Body.Close()

	userBody, err := io.ReadAll(userResp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Google userinfo response: %w", err)
	}
	if userResp.StatusCode != http.StatusOK {
		log.Error().Int("status", userResp.StatusCode).Msg("Google userinfo failed")
		return nil, ErrOAuthProviderError
	}

	var userInfo struct {
		ID            string `json:"id"`
		Email         string `json:"email"`
		VerifiedEmail bool   `json:"verified_email"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := json.Unmarshal(userBody, &userInfo); err != nil {
		return nil, err
	}

	return &model.OAuthUserProfile{
		ID:            userInfo.ID,
		Email:         userInfo.Email,
		EmailVerified: userInfo.VerifiedEmail,
		Name:          userInfo.Name,
		Picture:       userInfo.Picture,
		RawData:       userBody,
	}, nil
}

// Twitter OAuth (with PKCE)

func (s *OAuthService) buildTwitterAuthURL(state, codeVerifier string) (string, error) {
	if s.cfg.TwitterClientID == "" {
		return "", ErrProviderNotConfigured
	}

	codeChallenge := generateCodeChallenge(codeVerifier)

	params := url.Values{
		"response_type":         {"code"},
		"client_id":             {s.cfg.TwitterClientID},
		"redirect_uri":          {s.cfg.OAuthRedirectBase + "/api/oauth/twitter/callback"},
		"scope":                 {"users.read tweet.read offline.access"},
		"state":                 {state},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {"S256"},
	}

	return "https://twitter.com/i/oauth2/authorize?" + params.Encode(), nil
}

func (s *OAuthService) exchangeTwitterCode(ctx context.Context, code string, codeVerifier *string) (*model.OAuthUserProfile, error) {
	if codeVerifier == nil {
		return nil, errors.New("code verifier required for Twitter OAuth")
	}

	data := url.Values{
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"client_id":     {s.cfg.TwitterClientID},
		"redirect_uri":  {s.cfg.OAuthRedirectBase + "/api/oauth/twitter/callback"},
		"code_verifier": {*codeVerifier},
	}

	req, err := http.NewRequest("POST", "https://api.twitter.com/2/oauth2/token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create Twitter token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(s.cfg.TwitterClientID, s.cfg.TwitterClientSecret)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Twitter token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		log.Error().Int("status", resp.StatusCode).Msg("Twitter token exchange failed")
		return nil, ErrOAuthProviderError
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, err
	}

	userReq, err := http.NewRequestWithContext(ctx, "GET", "https://api.twitter.com/2/users/me?user.fields=profile_image_url", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Twitter user request: %w", err)
	}
	userReq.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)

	userResp, err := client.Do(userReq)
	if err != nil {
		return nil, err
	}
	defer userResp.Body.Close()

	userBody, err := io.ReadAll(userResp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Twitter user response: %w", err)
	}
	if userResp.StatusCode != http.StatusOK {
		log.Error().Int("status", userResp.StatusCode).Msg("Twitter user info failed")
		return nil, ErrOAuthProviderError
	}

	var twitterUser struct {
		Data struct {
			ID              string `json:"id"`
			Name            string `json:"name"`
			Username        string `json:"username"`
			ProfileImageURL string `json:"profile_image_url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(userBody, &twitterUser); err != nil {
		return nil, err
	}

	return &model.OAuthUserProfile{
		ID:            twitterUser.Data.ID,
		Email:         "",
		EmailVerified: false,
		Name:          twitterUser.Data.Name,
		Picture:       twitterUser.Data.ProfileImageURL,
		RawData:       userBody,
	}, nil
}

func generateCodeChallenge(verifier string) string {
	hash := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}
