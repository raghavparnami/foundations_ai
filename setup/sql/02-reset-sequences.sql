-- =====================================================================
-- Reset every SERIAL / identity sequence in `foundation_ai` to MAX(id)+1.
--
-- Run this ONCE after a data-only restore (e.g. after
-- `psql -f loom_catalog_essential.sql`). Without it, every fresh INSERT
-- collides with the pre-loaded rows that took the early IDs.
-- =====================================================================

DO $$
DECLARE
  r record;
  max_id BIGINT;
  sql_stmt text;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           a.attname AS column_name,
           pg_get_serial_sequence(n.nspname || '.' || c.relname, a.attname) AS seq
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = 'foundation_ai'
       AND c.relkind = 'r'
       AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval%'
  LOOP
    sql_stmt := format(
      'SELECT COALESCE(MAX(%I), 0) FROM %I.%I',
      r.column_name, r.schema_name, r.table_name
    );
    EXECUTE sql_stmt INTO max_id;
    PERFORM setval(r.seq, GREATEST(max_id, 1), max_id > 0);
    RAISE NOTICE 'reset %.%.% → %', r.schema_name, r.table_name, r.column_name, max_id;
  END LOOP;
END $$;
