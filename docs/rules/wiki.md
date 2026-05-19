# Wiki page rules

These rules apply to every LLM-generated wiki page (docs corpus + code corpus).
The workers append this file to their structural system prompt at runtime, so
edits here take effect on the next LLM call — no restart needed.

## Content quality

- **Lead with the claim.** First sentence answers "what is this for?". No preamble like "this document covers…" or "in this module we will…".
- **Cite identifiers verbatim.** Tables as `schema.table`, columns as `column`, file paths as `path/to/file.ts`. KPIs and metric names in **bold**.
- **Quote thresholds + definitions verbatim.** If the source says "deviation rate >2% triggers escalation", quote it — never paraphrase numbers or rules.
- **Cross-link only when justified.** Use `[[tables/<slug>]]`, `[[docs/<slug>]]`, `[[code/<slug>]]` only when the linked object is genuinely the next thing a reader would open. No speculative links.
- **Skip the recap.** Section headings already say what's in them. Don't re-introduce the section in its first sentence.
- **Audience: a new analyst on the team.** Domain literate, not a beginner. No glossary entries for jargon the team uses every day.
- **No filler.** Every sentence carries a fact, a quote, or a pointer. Drop adjectives that don't change meaning ("comprehensive", "robust", "various").

## Creation / skip

- **Skip empty inputs.** Docs with `<200` chars of body text → mark `status='indexed'` with no wiki page. Code modules with `<50` total lines of code → no page.
- **Skip system schemas.** Never create a tables-wiki page for `information_schema`, `pg_*`, or other Postgres-internal objects.
- **One page per concept, not per source.** If an uploaded doc summarizes a table that already has a page, the doc-wiki page should cross-link, not duplicate the column dictionary.
- **No "placeholder" pages.** If the available context is too thin to write every required section, skip the page entirely. A missing page is better than a hollow one.
- **Respect human-edited paragraphs.** Paragraphs tagged `<!-- provenance: human -->` are read-only — never overwrite, never reorder. Enforced upstream in [`src/lib/worker/markdown.ts`](../../src/lib/worker/markdown.ts), restated so the LLM never tries.
- **No duplicate domains.** If the content is materially identical to an existing page (same `body_md` hash), the upsert is already a no-op — don't waste tokens on a rewrite when nothing changed.
