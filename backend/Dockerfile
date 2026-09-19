
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

# Copy the complete backend source first so the production-specific Prisma
# replacement happens after the final source tree is in place.
COPY . .

# Replace the SQLite development schema with the PostgreSQL schema for the final
# production image only. The repository's SQLite schema remains untouched.
RUN cp prisma/schema.postgresql.prisma prisma/schema.prisma

# Prisma 5.22.x uses prisma/migrations as the migration directory. Replace the
# SQLite history inside this build image with the dedicated PostgreSQL lineage
# only after the entire source tree has been copied.
RUN rm -rf prisma/migrations && \
    cp -R prisma/migrations-postgresql prisma/migrations

# Generate Prisma client for the PostgreSQL production schema.
RUN npx prisma generate --schema prisma/schema.prisma

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
