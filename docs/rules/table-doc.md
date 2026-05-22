# Table documentation template

This is the canonical shape of every TABLES-corpus wiki page. The
semantic-enrichment worker (`backend/app/workers/loop2.py`) emits this exact
structure, and the wiki agent (`backend/app/workers/wiki/tables.py`) wraps it
with structural fields (column type table, FK summary, "Used in views").

## The seven sections

The LLM-authored half of a table page MUST be exactly these sections, in
this order. Sections marked **required** must always appear. Optional
sections are omitted entirely (not stubbed with "None") when there's no
concrete content.

| # | Section | Required | Length |
|---|---------|----------|--------|
| 1 | `## Purpose` | yes | 1-2 sentences |
| 2 | `## Grain` | yes | 2 lines |
| 3 | `## When to use this` | yes | 3 bullets |
| 4 | `## Key columns` | yes | 4-7 bullets |
| 5 | `## Joins` | yes | 1-5 bullets |
| 6 | `## Common questions (with SQL)` | no | 2-3 Q+SQL blocks |
| 7 | `## Gotchas` | no | 1-3 bullets |

## Section guidance

### Purpose
Lead with the claim. "Holds quality-check results for production runs."
NOT "this table is used to store …". Domain vocabulary > generic
warehouse jargon.

### Grain
Two lines. First: what a single row represents. Second: the natural key
in backticks. Example:

> One quality check per parameter, per production run.
> Natural key: `check_id`.

### When to use this
3 concrete questions an analyst on this team would ask, phrased as
questions. NOT topics. Examples:

> - How many quality checks failed yesterday by parameter?
> - Which lines have the highest in-spec rate over the last 30 days?
> - Which checks took longest to clear (gap between observed and resolved)?

### Key columns
4-7 columns that matter for analysis. Skip surrogate IDs unless they
join out. Format:

```
- `col_name` — meaning. _Type:_ `TYPE`. _Sample:_ `val1`, `val2`. _Filter:_ short SQL fragment
```

Drop the `_Filter:_` clause when the column isn't typically filtered on.

### Joins
Full `JOIN ... ON ...` clauses. Prefer joins seen in the recent agent
queries log — quote them verbatim. Fall back to FK inference only when
there's no observed usage. If still nothing, write the single line
`None observed yet.` — do not invent.

### Common questions (with SQL)
2-3 entries. Each:

```
**Q:** Question text.
` ` `sql
SELECT ...
FROM ...
WHERE ...;
` ` `
```

Prefer SQL patterns visible in the agent's query log. Keep snippets
under 10 lines.

### Gotchas
1-3 surprising facts a user MUST know to avoid wrong results: NULL
semantics, status enum values, timezone of timestamps, soft-delete
columns, sentinel values. Skip the section entirely when nothing
applies — do not write "None".

## Hard rules

- No preamble. No "As an AI". No emoji. No "this document covers…".
- Every identifier in backticks. Every SQL block in a ` ```sql ` fence.
- Never invent joins, columns, or values that aren't in the inputs.
- Respect `<!-- provenance: human -->` paragraphs — they are read-only
  and survive regeneration.

## Regenerating after a template change

When this rules file or the LLM prompt in `loop2.py` changes, kick a
full regeneration so existing pages adopt the new shape:

```
curl -X POST https://<backend-host>/api/admin/regenerate-docs
```

The endpoint flips every table back to `status='profiled'`, runs Loop 2
against the configured source DB, then re-emits the tables wiki. Runs
in the background — expect ~10s per table.
