/**
 * Parses a SQL string with node-sql-parser and enforces:
 *  - exactly one statement
 *  - statement type is SELECT (or WITH ... SELECT)
 *  - no SELECT INTO (which writes)
 *
 * Throws on any violation. Returns the original string on success.
 */
import { Parser } from "node-sql-parser";

const parser = new Parser();

const ALLOWED_TYPES = new Set(["select"]);

export class UnsafeSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSqlError";
  }
}

export function assertSelectOnly(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (!trimmed) throw new UnsafeSqlError("Empty SQL");

  let ast;
  try {
    ast = parser.astify(trimmed, { database: "PostgreSQL" });
  } catch (e) {
    throw new UnsafeSqlError(`SQL parse error: ${String(e)}`);
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    throw new UnsafeSqlError(`Expected exactly one statement, got ${statements.length}`);
  }
  const stmt = statements[0]!;
  const type = (stmt as { type?: string }).type;
  if (!type || !ALLOWED_TYPES.has(type.toLowerCase())) {
    throw new UnsafeSqlError(`Only SELECT statements are allowed (got ${type ?? "unknown"})`);
  }

  // Block SELECT INTO (creates a table). node-sql-parser populates
  // `stmt.into` with `{ position: null }` for plain SELECTs, so we need to
  // look for an actual INTO target rather than mere object presence.
  const into = (stmt as { into?: { keyword?: string; expr?: unknown } }).into;
  if (into && (into.keyword === "into" || into.expr)) {
    throw new UnsafeSqlError("SELECT INTO is not allowed");
  }

  return trimmed;
}
