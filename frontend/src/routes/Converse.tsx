/**
 * Converse — the new home surface. Single-column streaming transcript:
 *   user → Loom thinks → handshake → SMEs speak in parallel → synthesis
 *   → Loom wraps up → turn_done meta.
 *
 * Replaces the old SR grid + Standing Meeting boxes. Built around the
 * /api/converse SSE endpoint.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { streamConverse } from "../features/converse/stream";
import Transcript from "../features/converse/Transcript";
import ComposerBar from "../features/converse/ComposerBar";
import type {
  ConverseEvent,
  TranscriptItem,
  SpeechItem,
} from "../features/converse/types";
import { SME_ROSTER, getPersona } from "../features/situation_room/fixtures";
import { useCostMeter, formatUsd } from "../features/situation_room/useCostMeter";

type Suggestion = { text: string; sme?: string };

const HERO_SUGGESTIONS: Suggestion[] = [
  { text: "What's our deviation rate by line in the last 30 days?", sme: "marcus" },
  { text: "Why is Pump 7 vibrating? Should we pull it now?", sme: "iris" },
  { text: "Which quality parameter is drifting most this week?", sme: "quinn" },
  { text: "List the equipment that needs service soon.", sme: "mason" },
];

export default function Converse() {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [liveCostUsd, setLiveCostUsd] = useState(0);
  const meter = useCostMeter();
  const abortRef = useRef<AbortController | null>(null);

  const empty = items.length === 0;

  const append = useCallback((item: TranscriptItem) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const updateSpeech = useCallback(
    (id: string, mutator: (s: SpeechItem & { kind: "speech" }) => SpeechItem & { kind: "speech" }) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id && it.kind === "speech" ? mutator(it) : it)),
      );
    },
    [],
  );

  function speechKey(msgId: string, who: string): string {
    return `${msgId}:${who}`;
  }

  const send = useCallback(
    async (text: string) => {
      const ctrl = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ctrl;
      setBusy(true);
      setLiveCostUsd(0);

      // Speech state by key
      const speechIds = new Map<string, string>(); // key → item id

      try {
        for await (const ev of streamConverse({ question: text }, ctrl.signal)) {
          handleEvent(ev);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          append({
            id: cryptoRandom(),
            kind: "error",
            msg_id: "",
            message: (e as Error).message,
          });
        }
      } finally {
        if (abortRef.current === ctrl) {
          abortRef.current = null;
          setBusy(false);
        }
      }

      function handleEvent(ev: ConverseEvent) {
        switch (ev.type) {
          case "user_message": {
            const id = cryptoRandom();
            append({
              id,
              kind: "speech",
              speaker: { kind: "user" },
              text: ev.text,
              started_at: Date.now(),
              done: true,
            });
            return;
          }
          case "agent_speak": {
            const key = speechKey(ev.msg_id, "loom");
            let id = speechIds.get(key);
            if (!id) {
              id = cryptoRandom();
              speechIds.set(key, id);
              append({
                id,
                kind: "speech",
                speaker: { kind: "loom" },
                text: ev.text,
                started_at: Date.now(),
                done: false,
              });
            } else {
              const itemId = id;
              updateSpeech(itemId, (s) => ({ ...s, text: s.text + ev.text }));
            }
            return;
          }
          case "handshake": {
            append({
              id: cryptoRandom(),
              kind: "handshake",
              msg_id: ev.msg_id,
              smes: ev.smes,
              reason: ev.reason,
            });
            return;
          }
          case "sme_start": {
            const key = speechKey(ev.msg_id, ev.sme_id);
            if (speechIds.has(key)) return;
            const id = cryptoRandom();
            speechIds.set(key, id);
            append({
              id,
              kind: "speech",
              speaker: { kind: "sme", sme_id: ev.sme_id },
              text: "",
              started_at: Date.now(),
              done: false,
            });
            return;
          }
          case "sme_delta": {
            const key = speechKey(ev.msg_id, ev.sme_id);
            const id = speechIds.get(key);
            if (!id) return;
            updateSpeech(id, (s) => ({ ...s, text: s.text + ev.text }));
            return;
          }
          case "sme_done": {
            const key = speechKey(ev.msg_id, ev.sme_id);
            const id = speechIds.get(key);
            if (!id) return;
            updateSpeech(id, (s) => ({ ...s, done: true }));
            return;
          }
          case "tool_call":
          case "tool_output": {
            // For v1 we treat tool_output as augmenting the most recent
            // matching tool_call. Simple append for now.
            append({
              id: cryptoRandom(),
              kind: "tool",
              msg_id: ev.msg_id,
              agent_id: ev.agent_id,
              name: ev.name,
              args: ev.type === "tool_call" ? ev.args : {},
              summary: ev.type === "tool_output" ? ev.summary : undefined,
            });
            return;
          }
          case "synthesis": {
            // Close any still-open SME speeches (defensive)
            setItems((prev) =>
              prev.map((it) =>
                it.kind === "speech" && it.speaker.kind === "sme" && !it.done
                  ? { ...it, done: true }
                  : it,
              ),
            );
            append({
              id: cryptoRandom(),
              kind: "synthesis",
              msg_id: ev.msg_id,
              consensus_summary: ev.consensus_summary,
              dissenters: ev.dissenters,
            });
            return;
          }
          case "turn_done": {
            setItems((prev) =>
              prev.map((it) =>
                it.kind === "speech" && !it.done ? { ...it, done: true } : it,
              ),
            );
            append({
              id: cryptoRandom(),
              kind: "meta",
              msg_id: ev.msg_id,
              duration_ms: ev.duration_ms,
              cost_usd: ev.cost_usd,
              llm_calls: ev.llm_calls,
            });
            setLiveCostUsd((c) => c + ev.cost_usd);
            return;
          }
          case "error": {
            append({
              id: cryptoRandom(),
              kind: "error",
              msg_id: ev.msg_id,
              message: ev.message,
            });
            return;
          }
        }
      }
    },
    [append, updateSpeech],
  );

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }

  return (
    <main className="flex flex-col flex-1 min-h-0 bg-[var(--bg)]">
      <TopRail meter={meter} />
      {empty ? (
        <Empty onPick={(s) => void send(s)} />
      ) : (
        <Transcript items={items} busy={busy} />
      )}
      <ComposerBar
        busy={busy}
        liveCostUsd={liveCostUsd}
        onSubmit={(t) => void send(t)}
        onStop={stop}
      />
    </main>
  );
}

function TopRail({
  meter,
}: {
  meter: ReturnType<typeof useCostMeter>;
}) {
  return (
    <div className="px-6 py-2 flex items-center justify-between text-[11px] text-[var(--text-faint)]">
      <div className="flex items-center gap-3">
        <span className="font-medium text-[var(--text-muted)] uppercase tracking-wider">
          Loom
        </span>
        <span aria-hidden>·</span>
        <span>{SME_ROSTER.length} SMEs available</span>
      </div>
      {meter && (
        <span className="font-mono">
          {formatUsd(meter.total.cost_usd)} · {meter.total.calls} call{meter.total.calls === 1 ? "" : "s"} this shift
        </span>
      )}
    </div>
  );
}

function Empty({ onPick }: { onPick: (text: string) => void }) {
  const presets = useMemo(() => HERO_SUGGESTIONS, []);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10">
      <div className="max-w-[680px] mx-auto flex flex-col items-center text-center gap-5">
        <span
          aria-hidden
          className="inline-block"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--gradient-hero)",
            boxShadow: "0 6px 18px -4px rgba(91,108,255,0.45)",
          }}
        />
        <h1 className="text-[22px] font-medium leading-tight text-[var(--text)]">
          What should we look into?
        </h1>
        <p className="text-[12.5px] text-[var(--text-muted)] max-w-[460px]">
          One conversation. Loom decides whether to answer directly or convene
          the right SMEs — you'll see the handshake.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full mt-2">
          {presets.map((p) => {
            const persona = p.sme ? getPersona(p.sme) : null;
            return (
              <button
                key={p.text}
                type="button"
                onClick={() => onPick(p.text)}
                className="text-left rounded-xl px-3.5 py-3 transition hover:shadow-[0_2px_12px_rgba(20,21,42,0.05)]"
                style={{
                  background: "var(--color-background-primary)",
                  border: "0.5px solid var(--color-border-tertiary)",
                }}
              >
                <div className="text-[12.5px] text-[var(--text)] leading-snug">
                  {p.text}
                </div>
                {persona && (
                  <div className="mt-1.5 text-[10.5px]" style={{ color: persona.color.fg }}>
                    likely {persona.name}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="text-[10.5px] text-[var(--text-faint)] mt-3">
          Try <code className="px-1 py-0.5 rounded bg-[var(--bg-soft)]">@Marcus</code>{" "}
          <code className="px-1 py-0.5 rounded bg-[var(--bg-soft)]">@IRIS</code> etc. to go straight to one SME.
        </div>
      </div>
    </div>
  );
}

function cryptoRandom(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

