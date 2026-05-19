/**
 * Wiki runner — orchestrates three independent corpus agents.
 *
 * Each agent runs on its own cadence and via its own soft lock in
 * `wiki_agent_state`. They run in parallel; if a previous tick is still
 * running for an agent, this tick skips that agent (no overlap).
 *
 * Triggered by the main scheduler tick (every 60s) AND by the corresponding
 * API write paths (e.g. document upload kicks the docs agent immediately).
 *
 * Per-agent cadences:
 *   tables  — every tick (cheap, hash-gated)
 *   docs    — every tick + on upload
 *   code    — every 5 min + on repo register/refresh
 */
import { beginAgentTick, endAgentTick } from "../../catalog/wiki";
import { runTablesWikiAgent } from "./tables";
import { runDocsWikiAgent } from "./docs";
import { runCodeWikiAgent } from "./code";
import { discoverDomains } from "./domains";
import { runDomainIndexBuilder } from "./domain-index";
import { log } from "../../shared/log";

declare global {
  var __loomWikiCodeLastRunAt: number | undefined;
}

const CODE_INTERVAL_MS = 5 * 60_000;

export async function runAllWikiAgents(opts?: { codeAlways?: boolean }): Promise<void> {
  // 1. Per-corpus ingestion (source pages + raw indexing). These can run
  //    concurrently — they don't touch each other's tables.
  await Promise.allSettled([
    runOneAgent("tables", runTablesWikiAgent),
    runOneAgent("docs", runDocsWikiAgent),
    (async () => {
      const now = Date.now();
      const last = globalThis.__loomWikiCodeLastRunAt ?? 0;
      if (opts?.codeAlways || now - last >= CODE_INTERVAL_MS) {
        globalThis.__loomWikiCodeLastRunAt = now;
        await runOneAgent("code", runCodeWikiAgent);
      }
    })(),
  ]);

  // 2. Domain discovery — re-clusters all source pages into named domains.
  //    Hash-gated, so this is a no-op most ticks. Must run AFTER the source
  //    pages exist; otherwise there's nothing to cluster.
  try {
    await discoverDomains();
  } catch (e) {
    log.warn("wiki.domain_discovery.failed", { err: String(e) });
  }

  // 3. Domain index builder — synthesizes the one-per-domain landing page
  //    using current member set + the existing source page summaries.
  try {
    await runDomainIndexBuilder();
  } catch (e) {
    log.warn("wiki.domain_index.failed", { err: String(e) });
  }
}

async function runOneAgent(
  kind: "tables" | "docs" | "code",
  fn: () => Promise<{ generated: number }>,
): Promise<void> {
  const claimed = await beginAgentTick(kind);
  if (!claimed) {
    // Previous tick still running — skip silently. The lock is released by
    // the running tick when it finishes.
    return;
  }
  const started = Date.now();
  try {
    const out = await fn();
    await endAgentTick(kind, "ok", out.generated);
    log.info(`wiki.${kind}.done`, { generated: out.generated, ms: Date.now() - started });
  } catch (e) {
    await endAgentTick(kind, "failed", 0, String(e));
    log.error(`wiki.${kind}.failed`, { err: String(e), ms: Date.now() - started });
  }
}

/**
 * Targeted single-agent runs for API-driven triggers (e.g. an upload fires
 * the docs agent immediately so the user sees their content indexed).
 */
export async function runTablesWiki(): Promise<void> {
  await runOneAgent("tables", runTablesWikiAgent);
}
export async function runDocsWiki(): Promise<void> {
  await runOneAgent("docs", runDocsWikiAgent);
}
export async function runCodeWiki(): Promise<void> {
  await runOneAgent("code", runCodeWikiAgent);
}
