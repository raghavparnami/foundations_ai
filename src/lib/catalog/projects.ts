/**
 * Project = a scoped workspace pinning a subset of catalog tables. When the
 * chat has an active project, the agent's catalog index and tool responses
 * are filtered to that project's tables. Out-of-scope tables are still
 * profiled and enriched in the background — they're just hidden from the
 * agent unless the user explicitly expands scope.
 */
import { catalogPool } from "./db";

export type ProjectRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectWithTables = ProjectRow & {
  table_ids: number[];
};

export async function listProjects(): Promise<ProjectRow[]> {
  const r = await catalogPool.query<ProjectRow>(
    `SELECT id, slug, name, description, created_at, updated_at
       FROM projects ORDER BY updated_at DESC`,
  );
  return r.rows;
}

export async function getProject(slug: string): Promise<ProjectWithTables | null> {
  const r = await catalogPool.query<ProjectRow>(
    `SELECT id, slug, name, description, created_at, updated_at
       FROM projects WHERE slug = $1`,
    [slug],
  );
  const p = r.rows[0];
  if (!p) return null;
  const t = await catalogPool.query<{ table_id: number }>(
    `SELECT table_id FROM project_tables WHERE project_id = $1`,
    [p.id],
  );
  return { ...p, table_ids: t.rows.map((row) => row.table_id) };
}

export async function upsertProject(input: {
  slug: string;
  name: string;
  description: string | null;
  table_ids: number[];
}): Promise<ProjectWithTables> {
  const r = await catalogPool.query<ProjectRow>(
    `INSERT INTO projects (slug, name, description, updated_at)
       VALUES ($1, $2, $3, now())
     ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_at = now()
     RETURNING id, slug, name, description, created_at, updated_at`,
    [input.slug, input.name, input.description],
  );
  const p = r.rows[0]!;
  await catalogPool.query(`DELETE FROM project_tables WHERE project_id = $1`, [p.id]);
  if (input.table_ids.length > 0) {
    const placeholders = input.table_ids
      .map((_, i) => `($1, $${i + 2})`)
      .join(", ");
    await catalogPool.query(
      `INSERT INTO project_tables (project_id, table_id) VALUES ${placeholders}`,
      [p.id, ...input.table_ids],
    );
  }
  return { ...p, table_ids: [...input.table_ids] };
}

export async function deleteProject(slug: string): Promise<void> {
  await catalogPool.query(`DELETE FROM projects WHERE slug = $1`, [slug]);
}

/**
 * Resolve a project slug to its table IDs. Returns null if no such project
 * (caller should treat as full-catalog scope).
 */
export async function projectTableIds(slug: string | null): Promise<number[] | null> {
  if (!slug) return null;
  const r = await catalogPool.query<{ table_id: number }>(
    `SELECT pt.table_id
       FROM project_tables pt
       JOIN projects p ON p.id = pt.project_id
      WHERE p.slug = $1`,
    [slug],
  );
  if (r.rowCount === 0) return null;
  return r.rows.map((row) => row.table_id);
}
