# syntax=docker/dockerfile:1
# GOD CRM — self-host image.
# Build context is the repo root (see docker-compose.yml `build.context: ../..`).

# ---- builder: install all deps, build the React/Vite frontend, prune dev deps ----
FROM node:20-bookworm AS builder
WORKDIR /app
ENV NODE_ENV=production

# Install deps first for better layer caching. Need devDependencies (vite,
# tailwind, typescript) to build the frontend, so override NODE_ENV for npm ci.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy source and build the frontend bundle into ./dist (served by the backend).
COPY . .
RUN npm run build

# Drop dev dependencies but keep the already-compiled native modules
# (bcrypt, better-sqlite3, sharp) so the runtime image stays slim.
RUN npm prune --omit=dev

# ---- runtime: slim image with only what the server needs ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000

# tini = proper PID 1 (signal handling); curl = healthcheck + entrypoint db wait.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Bring over the fully-built, dev-pruned app tree from the builder.
COPY --from=builder /app /app

COPY deploy/selfhost/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "backend/server.js"]
