/**
 * Plan-Mode Ask modal.
 *
 * Replaces the chat input. The user types a question OR picks an intent
 * preset. While they type (debounced), we ping a router preview that
 * estimates the plan — which SMEs will be called, how many LLM calls,
 * approximate cost. The user reviews and clicks Approve to execute.
 *
 * No chat history. No transcript. No streaming text into a thread.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { getPersona } from "../situation_room/fixtures";
import { useAllPersonas } from "../situation_room/useCustomPersonas";
import { SMEIcon } from "../situation_room/icons";

type Intent = {
  label: string;
  prompt: string;
};

const INTENT_PRESETS: Intent[] = [
  { label: "Diagnose pump 7", prompt: "Why is Pump 7 vibrating? Should we pull it now?" },
  { label: "Rank lines by OEE", prompt: "Rank the production lines by OEE in the last 30 days." },
  { label: "Quality drift today", prompt: "Which quality parameter has drifted most today?" },
  { label: "Equipment to service", prompt: "Which equipment most needs service in the next 36 hours?" },
  { label: "Unresolved critical", prompt: "Summarise unresolved critical deviations and who should act." },
  { label: "Shift handoff", prompt: "Draft a shift handoff note for the next operator." },
];

type Plan = {
  route: "smes" | "direct";
  smes: string[];
  reason: string;
  estimated_cost_usd: number;
  estimated_seconds: number;
};

type Props = {
  onCancel: () => void;
  onApprove: (question: string) => void;
};

export default function AskModal({ onCancel, onApprove }: Props) {
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const { personas } = useAllPersonas();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);

  // Debounced router preview as the user types (300ms quiet).
  useEffect(() => {
    if (q.trim().length < 6) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setPlanning(true);
      try {
        const p = await api.post<Plan>("/api/converse/preview", { question: q.trim() });
        if (!cancelled) setPlan(p);
      } catch {
        if (!cancelled) setPlan(null);
      } finally {
        if (!cancelled) setPlanning(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q]);

  function approve() {
    const t = q.trim();
    if (!t) return;
    onApprove(t);
  }

  return (
    <div className="ask-modal__backdrop" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        className="ask-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ask-modal__head">
          <span className="ask-modal__head-label" id="ask-title">
            Plan a query · Loom will preview before running
          </span>
          <button type="button" onClick={onCancel} className="ask-modal__close">
            Esc
          </button>
        </div>

        <div className="ask-modal__input-row">
          <span aria-hidden className="ask-modal__caret">
            ❯
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && plan) {
                e.preventDefault();
                approve();
              }
            }}
            placeholder="describe what you want to know…"
            className="ask-modal__input"
          />
        </div>

        {q.trim().length < 6 && (
          <div className="ask-modal__intents">
            <div className="ask-modal__intents-label">Or pick an intent</div>
            {INTENT_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="ask-modal__intent"
                onClick={() => setQ(p.prompt)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {q.trim().length >= 6 && (
          <div className="ask-modal__plan">
            <div className="ask-modal__plan-label">
              Plan
              {planning && <span className="ask-modal__plan-spinner" />}
            </div>
            {!plan && !planning ? (
              <div className="ask-modal__plan-empty">
                Loom couldn't draft a plan. Try rewording the question.
              </div>
            ) : !plan ? (
              <div className="ask-modal__plan-empty">drafting…</div>
            ) : (
              <PlanSteps plan={plan} personas={personas} />
            )}
          </div>
        )}

        <div className="ask-modal__foot">
          <button
            type="button"
            className="ask-modal__btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ask-modal__btn ask-modal__btn--primary"
            disabled={!q.trim() || planning}
            onClick={approve}
          >
            {q.trim() ? "Approve & run" : "Type a question…"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanSteps({
  plan,
  personas,
}: {
  plan: Plan;
  personas: { id: string; name: string }[];
}) {
  const smeBlocks: { num: number; label: string; sme?: string }[] = [];
  if (plan.route === "smes") {
    smeBlocks.push({
      num: 1,
      label: `Convene ${plan.smes
        .map((s) => personas.find((p) => p.id === s)?.name ?? s)
        .join(", ")} — ${plan.reason || "domain match"}`,
    });
    plan.smes.forEach((sid, i) => {
      smeBlocks.push({
        num: 2 + i,
        label: `${personas.find((p) => p.id === sid)?.name ?? sid} reads the catalog and drafts a view`,
        sme: sid,
      });
    });
    if (plan.smes.length >= 2) {
      smeBlocks.push({
        num: 2 + plan.smes.length,
        label: "Synthesize a consensus and flag any disagreement",
      });
    }
    smeBlocks.push({
      num: 2 + plan.smes.length + (plan.smes.length >= 2 ? 1 : 0),
      label: "Loom writes a wrap-up naming the decision and trade-off",
    });
  } else {
    smeBlocks.push({ num: 1, label: "Loom answers directly · no panel needed" });
  }

  return (
    <>
      <ul className="ask-modal__plan-steps">
        {smeBlocks.map((b) => {
          const persona = b.sme ? getPersona(b.sme) : null;
          return (
            <li key={b.num} className="ask-modal__plan-step">
              <span className="ask-modal__plan-step-num">{b.num}</span>
              <span style={{ flex: 1 }}>
                {b.label}
              </span>
              {persona && (
                <span
                  aria-hidden
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: persona.color.bg,
                    color: persona.color.fg,
                    flex: "0 0 auto",
                  }}
                >
                  <SMEIcon name={persona.icon} size={11} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="ask-modal__plan-meta">
        ~{plan.estimated_seconds.toFixed(0)}s · ~${plan.estimated_cost_usd.toFixed(4)}
      </div>
    </>
  );
}
