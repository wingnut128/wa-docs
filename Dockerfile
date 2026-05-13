# Build stage: install dependencies using bun (glibc)
FROM oven/bun:1-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production

# Runtime stage: Chainguard hardened base with glibc
FROM cgr.dev/chainguard/glibc-dynamic:latest@sha256:fa0d07a6a352921b778c4da11d889b41d9ef8e99c69bc2ec1f8c9ec46b2462e9
WORKDIR /app

# Copy glibc-linked bun binary from build stage
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY docs/ ./docs/
COPY site.yml ./

EXPOSE 8080
CMD ["bun", "run", "server/index.ts"]
