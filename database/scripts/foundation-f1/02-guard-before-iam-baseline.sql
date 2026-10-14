-- TALO-MOS-V4 · Foundation F1 · 02 — guard to run IMMEDIATELY BEFORE applying the IAM v0.3 baseline
-- STATUS: PREPARED, NOT EXECUTED. Requires a separate execution approval.
-- TARGET: database talo_mos_v4_test only.
--
-- The baseline file database/sql/TALO-MOS-IAM-Security-PostgreSQL-v0.3.sql is applied unchanged, in the
-- same psql invocation, right after this guard (see README.md). With ON_ERROR_STOP the baseline is never
-- reached if this guard fails, so the DDL can only ever run against an empty talo_mos_v4_test.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: IAM baseline may only be applied to talo_mos_v4_test (connected to "%")', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'iam') THEN
    RAISE EXCEPTION 'Abort: schema iam already exists in talo_mos_v4_test';
  END IF;
END
$$;
