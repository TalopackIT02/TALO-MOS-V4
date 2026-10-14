-- TALO-MOS-V4 · Foundation F1 · 90 — ROLLBACK: remove the TEST database created by 01
-- STATUS: PREPARED, NOT EXECUTED. Rollback only; requires a separate execution approval.
-- TARGET: maintenance database "postgres". Drops ONLY talo_mos_v4_test (all its data and grants go with it).
-- Never edit the database name in this file.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Abort: connect to the maintenance database "postgres" (currently connected to "%")', current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'talo_mos_v4_test') THEN
    RAISE EXCEPTION 'Abort: talo_mos_v4_test does not exist; nothing to roll back';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = 'talo_mos_v4_test') THEN
    RAISE EXCEPTION 'Abort: close all connections to talo_mos_v4_test first';
  END IF;
END
$$;

DROP DATABASE talo_mos_v4_test;

SELECT count(*) AS remaining_test_databases FROM pg_database WHERE datname = 'talo_mos_v4_test';
