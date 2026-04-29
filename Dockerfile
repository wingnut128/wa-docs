# Build stage: install dependencies using bun (glibc)
FROM oven/bun:1-debian@sha256:e95356cb8e1de62ad69ab3bd3584ba947013d27650a226804d2fc0af4e17dac2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production

# Runtime stage: Chainguard hardened base with glibc
FROM cgr.dev/chainguard/glibc-dynamic:latest@sha256:f85add3add56b070e890089bdf948212715da181a396bf9dd163b088988fbcd2
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
