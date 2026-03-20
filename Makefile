.DEFAULT_GOAL := help
.PHONY: help dev start scan docker-build docker-run docker-stop

IMAGE_NAME := wa-docs
CONTAINER_NAME := wa-docs
PORT := 8080

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

dev: ## Start server with auto-reload
	bun run --watch server/index.ts

start: ## Start server
	bun run server/index.ts

scan: ## Run semgrep security scan on server/
	semgrep scan --config auto --config p/typescript --config p/javascript \
		--exclude node_modules --exclude bun.lockb \
		server/

docker-build: ## Build container image
	docker build -t $(IMAGE_NAME) .

docker-run: ## Build and run container (port 8080)
	@docker rm -f $(CONTAINER_NAME) 2>/dev/null || true
	docker build -t $(IMAGE_NAME) .
	docker run -d --name $(CONTAINER_NAME) -p $(PORT):8080 $(IMAGE_NAME)
	@echo "Server running at http://localhost:$(PORT)"

docker-stop: ## Stop and remove container
	docker rm -f $(CONTAINER_NAME)
