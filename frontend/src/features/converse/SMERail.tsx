/**
 * Thin avatar strip pinned at the top of the Converse view. Shows the
 * full SME roster (built-ins + user-created) and indicates which ones
 * are currently active in the running turn.
 *
 * States per avatar:
 *   - speaking · streaming right now → persona-color background + pulse
 *   - participated · spoke in this turn but finished → faint persona-color ring
 *   - idle → low-contrast pip
 *
 * Hover (title) reveals name, role, domain keywords.
 */
import { SMEIcon } from "../situation_room/icons";
import { useAllPersonas } from "../situation_room/useCustomPersonas";
import type { SMEPersona } from "../situation_room/types";

type Props = {
  /** SMEs currently streaming. */
  speaking: Set<string>;
  /** SMEs that spoke (done) in the current turn. */
  participated: Set<string>;
  /** Click an SME chip → open the detail drawer. */
  onPick?: (persona: SMEPersona) => void;
  /** Click the "+" chip → open the create-SME modal. */
  onAdd?: () => void;
};

export default function SMERail({ speaking, participated, onPick, onAdd }: Props) {
  const { personas } = useAllPersonas();

  return (
    <div className="px-6 py-2 border-b border-[var(--color-border-tertiary)] bg-[var(--bg-soft)]/60">
      <div className="max-w-[840px] mx-auto flex items-center gap-2 overflow-x-auto">
        <span className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-faint)] shrink-0 mr-1">
          SMEs
        </span>
        {personas.map((p) => {
          const isSpeaking = speaking.has(p.id);
          const hasSpoken = participated.has(p.id);
          const active = isSpeaking || hasSpoken;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick?.(p)}
              aria-label={`${p.name}, ${p.role}${
                isSpeaking ? ", currently speaking" : hasSpoken ? ", participated" : ", idle"
              }`}
              title={`${p.name} · ${p.role}${p.domain.length ? "\nDomains: " + p.domain.join(", ") : ""}`}
              className="relative shrink-0 inline-flex items-center gap-1.5 px-1.5 py-1 rounded-full transition"
              style={{
                background: active ? p.color.bg : "transparent",
                color: active ? p.color.fg : "var(--text-faint)",
                border: `0.5px solid ${
                  active ? p.color.fg + "55" : "var(--color-border-tertiary)"
                }`,
                opacity: active ? 1 : 0.7,
              }}
            >
              <span
                aria-hidden
                className="inline-flex items-center justify-center rounded-full"
                style={{
                  width: 20,
                  height: 20,
                  background: active ? p.color.fg + "1a" : "var(--bg-elev)",
                  color: active ? p.color.fg : "var(--text-muted)",
                }}
              >
                <SMEIcon name={p.icon} size={11} />
              </span>
              <span className="text-[11px] font-medium leading-none">
                {p.name}
              </span>
              {isSpeaking && (
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-full animate-pulse ml-0.5"
                  style={{ background: p.color.fg }}
                />
              )}
            </button>
          );
        })}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add a new SME"
            title="Add a new SME"
            className="shrink-0 inline-flex items-center gap-1.5 px-1.5 py-1 rounded-full transition hover:bg-[var(--bg-elev)]"
            style={{
              border: "0.5px dashed var(--color-border-tertiary)",
              color: "var(--text-faint)",
            }}
          >
            <span
              aria-hidden
              className="inline-flex items-center justify-center rounded-full text-[12px]"
              style={{
                width: 20,
                height: 20,
                background: "var(--bg-elev)",
                color: "var(--text-muted)",
              }}
            >
              +
            </span>
            <span className="text-[11px] font-medium leading-none">New SME</span>
          </button>
        )}
      </div>
    </div>
  );
}
