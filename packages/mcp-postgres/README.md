# loom-mcp-postgres

A standalone [MCP server](https://modelcontextprotocol.io) that exposes Loom's four read tools (`list_tables`, `describe_table`, `sample_rows`, `run_sql`) for any Postgres database. Drop it into Claude Code, Claude Desktop, Cursor, or any MCP-compatible client.

If you also point it at the Loom catalog (`LOOM_CATALOG_URL`), `describe_table` returns the agent-generated semantic markdown alongside the structural columns — so your client gets Loom's "always-preparing" context for free.

## Why

- One MCP-compliant entry point that any team can plug into their existing AI tooling without standing up Loom's full Next.js stack.
- `run_sql` is hard-gated to SELECT-only via `node-sql-parser` — same guard as the Loom UI.
- Stateless, single-process; restart anytime. No background workers.

## Install (local for now)

```bash
cd packages/mcp-postgres
npm install
```

Once published, this will become:

```bash
npx loom-mcp-postgres
```

## Configuration

| Env var               | Required | Notes                                                  |
| --------------------- | -------- | ------------------------------------------------------ |
| `LOOM_SOURCE_URL`     | yes      | `postgres://user:pass@host:5432/db` — the DB to read   |
| `LOOM_CATALOG_URL`    | no       | Loom catalog DB; enables enriched `describe_table`     |
| `LOOM_SOURCE_SCHEMA`  | no       | Default `public`                                       |

## Wire into Claude Code

Add to `~/.claude/settings.json` (or your project's `.claude/settings.json`):

```json
{
  "mcpServers": {
    "loom-postgres": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/loom/packages/mcp-postgres/src/server.ts"],
      "env": {
        "LOOM_SOURCE_URL": "postgres://loom:loom@localhost:5544/loom_demo_source",
        "LOOM_CATALOG_URL": "postgres://loom:loom@localhost:5544/loom_catalog"
      }
    }
  }
}
```

Restart Claude Code; the four tools will appear under `mcp__loom-postgres__*`.

## Wire into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "loom-postgres": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/loom/packages/mcp-postgres/src/server.ts"],
      "env": {
        "LOOM_SOURCE_URL": "postgres://...",
        "LOOM_CATALOG_URL": "postgres://..."
      }
    }
  }
}
```

## Test it standalone

The server speaks JSON-RPC over stdio. To exercise it without a client:

```bash
LOOM_SOURCE_URL=postgres://loom:loom@localhost:5544/loom_demo_source \
  npx tsx src/server.ts <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

### `list_tables`
Returns every table/view in the configured schema with column count and row estimate.

### `describe_table`
- **Input**: `{ table_name: string }`
- **Output**: columns + data types. If catalog is connected, also `doc_markdown` with Loom's structural + semantic doc.

### `sample_rows`
- **Input**: `{ table_name: string, limit?: number (1..25, default 5) }`
- **Output**: `{ rows, row_count }`

### `run_sql`
- **Input**: `{ sql: string }` — a single SELECT (or WITH ... SELECT) statement
- Hard-gated: any DML/DDL is rejected by the SQL parser, not regex.
- Output capped at 200 rows.

## What this isn't (yet)

- Snowflake / BigQuery — v0.5 of the parent Loom project
- Write tools (`propose_view`) — those live in the Loom server, behind plan-mode approval
- Caching, batching, rate limiting — single-user use only

## License

Same as the parent Loom repo.
