import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy backend API + SSE to the FastAPI server. The /api prefix lets
      // us flip between Next.js (:3001) and FastAPI (:8001) by changing only
      // the target — no client code change.
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
});
