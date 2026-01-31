package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/repository"
	"github.com/openclaw/relay-server-go/internal/util"
)

type contextKey string

const AccountContextKey contextKey = "account"

func GetAccount(ctx context.Context) *model.Account {
	if account, ok := ctx.Value(AccountContextKey).(*model.Account); ok {
		return account
	}
	return nil
}

type AuthMiddleware struct {
	accountRepo repository.AccountRepository
}

func NewAuthMiddleware(accountRepo repository.AccountRepository) *AuthMiddleware {
	return &AuthMiddleware{accountRepo: accountRepo}
}

func (m *AuthMiddleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": "Missing authentication token",
			})
			return
		}

		tokenHash := util.HashToken(token)
		account, err := m.accountRepo.FindByTokenHash(r.Context(), tokenHash)
		if err != nil {
			log.Error().Err(err).Msg("auth middleware: database error")
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "Authentication failed",
			})
			return
		}

		if account == nil {
			log.Warn().Msg("auth middleware: invalid token attempt")
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": "Invalid token",
			})
			return
		}

		ctx := context.WithValue(r.Context(), AccountContextKey, account)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractToken(r *http.Request) string {
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}

	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}

	return ""
}
