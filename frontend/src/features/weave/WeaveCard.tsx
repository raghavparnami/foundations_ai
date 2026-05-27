/**
 * One SME's contribution card. Sits in their own warp-column inside a
 * WeaveTurn. Border-left in the persona's color so the column geometry
 * is obvious without a heavy box.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SMEIcon } from "../situation_room/icons";
import { getPersona } from "../situation_room/fixtures";

type Props = {
  smeId: string;
  text: string;
  streaming: boolean;
  column: number; // 1-based grid column
};

export default function WeaveCard({ smeId, text, streaming, column }: Props) {
  const p = getPersona(smeId);
  const fg = p?.color.fg ?? "var(--text-muted)";
  const bg = p?.color.bg ?? "var(--bg-soft)";

  return (
    <div
      className="weave-card"
      style={{
        gridColumn: column,
        background: bg,
        borderLeft: `2px solid ${fg}`,
      }}
    >
      <div className="weave-card__head" style={{ color: fg }}>
        <span
          className="weave-card__head-tick"
          style={{ background: fg }}
        />
        {p && <SMEIcon name={p.icon} size={11} />}
        <span>{p?.name ?? smeId}</span>
        {streaming && (
          <span
            className="weave-card__pulse"
            style={{ background: fg }}
            aria-hidden
          />
        )}
      </div>
      <div className="weave-card__body markdown-doc">
        {text ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ img: () => null }}
          >
            {text}
          </ReactMarkdown>
        ) : streaming ? (
          <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>
            weaving…
          </span>
        ) : null}
      </div>
    </div>
  );
}
