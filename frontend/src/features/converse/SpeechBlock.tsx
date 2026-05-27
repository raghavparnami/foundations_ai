/**
 * One speaker turn — user, Loom, or an SME. Renders the avatar pip on
 * the left, name + role above, streaming markdown body below.
 *
 * No "boxes" — just a left-color stripe + indented text, so multiple
 * blocks stack into a clean transcript.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SMEIcon } from "../situation_room/icons";
import { getPersona } from "../situation_room/fixtures";
import type { SpeechItem, Speaker } from "./types";

type Props = {
  item: SpeechItem & { kind: "speech" };
  streaming?: boolean;
};

export default function SpeechBlock({ item, streaming }: Props) {
  const { speaker, text } = item;
  const meta = describeSpeaker(speaker);

  if (speaker.kind === "user") {
    return (
      <div className="flex justify-end my-3">
        <div
          className="max-w-[78%] px-4 py-2 rounded-2xl text-[14px] text-[var(--text)]"
          style={{
            background: "var(--user-bg)",
            border: "0.5px solid var(--user-border)",
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 my-3">
      {/* Avatar + color stripe */}
      <div className="flex flex-col items-center shrink-0">
        <span
          aria-hidden
          className="inline-flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 30,
            height: 30,
            background: meta.bg,
            color: meta.fg,
          }}
        >
          {meta.icon}
        </span>
        <span
          aria-hidden
          className="flex-1 mt-1 w-px"
          style={{
            background: streaming ? meta.fg : "transparent",
            opacity: streaming ? 0.35 : 0,
            minHeight: 8,
          }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 leading-none">
          <span
            className="text-[12.5px] font-medium"
            style={{ color: meta.fg }}
          >
            {meta.name}
          </span>
          {meta.role && (
            <span className="text-[10.5px] text-[var(--text-faint)]">
              {meta.role}
            </span>
          )}
          {streaming && (
            <span
              aria-hidden
              className="inline-block w-1 h-1 rounded-full animate-pulse"
              style={{ background: meta.fg }}
            />
          )}
        </div>
        <div className="mt-1 text-[13.5px] text-[var(--text)] leading-relaxed markdown-doc">
          {text ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ img: () => null }}
            >
              {text}
            </ReactMarkdown>
          ) : streaming ? (
            <span className="text-[var(--text-faint)] italic">…</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function describeSpeaker(speaker: Speaker): {
  name: string;
  role: string;
  bg: string;
  fg: string;
  icon: React.ReactElement;
} {
  if (speaker.kind === "loom") {
    return {
      name: "Loom",
      role: "Orchestrator",
      bg: "#1a1d2e",
      fg: "#e8e9f0",
      icon: <LoomMark />,
    };
  }
  const p = getPersona(speaker.sme_id);
  if (!p) {
    return {
      name: speaker.sme_id,
      role: "",
      bg: "var(--bg-soft)",
      fg: "var(--text-muted)",
      icon: <span style={{ fontSize: 12 }}>·</span>,
    };
  }
  return {
    name: p.name,
    role: p.role,
    bg: p.color.bg,
    fg: p.color.fg,
    icon: <SMEIcon name={p.icon} size={15} />,
  };
}

function LoomMark() {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: 4,
        background: "linear-gradient(120deg, #5b6cff 0%, #8a4dff 60%, #d36cff 100%)",
        display: "inline-block",
      }}
    />
  );
}
