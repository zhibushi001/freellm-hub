# Build stage 1: 编译 React 前端
FROM cgr.dev/chainguard/node:latest-dev AS client-builder
WORKDIR /app/client
USER root
RUN apk add --no-cache curl 2>/dev/null || true
USER node
COPY --chown=node:node freellm-hub-client/package*.json ./
COPY --chown=node:node freellm-hub-client/node_modules ./node_modules
COPY --chown=node:node freellm-hub-client/ ./
RUN npm run build

# Build stage 2: 编译 TypeScript 后端
FROM cgr.dev/chainguard/node:latest-dev AS builder
WORKDIR /app
USER root
RUN apk add --no-cache curl 2>/dev/null || true
USER node
COPY --chown=node:node package*.json ./
COPY --chown=node:node node_modules ./node_modules
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src ./src
RUN npm run build

# Production stage
FROM cgr.dev/chainguard/node:latest AS production
WORKDIR /app
USER root
RUN apk add --no-cache curl 2>/dev/null || true
USER node
COPY --chown=node:node package*.json ./
COPY --chown=node:node node_modules ./node_modules
# 后端编译产物
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --from=builder --chown=node:node /app/src/db/migrations ./dist/db/migrations
# Keep old SSR CSS/JS for setup page
# COPY --from=builder --chown=node:node /app/src/public ./dist/public
# React 前端构建产物
COPY --from=client-builder --chown=node:node /app/client/dist ./dist/public/admin
RUN mkdir -p /app/data
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3030/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
USER root
ENTRYPOINT ["/usr/bin/node"]
CMD ["dist/server.js"]
