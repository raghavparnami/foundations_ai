/**
 * pg Pools for the two databases Loom talks to.
 * - catalogPool — Loom's own metadata store
 * - sourcePool(url) — a user-connected source DB (memoized per URL)
 *
 * Pools are stashed on globalThis so Next.js hot reload doesn't leak them.
 * URLs are read directly from process.env with fallback so CLI scripts
 * (push.ts, seed) don't need the full runtime env-validation surface.
 */
import { Pool } from "pg";

const CATALOG_FALLBACK = "postgres://loom:loom@localhost:5544/loom_catalog";

declare global {
  var __loomCatalogPool: Pool | undefined;
  var __loomSourcePools: Map<string, Pool> | undefined;
}

/**
 * All Loom-owned tables live in the `foundation_ai` schema. The role-level
 * ALTER ROLE ... SET search_path made this the default for the `loom` user,
 * but pg's connection pooler can in some cases ignore that setting. We pin
 * it on every connection here so unqualified queries always resolve.
 */
const CATALOG_SCHEMA = "foundation_ai, public";

function makeCatalogPool(): Pool {
  const pool = new Pool({
    connectionString: process.env.LOOM_CATALOG_URL ?? CATALOG_FALLBACK,
    max: 8,
  });
  pool.on("connect", (client) => {
    void client.query(`SET search_path TO ${CATALOG_SCHEMA}`).catch(() => {});
  });
  return pool;
}

export const catalogPool: Pool =
  globalThis.__loomCatalogPool ?? (globalThis.__loomCatalogPool = makeCatalogPool());

export function sourcePool(url: string): Pool {
  if (!globalThis.__loomSourcePools) globalThis.__loomSourcePools = new Map();
  const cache = globalThis.__loomSourcePools;
  let p = cache.get(url);
  if (!p) {
    p = new Pool({ connectionString: url, max: 5 });
    cache.set(url, p);
  }
  return p;
}
