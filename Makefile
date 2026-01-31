.PHONY: help docker-up docker-down docker-logs docker-clean db-shell db-migrate db-generate db-studio db-reset dev build check format lint

.DEFAULT_GOAL := help

# Colors
BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RESET := \033[0m

##@ Help

help: ## Show this help message
	@echo "$(GREEN)Kakao Relay Server$(RESET) - Available commands:"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf ""} /^[a-zA-Z_-]+:.*?##/ { printf "  $(BLUE)%-15s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

##@ Docker Commands

docker-up: ## Start PostgreSQL container
	docker compose up -d
	@echo "$(GREEN)PostgreSQL started. Waiting for health check...$(RESET)"
	@sleep 3
	@docker compose ps

docker-down: ## Stop PostgreSQL container
	docker compose down

docker-logs: ## Follow PostgreSQL logs
	docker compose logs -f postgres

docker-clean: ## Stop and remove PostgreSQL data
	docker compose down -v
	@echo "$(YELLOW)PostgreSQL data volume removed$(RESET)"

##@ Database Commands

db-shell: ## Open PostgreSQL shell
	docker compose exec postgres psql -U $${POSTGRES_USER:-postgres} -d $${POSTGRES_DB:-kakao_relay}

db-migrate: ## Run database migrations
	bun run db:migrate

db-generate: ## Generate new migration from schema changes
	bun run db:generate

db-studio: ## Open Drizzle Studio
	bun run db:studio

db-reset: ## Reset database (drop and recreate)
	docker compose exec postgres psql -U $${POSTGRES_USER:-postgres} -c "DROP DATABASE IF EXISTS $${POSTGRES_DB:-kakao_relay};"
	docker compose exec postgres psql -U $${POSTGRES_USER:-postgres} -c "CREATE DATABASE $${POSTGRES_DB:-kakao_relay};"
	@echo "$(GREEN)Database reset. Run 'make db-migrate' to apply migrations.$(RESET)"

##@ Development Commands

dev: ## Start development server with hot reload
	bun run dev

build: ## Build for production
	bun run build

check: ## Run Biome lint and format check
	bun run check

format: ## Format code with Biome
	bun run format

lint: ## Lint code with Biome
	bun run lint

##@ Quick Start

setup: docker-up db-migrate ## Start PostgreSQL and run migrations
	@echo "$(GREEN)Setup complete! Run 'make dev' to start the server.$(RESET)"

clean: docker-clean ## Clean up all Docker resources
	@echo "$(GREEN)Cleanup complete!$(RESET)"
