import { NextRequest } from "next/server";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { runAgent } from "@/lib/agent/run";
import { audit } from "@/lib/catalog/queries";
import { catalogPool } from "@/lib/catalog/db";
import { ensureConversation, persistMessage } from "@/lib/catalog/messages";
import { autoProposeMissedViews } from "@/lib/agent/auto-propose-view";
import { maybeSummarizeConversation } from "@/lib/worker/summarize-conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    id?: string;
    projectSlug?: string | null;
  };
  const conversationId = body.id ?? "anon";
  const uiMessages = body.messages ?? [];
  const projectSlug = body.projectSlug && body.projectSlug !== "__all__" ? body.projectSlug : null;

  const lastText = lastUserText(uiMessages) ?? "";
  await audit("user", "chat:turn", projectSlug, {
    conversationId,
    projectSlug,
    lastText: lastText.slice(0, 200),
  });

  // Persistence: ensure conversation row exists and save the latest user
  // message before invoking the model. (Older user messages were already
  // saved on their respective turns — same UPSERT-on-conflict logic.)
  await ensureConversation(conversationId, lastText, projectSlug);
  const latestUser = uiMessages.filter((m) => m.role === "user").at(-1);
  if (latestUser) {
    try {
      await persistMessage(conversationId, latestUser);
    } catch (e) {
      console.warn("[chat] persist user message failed", e);
    }
  }

  // Wait-for-ready gate: if the catalog isn't sufficiently prepared, return a
  // friendly "still preparing" message instead of running the agent.
  const readiness = await checkReadiness();
  if (!readiness.ready) {
    return preparingResponse(readiness);
  }

  const messages = await convertToModelMessages(uiMessages);
  const result = await runAgent({ messages, conversationId, lastUserText: lastText, projectSlug });
  return result.toUIMessageStreamResponse({
    // AI SDK v6 fires onFinish once the stream ends. Two responsibilities:
    //   1. Persist the assistant message verbatim (so refresh restores it).
    //   2. Safety-net view creation: if the model ran a view-worthy query
    //      but forgot to call propose_view, we create the view server-side.
    onFinish: async ({ responseMessage }) => {
      try {
        await persistMessage(conversationId, responseMessage as UIMessage);
      } catch (e) {
        console.warn("[chat] persist assistant message failed", e);
      }
      try {
        await autoProposeMissedViews(responseMessage as UIMessage, conversationId, lastText);
      } catch (e) {
        console.warn("[chat] auto-propose-view failed", e);
      }
      // Fire-and-forget: condense old turns into conversations.summary_md if
      // we've gone N turns since the last summary. Short-term memory layer.
      void maybeSummarizeConversation(conversationId).catch((e) =>
        console.warn("[chat] conv summary failed", e),
      );
    },
  });
}

async function checkReadiness(): Promise<{ ready: boolean; total: number; readyCount: number }> {
  const r = await catalogPool.query<{ total: string; ready: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE status = 'ready')::text AS ready
       FROM tables`,
  );
  const total = Number(r.rows[0]?.total ?? 0);
  const readyCount = Number(r.rows[0]?.ready ?? 0);
  // Require at least one source table and >=50% ready before we let the agent run.
  const ready = total > 0 && readyCount / total >= 0.5;
  return { ready, total, readyCount };
}

function preparingResponse(r: { total: number; readyCount: number }) {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const id = "preparing-" + Date.now();
      const msg =
        r.total === 0
          ? "Loom hasn't finished connecting to the source yet — give it a few seconds and try again."
          : `Loom is still preparing: ${r.readyCount} of ${r.total} tables ready. Give it a few seconds and try again — the catalog panel on the right shows live progress.`;
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: msg });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function lastUserText(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const text = m.parts
      ?.map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .slice(0, 200);
    return text ?? null;
  }
  return null;
}
