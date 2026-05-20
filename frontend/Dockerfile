# Multi-stage build: build the Vite bundle with Node, then serve the static
# `dist/` with a tiny Node static server. Railway sets $PORT.
#
# API base URL is resolved at CONTAINER START (not build time) via
# entrypoint.sh. This works around Railway's flaky build-arg pass-through:
# whatever VITE_API_BASE_URL the runtime env carries gets sed-substituted
# into every JS/HTML/CSS asset before `serve` starts.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Run stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS run
WORKDIR /app
RUN npm install -g serve@14

COPY --from=build /app/dist ./dist
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PORT=5173
EXPOSE 5173
CMD ["/entrypoint.sh"]
