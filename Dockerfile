# Build stage: install dependencies using bun (glibc)
FROM oven/bun:1-debian AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production

# Runtime stage: Chainguard hardened base with glibc
FROM cgr.dev/chainguard/glibc-dynamic:latest
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
