/**
 * OpenRouter client wired into the Vercel AI SDK. Single place that
 * constructs the provider so we can swap models / providers later.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "../shared/env";

let _provider: ReturnType<typeof createOpenRouter> | null = null;

export function openrouter() {
  if (_provider) return _provider;
  const e = env();
  _provider = createOpenRouter({
    apiKey: e.OPENROUTER_API_KEY,
    baseURL: e.OPENROUTER_BASE_URL,
    headers: {
      "HTTP-Referer": "https://loom.local",
      "X-Title": "Loom v0.1",
    },
  });
  return _provider;
}

export function agentModel() {
  return openrouter().chat(env().LOOM_AGENT_MODEL);
}

export function docWriterModel() {
  return openrouter().chat(env().LOOM_DOC_WRITER_MODEL);
}
