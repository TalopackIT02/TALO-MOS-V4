-- Runtime verification after 01-03. Connect directly as talo_app to talo_mos_v4_test.
-- A successful SELECT proves queryability. A nonzero returned row count proves actual data availability.
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

SELECT 'FOUNDATION' AS source, count(*) AS returned_rows
  FROM audit_api.read_foundation_audit(now() - interval '24 hours', now(), 'ALL', '', NULL, 501);
SELECT 'IAM' AS source, count(*) AS returned_rows
  FROM audit_api.read_iam_audit(now() - interval '24 hours', now(), 'ALL', '', NULL, 501);
SELECT 'FOUNDATION_SUMMARY' AS source, denied, failures
  FROM audit_api.read_foundation_audit_summary(now() - interval '1 hour', now());

DO $$
BEGIN
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
END
$$;
