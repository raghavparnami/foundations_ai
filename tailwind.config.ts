import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        provenance: {
          schema: "#3b82f6",      // blue — automated profiling
          query: "#a855f7",       // purple — derived from query logs
          claude: "#10b981",      // green — LLM-generated (DeepSeek via OpenRouter)
          human: "#f59e0b",       // amber — human-authored, never overwritten
        },
      },
    },
  },
  plugins: [],
};

export default config;
