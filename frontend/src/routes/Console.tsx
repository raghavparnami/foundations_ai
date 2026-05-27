/**
 * The Console · Mission Control home.
 *
 * Wall of live SME tiles fed by /api/situation-room/snapshot. No chat
 * surface. Asking is gated by Plan Mode — top-right "Ask" button opens
 * the AskModal which shows the plan before running. The result renders
 * in a slide-out structured report panel and dismisses on close.
 */
import { useEffect, useState } from "react";
import "../features/console/console.css";
import ConsoleTile from "../features/console/ConsoleTile";
import AskModal from "../features/console/AskModal";
import ResultPanel from "../features/console/ResultPanel";
import SMEDetailDrawer from "../features/converse/SMEDetailDrawer";
import NewSMEModal from "../features/situation_room/NewSMEModal";
import { useSnapshot } from "../features/situation_room/useSnapshot";
import { useCostMeter, formatUsd } from "../features/situation_room/useCostMeter";
import { useCalibration } from "../features/situation_room/useCalibration";
import { useAllPersonas } from "../features/situation_room/useCustomPersonas";
import type { SMEPersona } from "../features/situation_room/types";

export default function Console() {
  const { snapshot } = useSnapshot();
  const meter = useCostMeter();
  const calibration = useCalibration();
  const { personas, refresh: refreshPersonas } = useAllPersonas();

  const [askOpen, setAskOpen] = useState(false);
  const [runQuestion, setRunQuestion] = useState<string | null>(null);
  const [drawerSme, setDrawerSme] = useState<SMEPersona | null>(null);
  const [showNewSme, setShowNewSme] = useState(false);

  const stationsBy = new Map(snapshot.stations.map((s) => [s.sme_id, s]));

  return (
    <main className="console-root">
      {/* Top bar */}
      <div className="console-topbar">
        <div className="console-topbar__brand">
          <span className="console-topbar__brand-mark" aria-hidden />
          <span className="console-topbar__title">Loom Console</span>
          <span className="console-topbar__sub">
            {personas.length} expert{personas.length === 1 ? "" : "s"} on duty
          </span>
        </div>

        <div className="console-topbar__center">
          <button
            type="button"
            className="console-topbar__ask"
            onClick={() => setAskOpen(true)}
            title="Plan a query (⌘K)"
          >
            <span aria-hidden style={{ fontSize: 13 }}>✦</span>
            Ask Loom
            <kbd>⌘K</kbd>
          </button>
        </div>

        <div className="console-topbar__meta">
          {meter && (
            <span>
              {formatUsd(meter.total.cost_usd)} · {meter.total.calls} calls
            </span>
          )}
        </div>
      </div>

      {/* Tile wall */}
      <div className="console-wall">
        <div className="console-wall__strap">
          <span>Live findings</span>
          <span className="console-wall__strap-rule" />
          <span style={{ color: "var(--text-faint)" }}>
            updated every 60s · click a tile to teach or inspect
          </span>
        </div>

        <div className="console-grid">
          {personas.map((p) => (
            <ConsoleTile
              key={p.id}
              persona={p}
              station={stationsBy.get(p.id) ?? undefined}
              calibration={calibration[p.id] ?? null}
              spend={meter?.by_sme?.[p.id] ?? null}
              onClick={() => setDrawerSme(p)}
            />
          ))}

          <button
            type="button"
            className="console-tile console-tile--add"
            onClick={() => setShowNewSme(true)}
          >
            <span className="console-tile--add__plus" aria-hidden>
              +
            </span>
            <span style={{ fontWeight: 500 }}>Add a new expert</span>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-faint)",
                marginTop: 4,
                textAlign: "center",
              }}
            >
              Persona + domain · teach-only mode
            </span>
          </button>
        </div>
      </div>

      {/* Hotkey to open Ask */}
      <GlobalHotkey onAsk={() => setAskOpen(true)} />

      {askOpen && (
        <AskModal
          onCancel={() => setAskOpen(false)}
          onApprove={(q) => {
            setAskOpen(false);
            setRunQuestion(q);
          }}
        />
      )}

      {runQuestion && (
        <ResultPanel
          question={runQuestion}
          onClose={() => setRunQuestion(null)}
        />
      )}

      {drawerSme && (
        <SMEDetailDrawer
          persona={drawerSme}
          spend={meter?.by_sme?.[drawerSme.id] ?? null}
          calibration={calibration[drawerSme.id] ?? null}
          onClose={() => setDrawerSme(null)}
          onDeleted={() => void refreshPersonas()}
        />
      )}

      {showNewSme && (
        <NewSMEModal
          onClose={() => setShowNewSme(false)}
          onCreated={() => void refreshPersonas()}
        />
      )}
    </main>
  );
}

function GlobalHotkey({ onAsk }: { onAsk: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      onAsk();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAsk]);
  return null;
}
