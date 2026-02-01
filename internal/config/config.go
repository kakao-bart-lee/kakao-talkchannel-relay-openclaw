package config

import (
	"fmt"
	"time"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Port                 int    `env:"PORT" envDefault:"8080"`
	DatabaseURL          string `env:"DATABASE_URL,required"`
	RedisURL             string `env:"REDIS_URL,required"`
	KakaoSignatureSecret string `env:"KAKAO_SIGNATURE_SECRET"`
	AdminPassword        string `env:"ADMIN_PASSWORD"`
	AdminSessionSecret   string `env:"ADMIN_SESSION_SECRET"`
	PortalSessionSecret  string `env:"PORTAL_SESSION_SECRET"`
	QueueTTLSeconds      int    `env:"QUEUE_TTL_SECONDS" envDefault:"900"`
	CallbackTTLSeconds   int    `env:"CALLBACK_TTL_SECONDS" envDefault:"55"`
	LogLevel             string `env:"LOG_LEVEL" envDefault:"info"`

	// OAuth Configuration
	GoogleClientID      string `env:"GOOGLE_CLIENT_ID"`
	GoogleClientSecret  string `env:"GOOGLE_CLIENT_SECRET"`
	TwitterClientID     string `env:"TWITTER_CLIENT_ID"`
	TwitterClientSecret string `env:"TWITTER_CLIENT_SECRET"`
	OAuthStateSecret    string `env:"OAUTH_STATE_SECRET"`
	OAuthRedirectBase   string `env:"OAUTH_REDIRECT_BASE_URL"`
}

func (c *Config) QueueTTL() time.Duration {
	return time.Duration(c.QueueTTLSeconds) * time.Second
}

func (c *Config) CallbackTTL() time.Duration {
	return time.Duration(c.CallbackTTLSeconds) * time.Second
}

func (c *Config) Addr() string {
	return fmt.Sprintf(":%d", c.Port)
}

func Load() (*Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}
	return &cfg, nil
}
