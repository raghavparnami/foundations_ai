/**
 * Tiny fetch wrapper.
 *
 * - In dev: paths stay relative ("/api/...") so Vite's proxy forwards to the
 *   FastAPI server on :8001 (see vite.config.ts).
 * - In prod (Railway / any host): set `VITE_API_BASE_URL` at build time, e.g.
 *   "https://loom-backend.up.railway.app". Requests then go to
 *   `${VITE_API_BASE_URL}/api/...`. Leave it blank for same-origin deploys.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

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
