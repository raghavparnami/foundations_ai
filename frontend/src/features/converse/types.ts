/**
 * Event types streamed from POST /api/converse.
 * Mirrors backend/app/routes/converse.py exactly.
 */

export type ConverseEvent =
  | { type: "user_message"; msg_id: string; text: string }
  | { type: "agent_speak"; msg_id: string; text: string }
  | { type: "handshake"; msg_id: string; smes: string[]; reason: string }
  | { type: "sme_start"; msg_id: string; sme_id: string }
  | { type: "sme_delta"; msg_id: string; sme_id: string; text: string }
  | { type: "sme_done"; msg_id: string; sme_id: string }
  | {
      type: "tool_call";
      msg_id: string;
      agent_id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_output";
      msg_id: string;
      agent_id: string;
      name: string;
      summary: string;
    }
  | {
      type: "synthesis";
      msg_id: string;
      consensus_summary: string;
      dissenters: { sme_id: string; reason: string }[];
    }
  | {
      type: "turn_done";
      msg_id: string;
      duration_ms: number;
      cost_usd: number;
      llm_calls: number;
    }
  | { type: "error"; msg_id: string; message: string };

/* Local UI-only types — what the Transcript renders */

export type Speaker =
  | { kind: "user" }
  | { kind: "loom" }
  | { kind: "sme"; sme_id: string };

export type SpeechItem = {
  id: string;
  speaker: Speaker;
  text: string;
  started_at: number;
  done: boolean;
};

export type HandshakeItem = {
  id: string;
  kind: "handshake";
  msg_id: string;
  smes: string[];
  reason: string;
};

export type SynthesisItem = {
  id: string;
  kind: "synthesis";
  msg_id: string;
  consensus_summary: string;
  dissenters: { sme_id: string; reason: string }[];
};

export type ToolItem = {
  id: string;
  kind: "tool";
  msg_id: string;
  agent_id: string;
  name: string;
  args: Record<string, unknown>;
  summary?: string;
};

export type MetaItem = {
  id: string;
  kind: "meta";
  msg_id: string;
  duration_ms: number;
  cost_usd: number;
  llm_calls: number;
};

export type ErrorItem = {
  id: string;
  kind: "error";
  msg_id: string;
  message: string;
};

export type TranscriptItem =
  | (SpeechItem & { kind: "speech" })
  | HandshakeItem
  | SynthesisItem
  | ToolItem
  | MetaItem
  | ErrorItem;
