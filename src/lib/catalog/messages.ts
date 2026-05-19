/**
 * Message persistence layer.
 *
 * Each conversation has a stable slug (the `id` field in useChat). On every
 * chat turn:
 *  1. Server saves the latest **user** message before invoking the model.
 *  2. After streamText finishes, server saves the **assistant** message (with
 *     all its parts: text + tool calls + tool outputs).
 *
 * Hydration: a GET endpoint returns messages by conversation slug, ordered.
 * The client passes them to `useChat({ initialMessages })`.
 *
 * Storage: messages are stored verbatim as JSONB so AI SDK can round-trip
 * them without lossy conversion.
 */
import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";
import { catalogPool } from "./db";

export type StoredMessage = {
  id: number;
  conversation_id: string;
  message_id: string;
  ord: number;
  role: string;
  parts: unknown;
  created_at: string;
};

export async function ensureConversation(
  slug: string,
  initialTitle: string | null,
  projectSlug: string | null,
): Promise<void> {
  await catalogPool.query(
    `INSERT INTO conversations (slug, title, project_slug)
       VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE
        SET project_slug = COALESCE(EXCLUDED.project_slug, conversations.project_slug),
            updated_at = now()`,
    [slug, initialTitle?.slice(0, 120) || "New conversation", projectSlug],
  );
}

/**
 * Persist a single UIMessage. Uses ON CONFLICT (conversation_id, message_id)
 * so re-saving the same message (e.g. on a retry) overwrites cleanly with
 * the latest parts array.
 */
export async function persistMessage(
  conversationSlug: string,
  message: UIMessage,
): Promise<void> {
  // AI SDK v6 sometimes hands us an empty `responseMessage.id` from the
  // server-side onFinish callback. Treat blank ids as "fresh insert" and
  // mint a UUID — otherwise every assistant turn collides on the (slug,'')
  // unique key and only the latest survives.
  const stableId = message.id && message.id.trim() ? message.id : randomUUID();
  // Compute ord as max(ord)+1 within the conversation for stable ordering.
  const r = await catalogPool.query<{ next_ord: number }>(
    `INSERT INTO messages (conversation_id, message_id, ord, role, parts)
       VALUES (
         $1, $2,
         COALESCE((SELECT MAX(ord) + 1 FROM messages WHERE conversation_id = $1), 0),
         $3, $4::jsonb
       )
     ON CONFLICT (conversation_id, message_id) DO UPDATE
        SET parts = EXCLUDED.parts,
            role = EXCLUDED.role
     RETURNING ord AS next_ord`,
    [conversationSlug, stableId, message.role, JSON.stringify(message.parts ?? [])],
  );
  // Touch the conversation's updated_at so the History list sorts correctly.
  await catalogPool.query(
    `UPDATE conversations SET updated_at = now() WHERE slug = $1`,
    [conversationSlug],
  );
  // If this is the FIRST user message and the conversation still has the
  // default title, use it as the title.
  if (message.role === "user" && r.rows[0]?.next_ord === 0) {
    const text = extractText(message).slice(0, 80);
    if (text) {
      await catalogPool.query(
        `UPDATE conversations
            SET title = $2
          WHERE slug = $1 AND title = 'New conversation'`,
        [conversationSlug, text],
      );
    }
  }
}

export async function loadConversation(
  conversationSlug: string,
): Promise<UIMessage[]> {
  const r = await catalogPool.query<{ message_id: string; role: string; parts: unknown }>(
    `SELECT message_id, role, parts
       FROM messages
      WHERE conversation_id = $1
      ORDER BY ord ASC`,
    [conversationSlug],
  );
  return r.rows.map((row) => ({
    id: row.message_id,
    role: row.role as UIMessage["role"],
    parts: (row.parts as UIMessage["parts"]) ?? [],
  })) as UIMessage[];
}

export async function listConversations(limit = 30): Promise<
  Array<{
    slug: string;
    title: string;
    project_slug: string | null;
    updated_at: string;
    turn_count: number;
  }>
> {
  const r = await catalogPool.query<{
    slug: string;
    title: string;
    project_slug: string | null;
    updated_at: string;
    turn_count: string;
  }>(
    `SELECT c.slug, c.title, c.project_slug, c.updated_at::text AS updated_at,
            (SELECT count(*)::text FROM messages m WHERE m.conversation_id = c.slug AND m.role = 'user') AS turn_count
       FROM conversations c
       WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.slug)
       ORDER BY c.updated_at DESC
       LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    project_slug: row.project_slug,
    updated_at: row.updated_at,
    turn_count: Number(row.turn_count ?? 0),
  }));
}

function extractText(m: UIMessage): string {
  const parts = m.parts ?? [];
  return parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();
}
