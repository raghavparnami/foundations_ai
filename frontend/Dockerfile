# Multi-stage build: build the Vite bundle with Node, then serve the static
# `dist/` with a tiny Node static server. Railway sets $PORT.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Optional: bake VITE_API_BASE_URL into the build at deploy time so the
# bundle hits the right backend. Set it as a Railway build-time variable.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ─── Run stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS run
WORKDIR /app
RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

# Railway provides $PORT; default to 5173 for local docker run.
ENV PORT=5173
EXPOSE 5173
CMD ["sh", "-c", "serve -s dist -l ${PORT}"]
