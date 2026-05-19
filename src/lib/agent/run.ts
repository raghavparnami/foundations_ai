/**
 * Agent entry — wraps AI SDK v6 streamText with our tools and system prompt.
 * The /api/chat route calls this and returns a UI message stream.
 */
import { streamText, stepCountIs, type ModelMessage } from "ai";
import { agentTools } from "./tools";
import { buildSystemPrompt } from "./system-prompt";
import { agentModel } from "../worker/openrouter";

export async function runAgent(opts: {
  messages: ModelMessage[];
  conversationId: string;
  lastUserText: string;
  projectSlug: string | null;
}) {
  const system = await buildSystemPrompt(opts.lastUserText, opts.projectSlug);
  const tools = agentTools({ conversationId: opts.conversationId, projectSlug: opts.projectSlug });

  return streamText({
    model: agentModel(),
    system,
    messages: opts.messages,
    tools,
    stopWhen: stepCountIs(15),
    temperature: 0.2,
  });
}
