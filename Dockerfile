FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

COPY server/ ./server/
COPY docs/ ./docs/
COPY site.yml ./

RUN addgroup -g 1001 appgroup && adduser -D -u 1001 -G appgroup appuser \
    && chown -R appuser:appgroup /app
USER appuser

EXPOSE 8080
CMD ["bun", "run", "server/index.ts"]
