
# Multi-stage build for production

FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Runtime dependencies required by Prisma
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy the complete backend source
COPY . .

# Production uses the dedicated PostgreSQL Prisma schema.
RUN npx prisma generate --schema prisma/schema.postgresql.prisma

# IMPORTANT:
# Prisma 5.22 uses prisma/migrations as the migration directory.
# Replace it only inside the Docker image.
#
# The repository's original SQLite migrations remain untouched.
RUN rm -rf ./prisma/migrations && \
    cp -R ./prisma/migrations-postgresql ./prisma/migrations

# Build the application
RUN npm run build


# ------------------------------------------------------------
# Production image
# ------------------------------------------------------------

FROM node:20-bookworm-slim

WORKDIR /app

# Runtime dependencies required by Prisma
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Application
COPY --from=builder /app/dist ./dist

# Production dependencies
COPY --from=builder /app/node_modules ./node_modules

# Prisma schema + PostgreSQL migration lineage
COPY --from=builder /app/prisma ./prisma

# Package metadata
COPY --from=builder /app/package*.json ./

# Run as non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --create-home --shell /bin/bash nodejs

USER nodejs

EXPOSE 3000
EXPOSE 9090

CMD ["node", "dist/src/production.js"]
