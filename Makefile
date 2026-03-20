.DEFAULT_GOAL := help
.PHONY: help dev start scan

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

dev: ## Start server with auto-reload
	bun run --watch server/index.ts

start: ## Start server
	bun run server/index.ts

scan: ## Run semgrep security scan on server/
	semgrep scan --config auto --config p/typescript --config p/javascript \
		--exclude node_modules --exclude bun.lockb \
		server/
