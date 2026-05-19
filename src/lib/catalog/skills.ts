/**
 * Skills (analytical playbooks). A skill is a markdown body the agent loads
 * into its system prompt when one of its triggers matches the user's question.
 * Triggers are simple keyword/phrase matches for v0.1; semantic matching
 * comes later.
 */
import { catalogPool } from "./db";

export type SkillRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  body_md: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export async function listSkills(): Promise<SkillRow[]> {
  const r = await catalogPool.query<SkillRow>(
    `SELECT id, slug, name, description, triggers, body_md, enabled, created_at, updated_at
       FROM skills ORDER BY name`,
  );
  return r.rows;
}

export async function getSkill(slug: string): Promise<SkillRow | null> {
  const r = await catalogPool.query<SkillRow>(
    `SELECT id, slug, name, description, triggers, body_md, enabled, created_at, updated_at
       FROM skills WHERE slug = $1`,
    [slug],
  );
  return r.rows[0] ?? null;
}

export async function upsertSkill(input: {
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  body_md: string;
  enabled?: boolean;
}): Promise<SkillRow> {
  const r = await catalogPool.query<SkillRow>(
    `INSERT INTO skills (slug, name, description, triggers, body_md, enabled, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6, TRUE), now())
     ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            triggers = EXCLUDED.triggers,
            body_md = EXCLUDED.body_md,
            enabled = COALESCE(EXCLUDED.enabled, skills.enabled),
            updated_at = now()
     RETURNING id, slug, name, description, triggers, body_md, enabled, created_at, updated_at`,
    [input.slug, input.name, input.description, JSON.stringify(input.triggers), input.body_md, input.enabled ?? null],
  );
  return r.rows[0]!;
}

export async function deleteSkill(slug: string): Promise<void> {
  await catalogPool.query(`DELETE FROM skills WHERE slug = $1`, [slug]);
}

/**
 * Find skills whose triggers appear (case-insensitive substring) in the
 * user's question. Returns a small set so we don't blow up the prompt.
 */
export async function matchSkills(question: string, limit = 3): Promise<SkillRow[]> {
  const skills = await listSkills();
  const lower = question.toLowerCase();
  const scored: { skill: SkillRow; hits: number }[] = [];
  for (const s of skills) {
    if (!s.enabled) continue;
    let hits = 0;
    for (const t of s.triggers) {
      if (typeof t === "string" && lower.includes(t.toLowerCase())) hits++;
    }
    if (hits > 0) scored.push({ skill: s, hits });
  }
  scored.sort((a, b) => b.hits - a.hits);
  return scored.slice(0, limit).map((s) => s.skill);
}
