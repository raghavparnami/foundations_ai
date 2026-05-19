/**
 * The `plan` tool. Forces the agent to commit to a small, ordered list of
 * steps before executing — gives the UI a checklist it can tick as the
 * subsequent tool calls land.
 *
 * No side-effects: the tool just echoes the steps back so they appear in
 * the assistant message's parts (where the UI extracts them from).
 */
import { tool } from "ai";
import { z } from "zod";
import { audit } from "../catalog/queries";

export type Step = {
  id: number;
  label: string;
};

export function planTool(opts: { conversationId: string }) {
  return tool({
    description:
      "Commit upfront to the steps you will take to answer the user's question. Call this FIRST on every turn, before any other tool. Steps should be short (5–10 words each), ordered, and map roughly one-to-one with the tools you will call. Examples of good steps: \"Look up the deviations table\", \"Run aggregate by line\", \"Save view\", \"Plot a bar chart\". DON'T put it in if the question is purely conversational (\"hello\", a simple clarification).",
    inputSchema: z.object({
      steps: z
        .array(z.string().min(2).max(80))
        .min(2)
        .max(8)
        .describe("Ordered, concise steps. Minimum 2, maximum 8."),
    }),
    execute: async ({ steps }) => {
      await audit("agent", "tool:plan", null, {
        conversationId: opts.conversationId,
        n_steps: steps.length,
      });
      return {
        ok: true,
        steps: steps.map((label, i) => ({ id: i, label })),
      };
    },
  });
}
