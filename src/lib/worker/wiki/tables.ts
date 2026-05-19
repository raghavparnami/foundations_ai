/**
 * Tables-wiki agent.
 *
 * Reads the catalog's tables/views/skills and writes interlinked concept
 * pages into wiki_pages with kind='tables'. Two layers of pages:
 *
 *   1. Per-table pages: one wiki page per source table OR view, slug
 *      mirroring the doc path (e.g. tables/public.deviations).
 *   2. Index page (slug='_index'): an overview tying everything together,
 *      grouping tables by their FK-connected clusters.
 *
 * The agent is hash-gated — re-running is cheap when nothing changed.
 * Cross-references use the [[tables/<slug>]] syntax which the wiki link
 * parser picks up.
 *
 * Where the doc body comes from: we reuse the per-table markdown that Loop 2
 * already wrote into `docs.markdown`. The wiki agent's job is to add the
 * "## See also" / "## Used in views" / "## Used by skills" sections that
 * stitch the corpus together.
 */
import { catalogPool } from "../../catalog/db";
import { upsertWikiPage } from "../../catalog/wiki";

type TableInfo = {
  table_id: number;
  schema_name: string;
  table_name: string;
  status: string;
  row_count: number | null;
  is_view: boolean;
  doc_md: string | null;
  fk_targets: string[]; // qualified "schema.table" strings
};

type ViewInfo = { name: string; description: string | null; sql: string };
type SkillInfo = { slug: string; name: string; triggers: string[]; description: string };

export async function runTablesWikiAgent(): Promise<{ generated: number }> {
  const tables = await loadTables();
  const views = await loadViews();
  const skills = await loadSkills();

  // Pre-compute slugs so we can cross-link symmetrically.
  const slugFor = (t: { schema_name: string; table_name: string }) => tableSlug(t.schema_name, t.table_name);
  const tableSlugSet = new Set(tables.map((t) => slugFor(t)));

  let generated = 0;
  const ACTOR = "wiki-agent:tables";

  // --- Per-table / per-view pages ---------------------------------------
  for (const t of tables) {
    const slug = slugFor(t);
    const title = t.is_view
      ? `${t.schema_name}.${t.table_name}  (view)`
      : `${t.schema_name}.${t.table_name}`;

    const body = renderTablePage({ table: t, tableSlugSet, views, skills });
    const r = await upsertWikiPage(ACTOR, {
      kind: "tables",
      slug,
      title,
      summary: t.is_view
        ? `Saved view · ${t.row_count ?? 0} rows`
        : `Table · ${t.row_count ?? 0} rows`,
      body_md: body,
      source_ref: {
        table_id: t.table_id,
        schema: t.schema_name,
        name: t.table_name,
        is_view: t.is_view,
      },
    });
    if (r.action !== "skipped") generated++;
  }

  // --- Index page --------------------------------------------------------
  const indexBody = renderIndexPage(tables, views, skills);
  const ix = await upsertWikiPage(ACTOR, {
    kind: "tables",
    slug: "_index",
    title: "Tables overview",
    summary: `${tables.filter((t) => !t.is_view).length} tables · ${tables.filter((t) => t.is_view).length} saved views`,
    body_md: indexBody,
    source_ref: { tables: tables.length, views: views.length, skills: skills.length },
  });
  if (ix.action !== "skipped") generated++;

  return { generated };
}

// ─── Render helpers ────────────────────────────────────────────────────────

function renderTablePage(args: {
  table: TableInfo;
  tableSlugSet: Set<string>;
  views: ViewInfo[];
  skills: SkillInfo[];
}): string {
  const { table, tableSlugSet, views, skills } = args;

  const parts: string[] = [];
  parts.push(`# ${table.schema_name}.${table.table_name}`);
  parts.push("");

  if (table.doc_md) {
    // Strip the leading title from the existing doc to avoid duplicate H1.
    const stripped = table.doc_md.replace(/^#\s+[^\n]+\n+/, "");
    parts.push(stripped);
    parts.push("");
  } else {
    parts.push(`*The catalog hasn't produced a structural+semantic doc yet — re-tick the scheduler.*`);
    parts.push("");
  }

  // ── See also (FK neighbours) ─────────────────────────────────────────
  const fkNeighbours = table.fk_targets
    .map((f) => {
      // FK strings come in as "schema.table.column"; trim the column.
      const m = f.match(/^([^.]+)\.([^.]+)/);
      if (!m) return null;
      const slug = tableSlug(m[1]!, m[2]!);
      return tableSlugSet.has(slug) ? slug : null;
    })
    .filter((s): s is string => !!s);

  if (fkNeighbours.length > 0) {
    parts.push("## See also");
    parts.push("");
    for (const s of fkNeighbours) parts.push(`- [[tables/${s}]]`);
    parts.push("");
  }

  // ── Used in views ────────────────────────────────────────────────────
  const usedInViews = views.filter((v) =>
    new RegExp(`\\b${escapeReg(table.table_name)}\\b`, "i").test(v.sql),
  );
  if (usedInViews.length > 0) {
    parts.push("## Used in views");
    parts.push("");
    for (const v of usedInViews) {
      const vslug = tableSlug("loom_views", v.name);
      const linkable = tableSlugSet.has(vslug);
      const target = linkable ? `[[tables/${vslug}]]` : `\`loom_views.${v.name}\``;
      parts.push(`- ${target}${v.description ? ` — ${v.description}` : ""}`);
    }
    parts.push("");
  }

  // ── Skills that mention this table ───────────────────────────────────
  const relatedSkills = skills.filter((s) =>
    new RegExp(`\\b${escapeReg(table.table_name)}\\b`, "i").test(s.description + " " + s.triggers.join(" ")),
  );
  if (relatedSkills.length > 0) {
    parts.push("## Used by skills");
    parts.push("");
    for (const s of relatedSkills) parts.push(`- **${s.name}** — ${s.description}`);
    parts.push("");
  }

  return parts.join("\n");
}

function renderIndexPage(tables: TableInfo[], views: ViewInfo[], skills: SkillInfo[]): string {
  const parts: string[] = [];
  parts.push(`# Tables overview`);
  parts.push("");
  parts.push(
    `Loom is indexing **${tables.filter((t) => !t.is_view).length} tables** and ` +
      `**${tables.filter((t) => t.is_view).length} saved views**. ` +
      `Click any link to drill into the page Loom generated for that object.`,
  );
  parts.push("");

  // Group by FK cluster (connected components of the FK graph).
  const clusters = clusterByFK(tables);

  for (const [i, group] of clusters.entries()) {
    parts.push(`## Cluster ${i + 1}: ${describeCluster(group)}`);
    parts.push("");
    for (const t of group) {
      const slug = tableSlug(t.schema_name, t.table_name);
      const meta = t.is_view ? "view" : `${t.row_count ?? 0} rows`;
      parts.push(`- [[tables/${slug}]] — ${meta}`);
    }
    parts.push("");
  }

  if (views.length > 0) {
    parts.push("## Saved views");
    parts.push("");
    for (const v of views) {
      const vslug = tableSlug("loom_views", v.name);
      parts.push(`- [[tables/${vslug}]]${v.description ? ` — ${v.description}` : ""}`);
    }
    parts.push("");
  }

  if (skills.length > 0) {
    parts.push("## Skills tying things together");
    parts.push("");
    for (const s of skills) parts.push(`- **${s.name}** — ${s.description}`);
    parts.push("");
  }

  return parts.join("\n");
}

// ─── Data loaders ──────────────────────────────────────────────────────────

async function loadTables(): Promise<TableInfo[]> {
  const r = await catalogPool.query<{
    table_id: number;
    schema_name: string;
    table_name: string;
    status: string;
    row_count: string | null;
    is_view: boolean;
    doc_md: string | null;
    fk_targets: string[] | null;
  }>(
    `SELECT t.id AS table_id,
            t.schema_name,
            t.table_name,
            t.status,
            t.row_count::text AS row_count,
            (t.schema_name = 'loom_views') AS is_view,
            d.markdown AS doc_md,
            COALESCE(
              (SELECT array_agg(c.fk_target ORDER BY c.ordinal)
                 FROM columns c
                WHERE c.table_id = t.id AND c.fk_target IS NOT NULL),
              ARRAY[]::text[]
            ) AS fk_targets
       FROM tables t
       LEFT JOIN docs d ON d.table_id = t.id
      ORDER BY t.schema_name, t.table_name`,
  );
  return r.rows.map((row) => ({
    table_id: row.table_id,
    schema_name: row.schema_name,
    table_name: row.table_name,
    status: row.status,
    row_count: row.row_count !== null ? Number(row.row_count) : null,
    is_view: row.is_view,
    doc_md: row.doc_md,
    fk_targets: row.fk_targets ?? [],
  }));
}

async function loadViews(): Promise<ViewInfo[]> {
  const r = await catalogPool.query<{ name: string; description: string | null; sql: string }>(
    `SELECT name, description, sql FROM proposals WHERE kind = 'view' AND status = 'applied'`,
  );
  return r.rows;
}

async function loadSkills(): Promise<SkillInfo[]> {
  const r = await catalogPool.query<{ slug: string; name: string; triggers: unknown; description: string }>(
    `SELECT slug, name, triggers, description FROM skills WHERE enabled = TRUE`,
  );
  return r.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    triggers: Array.isArray(row.triggers) ? (row.triggers as string[]) : [],
    description: row.description,
  }));
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function tableSlug(schema: string, name: string): string {
  return `${schema}.${name}`.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Connected-components clustering over FK edges. */
function clusterByFK(tables: TableInfo[]): TableInfo[][] {
  const idx = new Map<string, number>();
  tables.forEach((t, i) => idx.set(`${t.schema_name}.${t.table_name}`, i));

  // Disjoint-set
  const parent = tables.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  tables.forEach((t, i) => {
    for (const fk of t.fk_targets) {
      const m = fk.match(/^([^.]+)\.([^.]+)/);
      if (!m) continue;
      const targetKey = `${m[1]}.${m[2]}`;
      const j = idx.get(targetKey);
      if (j !== undefined) union(i, j);
    }
  });

  const buckets = new Map<number, TableInfo[]>();
  tables.forEach((t, i) => {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(t);
  });
  // Sort: bigger clusters first.
  return [...buckets.values()].sort((a, b) => b.length - a.length);
}

function describeCluster(group: TableInfo[]): string {
  // Crude: pick the table with the most FK refs as the centerpiece, plus
  // count of members.
  const sorted = [...group].sort((a, b) => b.fk_targets.length - a.fk_targets.length);
  const lead = sorted[0]!.table_name;
  return `${lead} & ${group.length - 1} related table${group.length === 2 ? "" : "s"}`;
}
