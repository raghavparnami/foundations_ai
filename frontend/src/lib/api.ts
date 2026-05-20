/**
 * Tiny fetch wrapper.
 *
 * API base URL resolution (in priority order):
 *  1. Build-time `VITE_API_BASE_URL` — works for any classic Vite build
 *  2. Runtime placeholder `__VITE_API_BASE_URL__` — replaced by the Docker
 *     entrypoint via sed at container start, using whatever env var Railway
 *     (or any host) supplies. This is the reliable path on platforms whose
 *     build-arg pass-through is flaky.
 *  3. Same-origin fallback — relative `/api/...` (works in dev via Vite's
 *     proxy, or in prod if a reverse-proxy serves backend on the same host)
 */
declare global {
  interface Window {
    __LOOM_API_BASE__?: string;
  }
}
// Runtime API base — comes from window.__LOOM_API_BASE__ which index.html
// sets via an inline script. The Docker entrypoint sed-substitutes the
// literal token `__VITE_API_BASE_URL__` in index.html at container start.
// esbuild can't constant-fold a window global, so this runs at runtime.
//
// IMPORTANT: resolve the base URL ON EVERY REQUEST (not at module load).
// If we cached API_BASE at top-level evaluation, edge cases where the
// inline script hadn't run yet (CSP, async module loading order) would
// freeze it to "" forever. Per-call resolution is cheap and idempotent.
const BUILD_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim();

function resolveApiBase(): string {
  const runtimeRaw =
    (typeof window !== "undefined" && window.__LOOM_API_BASE__) || "";
  const runtime = runtimeRaw.startsWith("http") ? runtimeRaw : "";
  return (runtime || BUILD_BASE).replace(/\/$/, "");
}

function url(path: string): string {
  const base = resolveApiBase();
  return base ? `${base}${path}` : path;
}

// Exported so non-JSON requests (FormData uploads, SSE, etc.) can resolve the
// same runtime base without re-implementing the window-global lookup.
export const apiUrl = url;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, msg: string) {
    super(msg);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON — leave as text
  }
  if (!res.ok) {
    throw new ApiError(res.status, body, `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "POST", body: json ? JSON.stringify(json) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
