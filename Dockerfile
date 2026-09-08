# Multi-stage build using cgr.dev/chainguard/wolfi-base (has apk, shell)
# We install nodejs via apk (no docker.io needed)

# ---- Build stage ----
FROM cgr.dev/chainguard/wolfi-base:latest AS builder
WORKDIR /app

# Install nodejs + npm via apk
RUN apk add --no-cache nodejs-20 npm

# Install all deps (including dev)
COPY package*.json ./
RUN npm install

# Build TS -> dist
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev deps for production
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM cgr.dev/chainguard/wolfi-base:latest
WORKDIR /app

# Install only nodejs runtime (smaller)
RUN apk add --no-cache nodejs-20

# Create non-root user 'hub' (chainguard ships with 'nonroot' at uid 65532)
# Use existing 'nonroot' user for safety

# Copy built app + node_modules
COPY --from=builder --chown=nonroot:nonroot /app/dist ./dist
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/package.json ./package.json

# Persistent data dir (create as root, then chown for nonroot)
USER root
RUN mkdir -p /app/data && chown -R nonroot:nonroot /app/data
VOLUME ["/app/data"]
USER nonroot

ENV NODE_ENV=production
ENV PORT=3030
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/freellm-hub.db

EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3030/health || exit 1

CMD ["node", "dist/index.js"]
