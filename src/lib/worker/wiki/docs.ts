/**
 * Docs-wiki agent.
 *
 * Reads `documents` rows in status='pending' OR re-indexed (where the page
 * hash changed) and:
 *   1. Chunks the body_text into ~1500-char chunks with 200-char overlap.
 *   2. Stores chunks in `doc_chunks`.
 *   3. Asks the doc-writer LLM to write a wiki page summarizing the document
 *      with structure: ## What it is · ## Key points · ## When to reference.
 *   4. Upserts a `wiki_pages` row with kind='docs', slug derived from filename.
 *
 * Embeddings are optional (only populated when OPENAI_API_KEY is set).
 * For v0.1 we skip the embedder call to keep dependency surface tight.
 */
import { generateText } from "ai";
import { catalogPool } from "../../catalog/db";
import { upsertWikiPage } from "../../catalog/wiki";
import { audit } from "../../catalog/queries";
import { docWriterModel } from "../openrouter";
import { withRules } from "../rules";

const ACTOR = "wiki-agent:docs";
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

const SYSTEM_PROMPT = `You are Loom's documentation summarizer. Given the raw
text of a single document, write a concise wiki page with this exact structure:

  ## What it is
  One paragraph: what this document covers and who it's for.

  ## Key points
  3 to 8 bullet points. Quote a phrase verbatim if it captures a definition,
  rule, or threshold the team should remember. Bold any KPI or metric name.

  ## When to reference
  2 or 3 bullets describing when an analyst should pull this doc into a
  question (e.g. "any question about Q3 quality targets").

  ## Related (optional)
  Bullet list of [[tables/<slug>]] or [[code/<slug>]] cross-references IF
  the document explicitly mentions table names or repos that look like Loom
  identifiers. Skip the section entirely if no obvious matches.

Write nothing outside these sections. No preamble.`;

export async function runDocsWikiAgent(): Promise<{ generated: number }> {
  // Pick up never-indexed docs OR docs whose content_hash differs from the
  // hash we summarized last. IS DISTINCT FROM treats NULL on either side as
  // "different", so a re-upload (last_indexed_hash still NULL after status
  // got flipped externally) also re-indexes.
  const pending = await catalogPool.query<{
    id: number;
    display_name: string;
    body_text: string;
    content_hash: string;
    mime: string;
    size_bytes: string;
  }>(
    `SELECT id, display_name, body_text, content_hash, mime, size_bytes::text
       FROM documents
      WHERE status = 'pending'
         OR (status = 'indexed' AND content_hash IS DISTINCT FROM last_indexed_hash)
      ORDER BY uploaded_at ASC
      LIMIT 10`,
  );

  let generated = 0;
  for (const doc of pending.rows) {
    try {
      await indexOneDoc(doc);
      generated++;
    } catch (e) {
      await catalogPool.query(`UPDATE documents SET status = 'failed' WHERE id = $1`, [doc.id]);
      await audit(ACTOR, "wiki:doc_index_failed", String(doc.id), { err: String(e) });
    }
  }
  return { generated };
}

async function indexOneDoc(doc: {
  id: number;
  display_name: string;
  body_text: string;
  content_hash: string;
}): Promise<void> {
  // 1. Chunk + (re)write chunks
  const chunks = chunkText(doc.body_text, CHUNK_SIZE, CHUNK_OVERLAP);
  await catalogPool.query(`DELETE FROM doc_chunks WHERE document_id = $1`, [doc.id]);
  for (let i = 0; i < chunks.length; i++) {
    await catalogPool.query(
      `INSERT INTO doc_chunks (document_id, ord, text) VALUES ($1, $2, $3)`,
      [doc.id, i, chunks[i]],
    );
  }

  // 2. Ask the doc-writer for a structured summary. We pass the first ~3
  // chunks plus the last chunk to cover bookends — for very long docs this
  // beats sending only the front matter.
  const sample = composeSample(chunks);
  const result = await generateText({
    model: docWriterModel(),
    system: withRules(SYSTEM_PROMPT, "wiki"),
    prompt: `# Document: ${doc.display_name}\n\n${sample}`,
    maxRetries: 1,
  });

  // 3. Upsert the wiki page.
  const slug = slugify(doc.display_name);
  const summary = firstLineOf(result.text) ?? `Summary of ${doc.display_name}`;
  await upsertWikiPage(ACTOR, {
    kind: "docs",
    slug,
    title: doc.display_name,
    summary,
    body_md: result.text.trim(),
    source_ref: { document_id: doc.id, content_hash: doc.content_hash },
  });

  // 4. Mark document indexed. Stamp last_indexed_hash with the content_hash
  // we just summarized; the next tick's WHERE clause uses this to skip the
  // LLM call when nothing has changed.
  await catalogPool.query(
    `UPDATE documents
        SET status = 'indexed',
            indexed_at = NOW(),
            last_indexed_hash = $2
      WHERE id = $1`,
    [doc.id, doc.content_hash],
  );
}

function chunkText(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    out.push(text.slice(i, end));
    if (end === text.length) break;
    i = end - overlap;
  }
  return out;
}

function composeSample(chunks: string[]): string {
  if (chunks.length <= 4) return chunks.join("\n\n---\n\n");
  const head = chunks.slice(0, 3);
  const tail = chunks.slice(-1);
  return [...head, "…", ...tail].join("\n\n---\n\n");
}

function slugify(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const s = base
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || `doc-${Date.now()}`;
}

function firstLineOf(md: string): string | null {
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    return t.slice(0, 200);
  }
  return null;
}
