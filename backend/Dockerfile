# Multi-stage build for production

FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate --schema prisma/schema.postgresql.prisma

COPY . .
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

# Production uses the dedicated PostgreSQL migration lineage.

# The repository's SQLite migrations remain untouched.

RUN rm -rf ./prisma/migrations && cp -R ./prisma/migrations-postgresql ./prisma/migrations
COPY --from=builder /app/package*.json ./

RUN groupadd --gid 1001 nodejs && useradd --uid 1001 --gid nodejs --create-home --shell /bin/bash nodejs

USER nodejs

EXPOSE 3000
EXPOSE 9090

CMD ["node", "dist/src/production.js"]
