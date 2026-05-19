/**
 * Short-term memory: condense old turns of a conversation into a one-paragraph
 * summary on `conversations.summary_md`, so long chats survive token compaction
 * without losing context.
 *
 * Triggered after each agent turn (fire-and-forget). Idempotent and
 * rate-limited: only re-summarizes if message_count grew by >= TRIGGER_EVERY
 * since the last summary.
 *
 * Cost note: one short LLM call per summary, gated by the trigger threshold.
 */
import { generateText } from "ai";
import { catalogPool } from "../catalog/db";
import { setConversationSummary } from "../catalog/memories";
import { docWriterModel } from "./openrouter";
import { log } from "../shared/log";

const TRIGGER_EVERY = 4;
const SYSTEM = `You are summarizing the older portion of a chat between a
data analyst (the user) and an AI agent (Loom) so the agent can carry
forward context without re-reading every old message.

Write ONE compact Markdown paragraph (max ~120 words) covering:
- What the user is investigating (their goal in this chat)
- Key decisions / constraints they've established
- Tables, views, skills, or domains the agent has used so far
- Open threads that may need follow-up

Be terse. Use specifics from the messages, not generic phrases. Skip
greetings, acknowledgements, and tool-call mechanics. Don't repeat
information already in the system prompt.`;

export async function maybeSummarizeConversation(slug: string): Promise<void> {
  const r = await catalogPool.query<{
    total: number;
    last_summarized: number;
    last_user_text: string | null;
  }>(
    `SELECT
       (SELECT count(*)::int FROM messages WHERE conversation_id = $1) AS total,
       COALESCE(c.summarized_turn_count, 0) AS last_summarized,
       (SELECT m.parts::text FROM messages m
         WHERE m.conversation_id = $1 AND m.role = 'user'
         ORDER BY m.ord DESC LIMIT 1) AS last_user_text
       FROM conversations c WHERE c.slug = $1`,
    [slug],
  );
  const row = r.rows[0];
  if (!row) return;
  if (row.total - row.last_summarized < TRIGGER_EVERY) return;

  // Pull every message except the very latest pair (keep them verbatim so
  // they read naturally in the new turn).
  const messagesRes = await catalogPool.query<{
    role: string;
    parts: unknown;
    ord: number;
  }>(
    `SELECT role, parts, ord
       FROM messages
      WHERE conversation_id = $1
      ORDER BY ord ASC`,
    [slug],
  );
  if (messagesRes.rows.length === 0) return;

  // Flatten parts into plain text for the summarizer prompt.
  const transcript = messagesRes.rows
    .map((m) => `### ${m.role.toUpperCase()}\n${extractText(m.parts)}`)
    .join("\n\n");
  if (transcript.length < 200) return; // not enough material

  try {
    const out = await generateText({
      model: docWriterModel(),
      system: SYSTEM,
      prompt: transcript.slice(0, 18_000), // cap input to ~4k tokens
      maxRetries: 1,
    });
    const summary = out.text.trim();
    if (summary.length === 0) return;
    await setConversationSummary(slug, summary, row.total);
    log.info("conv_summary.updated", { slug, turn_count: row.total, bytes: summary.length });
  } catch (e) {
    log.warn("conv_summary.failed", { slug, err: String(e) });
  }
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => {
      const obj = p as { type?: string; text?: string; toolName?: string; output?: unknown };
      if (obj.type === "text" && typeof obj.text === "string") return obj.text;
      if (typeof obj.type === "string" && obj.type.startsWith("tool-")) {
        const name = obj.type.replace(/^tool-/, "");
        const out = obj.output ? JSON.stringify(obj.output).slice(0, 200) : "";
        return `[tool ${name}${out ? `: ${out}` : ""}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
