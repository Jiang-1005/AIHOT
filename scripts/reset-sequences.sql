-- Idempotent: set every owned user sequence to MAX(column).
-- Empty tables get setval(seq, 1, false) so the next nextval() is 1.
-- Tables with rows get setval(seq, max_id, true) so the next nextval() is max_id+1.
-- Does not change table data. Safe to run more than once.
-- Skips unowned sequences and the hot_stage / hot_old swap schemas.

DO $$
DECLARE
  r record;
  max_id bigint;
  new_last bigint;
  called boolean;
  old_last bigint;
  n_reset int := 0;
  n_skip int := 0;
  seq_reg text;
BEGIN
  FOR r IN
    SELECT n.nspname AS seq_schema,
           s.relname AS seq_name,
           nt.nspname AS tbl_schema,
           t.relname AS tbl_name,
           a.attname AS col_name
    FROM pg_class s
    JOIN pg_namespace n ON n.oid = s.relnamespace
    JOIN pg_depend d
      ON d.objid = s.oid
     AND d.classid = 'pg_class'::regclass
     AND d.deptype = 'a'
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_namespace nt ON nt.oid = t.relnamespace
    JOIN pg_attribute a
      ON a.attrelid = t.oid
     AND a.attnum = d.refobjsubid
     AND NOT a.attisdropped
    WHERE s.relkind = 'S'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'hot_stage', 'hot_old')
      AND nt.nspname NOT IN ('hot_stage', 'hot_old')
    ORDER BY 1, 2
  LOOP
    seq_reg := format('%I.%I', r.seq_schema, r.seq_name);
    EXECUTE format(
      'SELECT COALESCE(MAX(%I), 0) FROM %I.%I',
      r.col_name, r.tbl_schema, r.tbl_name
    ) INTO max_id;
    old_last := pg_sequence_last_value(seq_reg::regclass);

    IF max_id < 1 THEN
      new_last := 1;
      called := false;
    ELSE
      new_last := max_id;
      called := true;
    END IF;

    PERFORM setval(seq_reg::regclass, new_last, called);
    n_reset := n_reset + 1;
    RAISE NOTICE 'sequence %.%  table %.%.%  last=%  max=%  -> setval(%, is_called=%)',
      r.seq_schema, r.seq_name, r.tbl_schema, r.tbl_name, r.col_name,
      old_last, max_id, new_last, called;
  END LOOP;

  FOR r IN
    SELECT n.nspname AS seq_schema, s.relname AS seq_name
    FROM pg_class s
    JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE s.relkind = 'S'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'hot_stage', 'hot_old')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.objid = s.oid
          AND d.classid = 'pg_class'::regclass
          AND d.deptype = 'a'
      )
  LOOP
    n_skip := n_skip + 1;
    RAISE NOTICE 'skip unowned sequence %.%', r.seq_schema, r.seq_name;
  END LOOP;

  RAISE NOTICE 'reset % owned sequence(s), skipped % unowned', n_reset, n_skip;
END $$;
