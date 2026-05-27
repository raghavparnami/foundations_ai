/**
 * Linear transcript renderer. Takes a flat list of TranscriptItems and
 * renders each through the right component. Auto-scrolls to bottom as
 * new items arrive.
 */
import { useEffect, useRef } from "react";
import SpeechBlock from "./SpeechBlock";
import {
  Handshake,
  Synthesis,
  ToolRow,
  MetaRow,
  ErrorRow,
} from "./InlineEvents";
import type { TranscriptItem } from "./types";

type Props = {
  items: TranscriptItem[];
  busy: boolean;
};

export default function Transcript({ items, busy }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items.length, busy]);

  return (
    <div
      ref={ref}
      className="flex-1 min-h-0 overflow-y-auto px-6"
      style={{ scrollBehavior: "smooth" }}
    >
      <div className="max-w-[840px] mx-auto py-6">
        {items.map((it) => {
          if (it.kind === "speech") {
            const streaming = !it.done && busy;
            return <SpeechBlock key={it.id} item={it} streaming={streaming} />;
          }
          if (it.kind === "handshake") return <Handshake key={it.id} item={it} />;
          if (it.kind === "synthesis") return <Synthesis key={it.id} item={it} />;
          if (it.kind === "tool") return <ToolRow key={it.id} item={it} />;
          if (it.kind === "meta") return <MetaRow key={it.id} item={it} />;
          if (it.kind === "error") return <ErrorRow key={it.id} item={it} />;
          return null;
        })}
      </div>
    </div>
  );
}
