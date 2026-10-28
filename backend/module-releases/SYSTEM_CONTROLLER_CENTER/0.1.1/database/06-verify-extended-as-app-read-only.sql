-- TALO-MOS-V4 · SCC Audit Read · 06 — extended runtime verification (READ ONLY), after 01-05.
-- Connect DIRECTLY as talo_app to talo_mos_v4_test. Prints counts only, never audit rows or metadata.
-- Why: 05 uses a 24-hour window; on TEST the newest Foundation audit row can be older than 24 h, so 05 may return 0
-- Foundation rows although the reader works. 06 proves real data through the functions over the widest allowed window
-- (31 days, anchored on the newest recorded event, found through the readers themselves) and every negative rule.
\set ON_ERROR_STOP on
SET default_transaction_read_only = on;

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' OR current_user <> 'talo_app' OR session_user <> 'talo_app' THEN
    RAISE EXCEPTION 'Abort: connect directly as talo_app to talo_mos_v4_test (db=%, current=%, session=%)',
      current_database(), current_user, session_user;
  END IF;
END
$$;

-- 1. Real data over the maximum window (31 days ending now): rows returned (capped at 501) per source.
SELECT 'FOUNDATION_31D' AS check_name, count(*) AS returned_rows,
       count(*) FILTER (WHERE reason IS NOT NULL OR error_code IS NOT NULL) AS rows_with_code
  FROM audit_api.read_foundation_audit(now() - interval '31 days', now(), 'ALL', '', NULL, 501);
SELECT 'IAM_31D' AS check_name, count(*) AS returned_rows,
       count(*) FILTER (WHERE reason IS NOT NULL OR error_code IS NOT NULL) AS rows_with_code
  FROM audit_api.read_iam_audit(now() - interval '31 days', now(), 'ALL', '', NULL, 501);
-- Filters reach the data (ISSUES = FAILURE + DENIED).
SELECT 'FOUNDATION_31D_ISSUES' AS check_name, count(*) AS returned_rows
  FROM audit_api.read_foundation_audit(now() - interval '31 days', now(), 'ISSUES', '', NULL, 501);
-- Summary over the 24 h ending at the newest Foundation event returned by the reader (non-zero when issues exist there).
SELECT 'FOUNDATION_SUMMARY_AT_NEWEST' AS check_name, s.denied, s.failures
  FROM (SELECT max(occurred_at)::timestamptz AS newest
          FROM audit_api.read_foundation_audit(now() - interval '31 days', now(), 'ALL', '', NULL, 1)) AS n,
       LATERAL audit_api.read_foundation_audit_summary(n.newest - interval '24 hours', n.newest) AS s;

-- 2. Every invalid input is refused with 22023 and every raw read with 42501.
DO $$
DECLARE
  v_cases text[] := ARRAY[
    $q$SELECT * FROM audit_api.read_foundation_audit(now() - interval '32 days', now(), 'ALL', '', NULL, 10)$q$,
    $q$SELECT * FROM audit_api.read_foundation_audit(now(), now() - interval '1 hour', 'ALL', '', NULL, 10)$q$,
    $q$SELECT * FROM audit_api.read_foundation_audit(now() - interval '1 day', now(), 'ALL', '', NULL, 0)$q$,
    $q$SELECT * FROM audit_api.read_foundation_audit(now() - interval '1 day', now(), 'ALL', '', NULL, 502)$q$,
    $q$SELECT * FROM audit_api.read_foundation_audit(now() - interval '1 day', now(), 'BOGUS', '', NULL, 10)$q$,
    $q$SELECT * FROM audit_api.read_foundation_audit(now() - interval '1 day', now(), 'ALL', 'x%'' OR 1=1', NULL, 10)$q$,
    $q$SELECT * FROM audit_api.read_iam_audit(NULL, now(), 'ALL', '', NULL, 10)$q$,
    $q$SELECT * FROM audit_api.read_iam_audit(now() - interval '1 day', now(), 'ALL', repeat('a', 81), NULL, 10)$q$,
    $q$SELECT * FROM audit_api.read_foundation_audit_summary(now() - interval '25 hours', now())$q$];
  v_sql text;
  v_ok integer := 0;
BEGIN
  FOREACH v_sql IN ARRAY v_cases LOOP
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'FAIL: invalid input accepted: %', v_sql;
    EXCEPTION WHEN invalid_parameter_value THEN v_ok := v_ok + 1;
    END;
  END LOOP;
  RAISE NOTICE 'invalid-input cases refused with 22023: %/%', v_ok, cardinality(v_cases);
  BEGIN
    PERFORM 1 FROM foundation.fnd_audit_logs LIMIT 1;
    RAISE EXCEPTION 'FAIL: direct Foundation SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM iam.iam_audit_logs LIMIT 1;
    RAISE EXCEPTION 'FAIL: direct IAM SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SET LOCAL ROLE talo_audit_reader;
    RAISE EXCEPTION 'FAIL: talo_app can SET ROLE talo_audit_reader';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_table_privilege('talo_app', 'foundation.fnd_audit_logs', 'SELECT')
     OR has_any_column_privilege('talo_app', 'foundation.fnd_audit_logs', 'SELECT')
     OR has_any_column_privilege('talo_app', 'iam.iam_audit_logs', 'SELECT')
     OR has_schema_privilege('talo_app', 'audit_api', 'CREATE') THEN
    RAISE EXCEPTION 'FAIL: talo_app privileges broader than approved';
  END IF;
  RAISE NOTICE 'raw audit SELECT denied (42501), SET ROLE denied, no CREATE on audit_api: OK';
END
$$;

-- 3. Closed result shape: exactly the 12 projected columns (no metadata column).
SELECT 'RESULT_COLUMNS' AS check_name,
       string_agg(a.attname, ',' ORDER BY a.attnum) AS columns
  FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(attname, mode, attnum)
 WHERE p.oid = 'audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer)'::regprocedure
   AND a.mode = 't';
