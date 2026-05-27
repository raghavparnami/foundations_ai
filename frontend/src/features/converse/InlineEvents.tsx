/**
 * The "small inline" events: handshake, tool calls, synthesis summary,
 * turn-done meta. Each is a one-line dimmed row — no boxes — so they
 * read like terminal status lines in the transcript flow.
 */
import { getPersona } from "../situation_room/fixtures";
import type {
  HandshakeItem,
  SynthesisItem,
  ToolItem,
  MetaItem,
  ErrorItem,
} from "./types";

function PersonaChip({ smeId }: { smeId: string }) {
  const p = getPersona(smeId);
  if (!p) {
    return (
      <span className="font-mono text-[10.5px] px-1 py-0.5 rounded bg-[var(--bg-soft)] text-[var(--text-muted)]">
        {smeId}
      </span>
    );
  }
  return (
    <span
      className="text-[10.5px] font-medium px-1.5 py-0.5 rounded"
      style={{ background: p.color.bg, color: p.color.fg }}
    >
      {p.name}
    </span>
  );
}

export function Handshake({ item }: { item: HandshakeItem }) {
  return (
    <div className="flex items-start gap-2 my-2 text-[11.5px] text-[var(--text-muted)]">
      <span aria-hidden className="opacity-60">🤝</span>
      <span>
        Convening{" "}
        {item.smes.map((s, i) => (
          <span key={s}>
            <PersonaChip smeId={s} />
            {i < item.smes.length - 1 ? " · " : ""}
          </span>
        ))}
        {item.reason && (
          <span className="text-[var(--text-faint)] italic">
            {" "}— {item.reason}
          </span>
        )}
      </span>
    </div>
  );
}

export function Synthesis({ item }: { item: SynthesisItem }) {
  return (
    <div className="my-3 text-[12.5px] text-[var(--text)]">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider font-medium text-[var(--text-faint)]">
          Consensus
        </span>
        <span
          aria-hidden
          className="flex-1 h-px"
          style={{ background: "var(--color-border-tertiary)" }}
        />
      </div>
      <p className="mt-1 leading-snug">{item.consensus_summary || "—"}</p>
      {item.dissenters.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {item.dissenters.map((d) => (
            <li key={d.sme_id} className="flex items-baseline gap-2 text-[11.5px] text-[var(--text-muted)]">
              <PersonaChip smeId={d.sme_id} />
              <span>dissents: {d.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ToolRow({ item }: { item: ToolItem }) {
  return (
    <div className="my-1.5 ml-9 flex items-start gap-2 text-[11px] font-mono text-[var(--text-faint)]">
      <span aria-hidden className="text-[var(--accent)]">↳</span>
      <div className="min-w-0">
        <span className="text-[var(--text-muted)]">{item.name}</span>
        {Object.keys(item.args).length > 0 && (
          <span> · {summarizeArgs(item.args)}</span>
        )}
        {item.summary && (
          <span className="text-[var(--text)]"> ← {item.summary}</span>
        )}
      </div>
    </div>
  );
}

function summarizeArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 79) + "…" : s;
  } catch {
    return String(args);
  }
}

export function MetaRow({ item }: { item: MetaItem }) {
  return (
    <div className="my-3 text-[10.5px] text-[var(--text-faint)] flex items-center gap-2">
      <span aria-hidden>·</span>
      <span>
        {(item.duration_ms / 1000).toFixed(1)}s · {item.llm_calls} LLM call
        {item.llm_calls === 1 ? "" : "s"} ·{" "}
        {item.cost_usd === 0 ? "$0.00" : `$${item.cost_usd.toFixed(4)}`}
      </span>
      <span aria-hidden className="flex-1 h-px bg-[var(--color-border-tertiary)] ml-1" />
    </div>
  );
}

export function ErrorRow({ item }: { item: ErrorItem }) {
  return (
    <div className="my-2 text-[12px] text-red-500">{item.message}</div>
  );
}
