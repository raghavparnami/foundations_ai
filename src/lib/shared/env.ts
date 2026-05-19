import { z } from "zod";

const Env = z.object({
  // OpenRouter is the current LLM provider (DeepSeek V3.1 for v0.1).
  // Anthropic / Databricks keys are kept optional for future swaps.
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LOOM_CATALOG_URL: z
    .string()
    .default("postgres://loom:loom@localhost:5544/loom_catalog"),
  LOOM_DEMO_SOURCE_URL: z
    .string()
    .default("postgres://loom:loom@localhost:5544/loom_demo_source"),
  LOOM_AGENT_MODEL: z.string().default("deepseek/deepseek-chat-v3.1"),
  LOOM_DOC_WRITER_MODEL: z.string().default("deepseek/deepseek-chat-v3.1"),
});

let _cached: z.infer<typeof Env> | null = null;

export function env() {
  if (_cached) return _cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid env:\n${issues}`);
  }
  _cached = parsed.data;
  return _cached;
}

export type Env = z.infer<typeof Env>;
