#!/usr/bin/env node
// Tiny wrapper so the bin entry stays plain JS while the server is written
// in TypeScript. Executes the server via tsx at runtime so consumers don't
// need a build step.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "server.ts");
const tsx = join(here, "..", "node_modules", ".bin", "tsx");

const child = spawn(tsx, [entry], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
