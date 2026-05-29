# TexMex — Development Commands
# Run `make help` to see all available targets.

.PHONY: help up down build infra infra-down backend-local logs clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ── Full stack (everything in Docker) ────────────────────────────

up: ## Start all services (client + server + db + latex-compiler)
	docker compose up --build

down: ## Stop all services
	docker compose down

build: ## Rebuild all containers
	docker compose build

logs: ## Tail logs from all services
	docker compose logs -f

# ── Local backend development ────────────────────────────────────

infra: ## Start only infrastructure (db + latex-compiler) for local dev
	docker compose -f docker-compose.infra.yml up --build

infra-down: ## Stop infrastructure services
	docker compose -f docker-compose.infra.yml down

backend-local: ## Start infra (detached), then run the C# server locally
	docker compose -f docker-compose.infra.yml up --build -d
	sleep 5 ## Wait for infra to be ready (simple delay, can be improved with health checks)
	cd server && dotnet run

# ── Cleanup ──────────────────────────────────────────────────────

clean: ## Stop everything and remove volumes (wipes DB data)
	docker compose down -v
	docker compose -f docker-compose.infra.yml down -v
