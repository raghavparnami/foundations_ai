import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence the multi-lockfile warning by anchoring file tracing to this repo.
  outputFileTracingRoot: process.cwd(),
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  serverExternalPackages: ["pg"],
};

export default nextConfig;
