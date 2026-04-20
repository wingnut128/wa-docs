# Build stage: install dependencies using bun (glibc)
FROM oven/bun:1-debian@sha256:e95356cb8e1de62ad69ab3bd3584ba947013d27650a226804d2fc0af4e17dac2 AS build
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
