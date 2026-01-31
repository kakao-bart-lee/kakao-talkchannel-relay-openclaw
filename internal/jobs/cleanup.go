package jobs

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/openclaw/relay-server-go/internal/repository"
)

type CleanupJob struct {
	adminSessionRepo  repository.AdminSessionRepository
	portalSessionRepo repository.PortalSessionRepository
	pairingCodeRepo   repository.PairingCodeRepository
	inboundMsgRepo    repository.InboundMessageRepository
	interval          time.Duration
	done              chan struct{}
}

func NewCleanupJob(
	adminSessionRepo repository.AdminSessionRepository,
	portalSessionRepo repository.PortalSessionRepository,
	pairingCodeRepo repository.PairingCodeRepository,
	inboundMsgRepo repository.InboundMessageRepository,
	interval time.Duration,
) *CleanupJob {
	return &CleanupJob{
		adminSessionRepo:  adminSessionRepo,
		portalSessionRepo: portalSessionRepo,
		pairingCodeRepo:   pairingCodeRepo,
		inboundMsgRepo:    inboundMsgRepo,
		interval:          interval,
		done:              make(chan struct{}),
	}
}

func (j *CleanupJob) Start() {
	go j.run()
	log.Info().Dur("interval", j.interval).Msg("cleanup job started")
}

func (j *CleanupJob) Stop() {
	close(j.done)
	log.Info().Msg("cleanup job stopped")
}

func (j *CleanupJob) run() {
	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	j.cleanup()

	for {
		select {
		case <-j.done:
			return
		case <-ticker.C:
			j.cleanup()
		}
	}
}

func (j *CleanupJob) cleanup() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	adminCount, err := j.adminSessionRepo.DeleteExpired(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to cleanup admin sessions")
	} else if adminCount > 0 {
		log.Info().Int64("count", adminCount).Msg("cleaned up expired admin sessions")
	}

	portalCount, err := j.portalSessionRepo.DeleteExpired(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to cleanup portal sessions")
	} else if portalCount > 0 {
		log.Info().Int64("count", portalCount).Msg("cleaned up expired portal sessions")
	}

	codeCount, err := j.pairingCodeRepo.DeleteExpired(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to cleanup expired pairing codes")
	} else if codeCount > 0 {
		log.Info().Int64("count", codeCount).Msg("cleaned up expired pairing codes")
	}

	expiredCount, err := j.inboundMsgRepo.MarkExpired(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to mark expired messages")
	} else if expiredCount > 0 {
		log.Info().Int64("count", expiredCount).Msg("marked expired inbound messages")
	}
}
