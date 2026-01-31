package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/util"
)

type mockAccountRepo struct {
	findByTokenHashFunc func(ctx context.Context, tokenHash string) (*model.Account, error)
}

func (m *mockAccountRepo) FindByTokenHash(ctx context.Context, tokenHash string) (*model.Account, error) {
	if m.findByTokenHashFunc != nil {
		return m.findByTokenHashFunc(ctx, tokenHash)
	}
	return nil, nil
}

func (m *mockAccountRepo) FindByID(ctx context.Context, id string) (*model.Account, error) {
	return nil, nil
}

func (m *mockAccountRepo) FindAll(ctx context.Context, limit, offset int) ([]model.Account, error) {
	return nil, nil
}

func (m *mockAccountRepo) Create(ctx context.Context, params model.CreateAccountParams) (*model.Account, error) {
	return nil, nil
}

func (m *mockAccountRepo) Update(ctx context.Context, id string, params model.UpdateAccountParams) (*model.Account, error) {
	return nil, nil
}

func (m *mockAccountRepo) Delete(ctx context.Context, id string) error {
	return nil
}

func (m *mockAccountRepo) Count(ctx context.Context) (int, error) {
	return 0, nil
}

func TestAuthMiddleware(t *testing.T) {
	testAccount := &model.Account{
		ID:              "acc-123",
		Mode:            model.AccountModeRelay,
		RateLimitPerMin: 60,
	}
	validToken := "valid-token"
	validTokenHash := util.HashToken(validToken)

	t.Run("allows request with valid bearer token", func(t *testing.T) {
		repo := &mockAccountRepo{
			findByTokenHashFunc: func(ctx context.Context, tokenHash string) (*model.Account, error) {
				if tokenHash == validTokenHash {
					return testAccount, nil
				}
				return nil, nil
			},
		}

		middleware := NewAuthMiddleware(repo)
		handler := middleware.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			account := GetAccount(r.Context())
			require.NotNil(t, account)
			assert.Equal(t, "acc-123", account.ID)
			w.WriteHeader(http.StatusOK)
		}))

		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer "+validToken)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("allows request with query token", func(t *testing.T) {
		repo := &mockAccountRepo{
			findByTokenHashFunc: func(ctx context.Context, tokenHash string) (*model.Account, error) {
				if tokenHash == validTokenHash {
					return testAccount, nil
				}
				return nil, nil
			},
		}

		middleware := NewAuthMiddleware(repo)
		handler := middleware.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		req := httptest.NewRequest("GET", "/test?token="+validToken, nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("rejects request without token", func(t *testing.T) {
		repo := &mockAccountRepo{}
		middleware := NewAuthMiddleware(repo)
		handler := middleware.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}))

		req := httptest.NewRequest("GET", "/test", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("rejects request with invalid token", func(t *testing.T) {
		repo := &mockAccountRepo{
			findByTokenHashFunc: func(ctx context.Context, tokenHash string) (*model.Account, error) {
				return nil, nil
			},
		}

		middleware := NewAuthMiddleware(repo)
		handler := middleware.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}))

		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer invalid-token")
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("returns 500 on database error", func(t *testing.T) {
		repo := &mockAccountRepo{
			findByTokenHashFunc: func(ctx context.Context, tokenHash string) (*model.Account, error) {
				return nil, errors.New("database error")
			},
		}

		middleware := NewAuthMiddleware(repo)
		handler := middleware.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}))

		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer "+validToken)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusInternalServerError, rec.Code)
	})
}

func TestGetAccount(t *testing.T) {
	t.Run("returns account from context", func(t *testing.T) {
		account := &model.Account{ID: "test-id"}
		ctx := context.WithValue(context.Background(), AccountContextKey, account)

		result := GetAccount(ctx)

		assert.NotNil(t, result)
		assert.Equal(t, "test-id", result.ID)
	})

	t.Run("returns nil when no account in context", func(t *testing.T) {
		result := GetAccount(context.Background())
		assert.Nil(t, result)
	})
}
