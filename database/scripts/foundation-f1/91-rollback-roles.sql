-- TALO-MOS-V4 · Foundation F1 · 91 — ROLLBACK: remove the roles created by 03
-- STATUS: PREPARED, NOT EXECUTED. Rollback only; requires a separate execution approval.
-- TARGET: maintenance database "postgres".
-- PRECONDITION: the roles hold no privileges anywhere. Either run 90 first (drops the test database and its
-- grants), or, to keep the test database, first connect to talo_mos_v4_test and run:
--   REASSIGN OWNED BY talo_app, talo_provisioner TO CURRENT_USER;  -- they should own nothing
--   DROP OWNED BY talo_app, talo_provisioner;                       -- revokes their grants in that database only
-- If any privilege remains elsewhere, DROP ROLE fails and nothing is removed.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Abort: connect to the maintenance database "postgres" (currently connected to "%")', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN ('talo_app', 'talo_provisioner')) THEN
    RAISE EXCEPTION 'Abort: talo_app/talo_provisioner still have open sessions';
  END IF;
END
$$;

DROP ROLE IF EXISTS talo_app;
DROP ROLE IF EXISTS talo_provisioner;

SELECT count(*) AS remaining_roles FROM pg_roles WHERE rolname IN ('talo_app', 'talo_provisioner');
