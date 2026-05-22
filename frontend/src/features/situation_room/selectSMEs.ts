/**
 * Pick the 2-4 SMEs most relevant to a free-text question.
 *
 * Phase 2 v1 — pure keyword match against each persona's `domain` tags.
 * The match is case-insensitive whole-word substring; underscores in domain
 * tags are treated as word breaks so `defect_rate` matches "defect rate" and
 * vice-versa. Ties resolved by the canonical roster order.
 *
 * Future: swap this for a vector-similarity call against domain embeddings.
 */
import type { SMEPersona } from "./types";

const MIN_PANEL = 2;
const MAX_PANEL = 4;

export function selectSMEs(
  question: string,
  roster: readonly SMEPersona[],
): SMEPersona[] {
  const tokens = tokenize(question);
  if (tokens.size === 0) {
    return roster.slice(0, MIN_PANEL);
  }
  const scored = roster.map((persona) => ({
    persona,
    score: scorePersona(persona, tokens),
  }));
  scored.sort((a, b) => b.score - a.score);

  const matched = scored.filter((s) => s.score > 0).map((s) => s.persona);
  if (matched.length >= MIN_PANEL) {
    return matched.slice(0, MAX_PANEL);
  }
  // Pad to MIN_PANEL using roster order so the meeting is never lonely.
  const padded: SMEPersona[] = [...matched];
  for (const p of roster) {
    if (padded.length >= MIN_PANEL) break;
    if (!padded.find((x) => x.id === p.id)) padded.push(p);
  }
  return padded;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
      .split(/[\s_-]+/)
      .filter((w) => w.length > 1),
  );
}

function scorePersona(persona: SMEPersona, tokens: Set<string>): number {
  let score = 0;
  for (const domain of persona.domain) {
    for (const part of domain.toLowerCase().split(/[\s_-]+/)) {
      if (tokens.has(part)) score += 2;
    }
  }
  for (const part of persona.role.toLowerCase().split(/[\s·/-]+/)) {
    if (tokens.has(part)) score += 1;
  }
  return score;
}
