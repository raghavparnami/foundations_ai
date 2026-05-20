#!/usr/bin/env sh
# Runtime config injection. Replaces the literal token __VITE_API_BASE_URL__
# in the built JS/CSS/HTML with whatever VITE_API_BASE_URL the container env
# carries. If the env var is empty, the token survives and lib/api.ts falls
# back to same-origin requests.
set -eu

TARGET="${VITE_API_BASE_URL:-}"
# strip a trailing slash if present
case "$TARGET" in
  */) TARGET="${TARGET%/}" ;;
esac

if [ -n "$TARGET" ]; then
  echo "[entrypoint] injecting VITE_API_BASE_URL=$TARGET into bundle"
  find /app/dist -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' \) \
    -exec sed -i "s|__VITE_API_BASE_URL__|$TARGET|g" {} +
else
  echo "[entrypoint] VITE_API_BASE_URL is empty — frontend will use same-origin /api/*"
fi

exec serve -s dist -l "${PORT:-5173}"
