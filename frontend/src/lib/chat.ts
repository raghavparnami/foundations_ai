/**
 * SSE event-stream parser for POST /api/chat. EventSource only supports GET,
 * so we use fetch + ReadableStream and parse the `event: <name>\ndata: <json>`
 * frames ourselves.
 *
 * Yields typed events. Caller `for await`s and updates UI state per event.
 */
export type ChatStreamEvent =
  | {
      type: "tool_start";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | { type: "tool_output"; id: string; name: string; output: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
};

export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal,
  conversationId?: string,
): AsyncGenerator<ChatStreamEvent> {
  // See lib/api.ts for the full priority order — same logic, inlined so the
  // streaming endpoint can be hit before the api module loads.
  const BUILD_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim();
  const runtimeRaw =
    (typeof window !== "undefined" &&
      (window as Window & { __LOOM_API_BASE__?: string }).__LOOM_API_BASE__) ||
    "";
  const RUNTIME_BASE = runtimeRaw.startsWith("http") ? runtimeRaw : "";
  const API_BASE = (RUNTIME_BASE || BUILD_BASE).replace(/\/$/, "");
  const chatUrl = API_BASE ? `${API_BASE}/api/chat` : "/api/chat";
  let res: Response;
  try {
    res = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        conversation_id: conversationId ?? null,
      }),
      signal,
    });
  } catch (e) {
    // Abort is a normal end-of-stream from the caller's perspective.
    if ((e as DOMException)?.name === "AbortError") return;
    yield { type: "error", message: String(e) };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: "error", message: `HTTP ${res.status}` };
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseFrame(frame);
        if (ev) yield ev;
      }
    }
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return;
    throw e;
  }
}

function parseFrame(frame: string): ChatStreamEvent | null {
  let event = "";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!event) return null;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = data ? JSON.parse(data) : {};
  } catch {
    return null;
  }
  switch (event) {
    case "tool_start":
      return {
        type: "tool_start",
        id: String(parsed.id ?? ""),
        name: String(parsed.name ?? ""),
        args: (parsed.args ?? {}) as Record<string, unknown>,
      };
    case "tool_output":
      return {
        type: "tool_output",
        id: String(parsed.id ?? ""),
        name: String(parsed.name ?? ""),
        output: String(parsed.output ?? ""),
      };
    case "delta":
      return { type: "delta", text: String(parsed.text ?? "") };
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", message: String(parsed.message ?? "") };
    default:
      return null;
  }
}
