package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/openclaw/relay-server-go/internal/model"
)

type OAuthAccountRepository interface {
	FindByProviderAndUserID(ctx context.Context, provider, providerUserID string) (*model.OAuthAccount, error)
	FindByUserID(ctx context.Context, userID string) ([]*model.OAuthAccount, error)
	Create(ctx context.Context, params model.CreateOAuthAccountParams) (*model.OAuthAccount, error)
	UpdateTokens(ctx context.Context, id string, accessToken, refreshToken *string, expiresAt *time.Time) error
	Delete(ctx context.Context, id string) error
	DeleteByUserAndProvider(ctx context.Context, userID, provider string) error
}

type oauthAccountRepo struct {
	db *sqlx.DB
}

func NewOAuthAccountRepository(db *sqlx.DB) OAuthAccountRepository {
	return &oauthAccountRepo{db: db}
}

func (r *oauthAccountRepo) FindByProviderAndUserID(ctx context.Context, provider, providerUserID string) (*model.OAuthAccount, error) {
	var account model.OAuthAccount
	err := r.db.GetContext(ctx, &account, `
		SELECT * FROM oauth_accounts
		WHERE provider = $1 AND provider_user_id = $2
	`, provider, providerUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &account, nil
}

func (r *oauthAccountRepo) FindByUserID(ctx context.Context, userID string) ([]*model.OAuthAccount, error) {
	var accounts []*model.OAuthAccount
	err := r.db.SelectContext(ctx, &accounts, `
		SELECT * FROM oauth_accounts
		WHERE user_id = $1
		ORDER BY created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	return accounts, nil
}

func (r *oauthAccountRepo) Create(ctx context.Context, params model.CreateOAuthAccountParams) (*model.OAuthAccount, error) {
	var account model.OAuthAccount
	err := r.db.GetContext(ctx, &account, `
		INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, access_token, refresh_token, token_expires_at, raw_data)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING *
	`, params.UserID, params.Provider, params.ProviderUserID, params.Email, params.AccessToken, params.RefreshToken, params.TokenExpiresAt, params.RawData)
	if err != nil {
		return nil, err
	}
	return &account, nil
}

func (r *oauthAccountRepo) UpdateTokens(ctx context.Context, id string, accessToken, refreshToken *string, expiresAt *time.Time) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE oauth_accounts
		SET access_token = $2, refresh_token = $3, token_expires_at = $4, updated_at = NOW()
		WHERE id = $1
	`, id, accessToken, refreshToken, expiresAt)
	return err
}

func (r *oauthAccountRepo) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM oauth_accounts WHERE id = $1`, id)
	return err
}

func (r *oauthAccountRepo) DeleteByUserAndProvider(ctx context.Context, userID, provider string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2`, userID, provider)
	return err
}

// OAuth State Repository

type OAuthStateRepository interface {
	FindByState(ctx context.Context, state string) (*model.OAuthState, error)
	Create(ctx context.Context, params model.CreateOAuthStateParams) (*model.OAuthState, error)
	Delete(ctx context.Context, id string) error
	DeleteExpired(ctx context.Context) (int64, error)
}

type oauthStateRepo struct {
	db *sqlx.DB
}

func NewOAuthStateRepository(db *sqlx.DB) OAuthStateRepository {
	return &oauthStateRepo{db: db}
}

func (r *oauthStateRepo) FindByState(ctx context.Context, state string) (*model.OAuthState, error) {
	var oauthState model.OAuthState
	err := r.db.GetContext(ctx, &oauthState, `
		SELECT * FROM oauth_states
		WHERE state = $1 AND expires_at > NOW()
	`, state)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &oauthState, nil
}

func (r *oauthStateRepo) Create(ctx context.Context, params model.CreateOAuthStateParams) (*model.OAuthState, error) {
	var oauthState model.OAuthState
	err := r.db.GetContext(ctx, &oauthState, `
		INSERT INTO oauth_states (state, provider, code_verifier, redirect_url, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING *
	`, params.State, params.Provider, params.CodeVerifier, params.RedirectURL, params.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return &oauthState, nil
}

func (r *oauthStateRepo) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM oauth_states WHERE id = $1`, id)
	return err
}

func (r *oauthStateRepo) DeleteExpired(ctx context.Context) (int64, error) {
	result, err := r.db.ExecContext(ctx, `DELETE FROM oauth_states WHERE expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
