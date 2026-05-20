import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        provenance: {
          schema: "#3b82f6",
          query: "#a855f7",
          claude: "#10b981",
          human: "#f59e0b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
