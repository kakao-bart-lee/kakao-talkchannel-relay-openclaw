FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY bun.lock* ./
RUN bun install

COPY src src
COPY tsconfig.json biome.json drizzle.config.ts ./
COPY drizzle drizzle

RUN bun run check

FROM oven/bun:1.3-alpine AS runner

WORKDIR /app

RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/node_modules node_modules
COPY --from=builder --chown=appuser:appgroup /app/src src
COPY --from=builder --chown=appuser:appgroup /app/drizzle drizzle
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/tsconfig.json ./
COPY --from=builder --chown=appuser:appgroup /app/drizzle.config.ts ./

USER appuser

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:8080/health || exit 1

CMD ["bun", "run", "src/index.ts"]
