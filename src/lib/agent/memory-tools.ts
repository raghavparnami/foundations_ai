/**
 * Memory tools for the chat agent.
 *
 *  - remember(content, kind, importance, scope) — save a durable memory
 *  - recall(query) — explicit lookup when the auto-inject missed
 *  - pin_fact(fact) — record a constraint scoped to THIS conversation
 *
 * Auto-injection (matched long-term memories + conversation summary) is
 * handled in `system-prompt.ts`; these tools exist for the agent to
 * proactively curate memory rather than only consume it.
 */
import { tool } from "ai";
import { z } from "zod";
import { insertMemory, matchMemories, pinFact } from "../catalog/memories";
import { audit } from "../catalog/queries";

const SCOPES = ["user", "workspace"] as const;
const KINDS = ["preference", "fact", "rule", "glossary", "other"] as const;

export function memoryTools(opts: { conversationId: string }) {
  return {
    remember: tool({
      description:
        "Save a durable memory the agent should recall on future turns AND future conversations. Use this when the user states a preference (\"always group by line first\"), establishes a business rule (\"a run is failed when units_produced < 0.9 * units_target\"), or defines a term (\"Q1 = Feb–Apr fiscal\"). Picks: scope=user for personal preferences, scope=workspace for shared business rules. Kind=preference|fact|rule|glossary|other.",
      inputSchema: z.object({
        scope: z.enum(SCOPES).describe("user = personal preference; workspace = shared business rule/glossary"),
        kind: z.enum(KINDS),
        content: z
          .string()
          .min(8)
          .max(400)
          .describe("One declarative sentence. Will appear verbatim in every relevant system prompt."),
        importance: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(3)
          .describe("1=trivia, 3=normal, 5=critical-always-relevant"),
      }),
      execute: async ({ scope, kind, content, importance }) => {
        const m = await insertMemory({
          scope,
          kind,
          content,
          importance,
          source: "agent",
          conversation_id: opts.conversationId,
        });
        await audit("agent", "memory:remember", String(m.id), {
          conversationId: opts.conversationId,
          scope,
          kind,
          importance,
          bytes: content.length,
        });
        return { ok: true, id: m.id, scope, kind, importance };
      },
    }),

    recall: tool({
      description:
        "Search the agent's long-term memory for items relevant to a query. Use this when you suspect a memory exists but didn't appear in the auto-injected set — for example, the user references something from a past conversation.",
      inputSchema: z.object({
        query: z.string().min(3).max(200),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ query, limit }) => {
        const rows = await matchMemories(query, limit);
        await audit("agent", "memory:recall", null, {
          conversationId: opts.conversationId,
          query: query.slice(0, 200),
          hits: rows.length,
        });
        return {
          query,
          hits: rows.map((r) => ({
            id: r.id,
            scope: r.scope,
            kind: r.kind,
            content: r.content,
            importance: r.importance,
          })),
        };
      },
    }),

    pin_fact: tool({
      description:
        "Record a constraint scoped to THIS conversation only — e.g. \"this analysis focuses on LINE-B\", \"we agreed to exclude test runs\". Pinned facts ride in the system prompt for the rest of the conversation but DO NOT leak to other chats. Use this instead of `remember` when the constraint is per-question, not durable.",
      inputSchema: z.object({
        fact: z.string().min(8).max(240),
      }),
      execute: async ({ fact }) => {
        await pinFact(opts.conversationId, fact);
        await audit("agent", "memory:pin", null, {
          conversationId: opts.conversationId,
          fact: fact.slice(0, 240),
        });
        return { ok: true, conversation_id: opts.conversationId, fact };
      },
    }),
  };
}
