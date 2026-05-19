type LogLevel = "debug" | "info" | "warn" | "error";

function fmt(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const base = `[${ts}] ${level.toUpperCase()} ${msg}`;
  if (!fields) return base;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return `${base} ${parts.join(" ")}`;
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => console.log(fmt("debug", msg, fields)),
  info:  (msg: string, fields?: Record<string, unknown>) => console.log(fmt("info",  msg, fields)),
  warn:  (msg: string, fields?: Record<string, unknown>) => console.warn(fmt("warn", msg, fields)),
  error: (msg: string, fields?: Record<string, unknown>) => console.error(fmt("error", msg, fields)),
};
