/**
 * SSE client for POST /api/sme/deliberate — the Standing Meeting fast lane.
 *
 * Same shape as `streamChat` in lib/chat.ts but emits only delta/done/error
 * events (no tool_start/tool_output because this endpoint doesn't run the
 * agent loop). Latency: 3-8s/column vs the 30s+ of the full agent.
 */
import { apiUrl } from "../../lib/api";

export type DeliberateEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type DeliberateRequest = {
  sme_id: string;
  question: string;
  persona_prompt: string;
  context_finding?: string | null;
};

export async function* streamDeliberate(
  req: DeliberateRequest,
  signal?: AbortSignal,
): AsyncGenerator<DeliberateEvent> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/sme/deliberate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (e) {
    yield { type: "error", message: (e as Error).message };
    return;
  }

  if (!res.ok || !res.body) {
    yield { type: "error", message: `HTTP ${res.status}` };
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let frameEnd: number;
    while ((frameEnd = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, frameEnd);
      buf = buf.slice(frameEnd + 2);
      const ev = parseFrame(raw);
      if (ev) yield ev;
    }
  }
}

function parseFrame(raw: string): DeliberateEvent | null {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    const j = JSON.parse(data) as Record<string, unknown>;
    if (event === "delta" && typeof j["text"] === "string") {
      return { type: "delta", text: j["text"] };
    }
    if (event === "done") return { type: "done" };
    if (event === "error" && typeof j["message"] === "string") {
      return { type: "error", message: j["message"] };
    }
  } catch {
    /* ignore malformed frame */
  }
  return null;
}
