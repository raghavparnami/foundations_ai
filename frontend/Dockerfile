# Multi-stage build: build the Vite bundle with Node, then serve the static
# `dist/` with a tiny Node static server. Railway sets $PORT.
#
# API base URL is RESOLVED AT CONTAINER START (not build time) via the
# entrypoint script. This works around Railway's flaky build-arg pass-through:
# whatever VITE_API_BASE_URL the runtime env carries gets sed-substituted
# into every JS asset right before `serve` starts.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Run stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS run
WORKDIR /app
RUN apk add --no-cache bash && npm install -g serve@14

COPY --from=build /app/dist ./dist

# Entrypoint: replace the literal `__VITE_API_BASE_URL__` token (baked into
# the bundle from lib/api.ts) with whatever the runtime env carries, then
# hand off to `serve`. If the env var is empty, the token survives and the
# frontend falls back to same-origin requests — safe default.
COPY <<'EOF' /entrypoint.sh
#!/usr/bin/env bash
set -euo pipefail
TARGET="${VITE_API_BASE_URL:-}"
TARGET="${TARGET%/}"
if [ -n "$TARGET" ]; then
  echo "[entrypoint] injecting VITE_API_BASE_URL=$TARGET into bundle"
  find /app/dist -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' \) \
    -exec sed -i "s|__VITE_API_BASE_URL__|$TARGET|g" {} +
else
  echo "[entrypoint] VITE_API_BASE_URL is empty — frontend will use same-origin /api/* requests"
fi
exec serve -s dist -l "${PORT:-5173}"
EOF
RUN chmod +x /entrypoint.sh

ENV PORT=5173
EXPOSE 5173
CMD ["/entrypoint.sh"]
