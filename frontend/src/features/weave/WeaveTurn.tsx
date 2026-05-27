/**
 * One turn = one weft. Renders:
 *   - the user question header (full-width)
 *   - SME contribution cards (each in their own warp column)
 *   - synthesis ribbon (full-width)
 *   - Loom wrap-up (center band)
 *   - meta line (cost, duration, calls)
 *
 * Layout is CSS Grid with N columns mirroring the warps in the header.
 * SME cards are placed by `gridColumn = idx + 1`.
 */
import { useMemo } from "react";
import WeaveCard from "./WeaveCard";
import { getPersona } from "../situation_room/fixtures";
import type { TranscriptItem } from "../converse/types";

type Props = {
  items: TranscriptItem[]; // slice belonging to this turn
  threadIds: string[];
  busy: boolean;
  isFirst: boolean;
};

export default function WeaveTurn({ items, threadIds, busy, isFirst }: Props) {
  const view = useMemo(() => buildView(items), [items]);

  const speakerCount = view.smeContribs.length;
  // When ≤3 SMEs speak, give each card real width (full / half / third).
  // At 4+ we fall back to thread-aligned columns so the geometry still
  // mirrors the warp ordering.
  const useThreadAligned = speakerCount >= 4;
  const cols = useThreadAligned
    ? threadIds.length
    : Math.max(1, speakerCount);

  return (
    <section
      className={"weave-turn " + (isFirst ? "weave-turn--first" : "")}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {view.question && (
        <div className="weave-turn__question">
          <span className="weave-turn__question-text">{view.question}</span>
        </div>
      )}

      {view.smeContribs.map((c, idx) => {
        const col = useThreadAligned
          ? threadIds.indexOf(c.smeId) + 1
          : idx + 1;
        if (col < 1) return null;
        return (
          <WeaveCard
            key={c.smeId}
            smeId={c.smeId}
            text={c.text}
            streaming={!c.done && busy}
            column={col}
          />
        );
      })}

      {view.synthesis && (
        <div className="weave-synth">
          <span className="weave-synth__rule" />
          <span className="weave-synth__label">Consensus</span>
          <div className="weave-synth__text">
            {view.synthesis.consensus_summary || "—"}
            {view.synthesis.dissenters.length > 0 && (
              <div className="weave-synth__dissenters">
                {view.synthesis.dissenters.map((d) => {
                  const p = getPersona(d.sme_id);
                  return (
                    <span
                      key={d.sme_id}
                      className="weave-synth__dissenter"
                      title={d.reason}
                      style={{
                        color: p?.color.fg ?? "var(--text-muted)",
                        borderColor:
                          (p?.color.fg ?? "var(--text-muted)") + "55",
                      }}
                    >
                      {p?.name ?? d.sme_id} ≠ {d.reason.slice(0, 40)}
                      {d.reason.length > 40 ? "…" : ""}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {view.loomWrap && (
        <div className="weave-loom">
          <span aria-hidden className="weave-loom__mark" />
          <div className="weave-loom__text">
            {view.loomWrap}
            {view.meta && (
              <div className="weave-loom__meta">
                {(view.meta.duration_ms / 1000).toFixed(1)}s ·{" "}
                {view.meta.llm_calls} LLM call
                {view.meta.llm_calls === 1 ? "" : "s"} ·{" "}
                {view.meta.cost_usd === 0
                  ? "$0.00"
                  : `$${view.meta.cost_usd.toFixed(4)}`}
              </div>
            )}
          </div>
        </div>
      )}

      {!view.loomWrap && view.meta && (
        <div className="weave-loom">
          <span aria-hidden className="weave-loom__mark" />
          <div className="weave-loom__text">
            <span style={{ color: "var(--text-faint)" }}>
              done · {(view.meta.duration_ms / 1000).toFixed(1)}s ·{" "}
              {view.meta.llm_calls} LLM call · $
              {view.meta.cost_usd.toFixed(4)}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

type View = {
  question: string | null;
  smeContribs: { smeId: string; text: string; done: boolean }[];
  synthesis: {
    consensus_summary: string;
    dissenters: { sme_id: string; reason: string }[];
  } | null;
  loomWrap: string | null;
  meta: { duration_ms: number; cost_usd: number; llm_calls: number } | null;
};

function buildView(items: TranscriptItem[]): View {
  let question: string | null = null;
  const smeMap = new Map<string, { text: string; done: boolean }>();
  let synthesis: View["synthesis"] = null;
  let loomBuf = "";
  let loomSeen = false;
  let synthSeen = false;
  let meta: View["meta"] = null;

  for (const it of items) {
    if (it.kind === "speech") {
      if (it.speaker.kind === "user") {
        question = it.text;
      } else if (it.speaker.kind === "sme") {
        const sid = it.speaker.sme_id;
        smeMap.set(sid, { text: it.text, done: it.done });
      } else if (it.speaker.kind === "loom") {
        // Loom speech AFTER synthesis is the wrap-up; before, ignore for now.
        if (synthSeen) {
          loomBuf += (loomBuf ? "\n\n" : "") + it.text;
          loomSeen = true;
        } else {
          // Direct route — no synthesis. Treat as loom wrap regardless.
          loomBuf += (loomBuf ? "\n\n" : "") + it.text;
          loomSeen = true;
        }
      }
    } else if (it.kind === "synthesis") {
      synthSeen = true;
      synthesis = {
        consensus_summary: it.consensus_summary,
        dissenters: it.dissenters,
      };
    } else if (it.kind === "meta") {
      meta = {
        duration_ms: it.duration_ms,
        cost_usd: it.cost_usd,
        llm_calls: it.llm_calls,
      };
    }
  }

  return {
    question,
    smeContribs: Array.from(smeMap.entries()).map(([smeId, v]) => ({
      smeId,
      text: v.text,
      done: v.done,
    })),
    synthesis,
    loomWrap: loomSeen ? loomBuf : null,
    meta,
  };
}
