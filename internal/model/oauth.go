package model

import (
	"encoding/json"
	"time"
)

type OAuthAccount struct {
	ID             string          `db:"id" json:"id"`
	UserID         string          `db:"user_id" json:"userId"`
	Provider       string          `db:"provider" json:"provider"`
	ProviderUserID string          `db:"provider_user_id" json:"providerUserId"`
	Email          *string         `db:"email" json:"email,omitempty"`
	AccessToken    *string         `db:"access_token" json:"-"`
	RefreshToken   *string         `db:"refresh_token" json:"-"`
	TokenExpiresAt *time.Time      `db:"token_expires_at" json:"-"`
	RawData        json.RawMessage `db:"raw_data" json:"-"`
	CreatedAt      time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt      time.Time       `db:"updated_at" json:"updatedAt"`
}

type CreateOAuthAccountParams struct {
	UserID         string
	Provider       string
	ProviderUserID string
	Email          *string
	AccessToken    *string
	RefreshToken   *string
	TokenExpiresAt *time.Time
	RawData        json.RawMessage
}

type OAuthState struct {
	ID           string    `db:"id"`
	State        string    `db:"state"`
	Provider     string    `db:"provider"`
	CodeVerifier *string   `db:"code_verifier"`
	RedirectURL  *string   `db:"redirect_url"`
	ExpiresAt    time.Time `db:"expires_at"`
	CreatedAt    time.Time `db:"created_at"`
}

type CreateOAuthStateParams struct {
	State        string
	Provider     string
	CodeVerifier *string
	RedirectURL  *string
	ExpiresAt    time.Time
}

type OAuthUserProfile struct {
	ID            string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
	RawData       json.RawMessage
}

const (
	OAuthProviderGoogle  = "google"
	OAuthProviderTwitter = "twitter"
)
