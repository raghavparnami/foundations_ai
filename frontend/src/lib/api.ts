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
const BUILD_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim();
// The literal token below is replaced at container start by the Dockerfile
// entrypoint. If the token is still its un-substituted form, we know runtime
// substitution didn't happen and we fall through to BUILD_BASE / same-origin.
const RUNTIME_TOKEN = "__VITE_API_BASE_URL__";
const RUNTIME_BASE = RUNTIME_TOKEN === "__" + "VITE_API_BASE_URL" + "__" ? "" : RUNTIME_TOKEN;
const API_BASE = (RUNTIME_BASE || BUILD_BASE).replace(/\/$/, "");

function url(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

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
