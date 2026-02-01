package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/middleware"
	"github.com/openclaw/relay-server-go/internal/model"
	"github.com/openclaw/relay-server-go/internal/service"
)

type OAuthHandler struct {
	oauthService   *service.OAuthService
	portalService  *service.PortalService
	isProduction   bool
}

func NewOAuthHandler(
	oauthService *service.OAuthService,
	portalService *service.PortalService,
	isProduction bool,
) *OAuthHandler {
	return &OAuthHandler{
		oauthService:  oauthService,
		portalService: portalService,
		isProduction:  isProduction,
	}
}

func (h *OAuthHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/google", h.GoogleAuth)
	r.Get("/google/callback", h.GoogleCallback)
	r.Get("/twitter", h.TwitterAuth)
	r.Get("/twitter/callback", h.TwitterCallback)
	r.Get("/providers", h.ListProviders)
	r.Delete("/unlink/{provider}", h.UnlinkProvider)

	return r
}

func (h *OAuthHandler) GoogleAuth(w http.ResponseWriter, r *http.Request) {
	authURL, err := h.oauthService.GetAuthURL(r.Context(), model.OAuthProviderGoogle)
	if err != nil {
		if err == service.ErrProviderNotConfigured {
			writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "Google OAuth not configured"})
			return
		}
		log.Error().Err(err).Msg("failed to generate Google auth URL")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to initiate OAuth"})
		return
	}

	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

func (h *OAuthHandler) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	h.handleOAuthCallback(w, r, model.OAuthProviderGoogle)
}

func (h *OAuthHandler) TwitterAuth(w http.ResponseWriter, r *http.Request) {
	authURL, err := h.oauthService.GetAuthURL(r.Context(), model.OAuthProviderTwitter)
	if err != nil {
		if err == service.ErrProviderNotConfigured {
			writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "Twitter OAuth not configured"})
			return
		}
		log.Error().Err(err).Msg("failed to generate Twitter auth URL")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to initiate OAuth"})
		return
	}

	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

func (h *OAuthHandler) TwitterCallback(w http.ResponseWriter, r *http.Request) {
	h.handleOAuthCallback(w, r, model.OAuthProviderTwitter)
}

func (h *OAuthHandler) handleOAuthCallback(w http.ResponseWriter, r *http.Request, provider string) {
	if errMsg := r.URL.Query().Get("error"); errMsg != "" {
		log.Warn().Str("error", errMsg).Str("provider", provider).Msg("OAuth error from provider")
		http.Redirect(w, r, "/portal/auth?error=oauth_denied", http.StatusTemporaryRedirect)
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" || state == "" {
		http.Redirect(w, r, "/portal/auth?error=missing_params", http.StatusTemporaryRedirect)
		return
	}

	user, token, err := h.oauthService.HandleCallback(r.Context(), provider, code, state)
	if err != nil {
		log.Error().Err(err).Str("provider", provider).Msg("OAuth callback failed")
		if err == service.ErrInvalidState {
			http.Redirect(w, r, "/portal/auth?error=invalid_state", http.StatusTemporaryRedirect)
			return
		}
		http.Redirect(w, r, "/portal/auth?error=oauth_failed", http.StatusTemporaryRedirect)
		return
	}

	middleware.SetSessionCookie(w, middleware.PortalSessionCookie, token, "/portal", h.isProduction)

	log.Info().Str("provider", provider).Str("userId", user.ID).Msg("OAuth login successful")

	http.Redirect(w, r, "/portal/", http.StatusTemporaryRedirect)
}

func (h *OAuthHandler) ListProviders(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	accounts, err := h.oauthService.GetLinkedProviders(r.Context(), user.ID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get linked providers")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
		return
	}

	providers := make([]map[string]any, len(accounts))
	for i, acc := range accounts {
		providers[i] = map[string]any{
			"provider": acc.Provider,
			"email":    acc.Email,
			"linkedAt": acc.CreatedAt,
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"providers": providers,
	})
}

func (h *OAuthHandler) UnlinkProvider(w http.ResponseWriter, r *http.Request) {
	user := h.getSessionUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Not authenticated"})
		return
	}

	provider := chi.URLParam(r, "provider")
	if provider == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provider is required"})
		return
	}

	if err := h.oauthService.UnlinkProvider(r.Context(), user.ID, provider); err != nil {
		if err == service.ErrCannotUnlinkLastMethod {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot unlink last authentication method"})
			return
		}
		log.Error().Err(err).Str("provider", provider).Msg("failed to unlink provider")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to unlink provider"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h *OAuthHandler) getSessionUser(r *http.Request) *model.PortalUser {
	cookie, err := r.Cookie(middleware.PortalSessionCookie)
	if err != nil || cookie.Value == "" {
		return nil
	}

	user, err := h.portalService.ValidateSession(r.Context(), cookie.Value)
	if err != nil {
		return nil
	}
	return user
}
