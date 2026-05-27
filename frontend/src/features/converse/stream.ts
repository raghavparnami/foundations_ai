/**
 * SSE client for POST /api/converse. Yields typed ConverseEvents.
 *
 * Shape mirrors lib/chat.ts: fetch → ReadableStream → text decoder →
 * `event: <name>\ndata: <json>` frame parser. EventSource only does GET.
 */
import { apiUrl } from "../../lib/api";
import type { ConverseEvent } from "./types";

export type ConverseRequest = {
  question: string;
  conversation_id?: string;
};

export async function* streamConverse(
  req: ConverseRequest,
  signal?: AbortSignal,
): AsyncGenerator<ConverseEvent> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/converse"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (e) {
    yield {
      type: "error",
      msg_id: "",
      message: (e as Error).message,
    };
    return;
  }
  if (!res.ok || !res.body) {
    yield {
      type: "error",
      msg_id: "",
      message: `HTTP ${res.status}`,
    };
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let frameEnd: number;
    while ((frameEnd = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, frameEnd);
      buf = buf.slice(frameEnd + 2);
      const ev = parseFrame(raw);
      if (ev) yield ev;
    }
  }
}

function parseFrame(raw: string): ConverseEvent | null {
  let event = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    const j = JSON.parse(data) as Record<string, unknown>;
    // Stamp the union type from the event name.
    return { type: event as ConverseEvent["type"], ...(j as object) } as ConverseEvent;
  } catch {
    return null;
  }
}
