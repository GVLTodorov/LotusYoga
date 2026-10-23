# syntax=docker/dockerfile:1
# Single image: backend (Fastify) serves the API and the built frontend.

FROM node:22.11-bookworm-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

FROM node:22.11-bookworm-slim AS backend-build
WORKDIR /backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
# postinstall runs "prisma generate", so the schema must exist before npm ci
COPY backend/prisma ./prisma
RUN npm ci --silent
COPY backend/ ./
RUN npx prisma generate && npm run build \
    && npm prune --omit=dev --silent

FROM node:22.11-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=5080 HOST=0.0.0.0 STATIC_DIR=/app/public
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build --chown=node:node /backend/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /backend/dist ./dist
COPY --from=backend-build --chown=node:node /backend/package.json ./package.json
COPY --from=backend-build --chown=node:node /backend/prisma ./prisma
COPY --from=frontend-build --chown=node:node /frontend/dist ./public
USER node
EXPOSE 5080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Production secrets (DATABASE_URL, JWT_SECRET...) come from the host environment.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
