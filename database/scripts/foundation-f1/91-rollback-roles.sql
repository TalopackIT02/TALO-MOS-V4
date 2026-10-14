-- TALO-MOS-V4 · Foundation F1 · 91 — ROLLBACK: remove the roles created by 03
-- STATUS: PREPARED, NOT EXECUTED. Rollback only; requires a separate execution approval.
-- TARGET: maintenance database "postgres".
-- PRECONDITION: the roles hold no privileges anywhere. Either run 90 first (drops the test database and its
-- grants), or, to keep the test database, first connect to talo_mos_v4_test and run:
--   REASSIGN OWNED BY talo_app, talo_provisioner TO CURRENT_USER;  -- they should own nothing
--   DROP OWNED BY talo_app, talo_provisioner;                       -- revokes their grants in that database only
-- The guard reads the shared catalog pg_shdepend, so remaining privileges/ownership in ANY database abort the
-- script before anything is dropped; both roles are then dropped in one transaction (all or nothing).

\set ON_ERROR_STOP on

DO $$
DECLARE
  blocking text;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Abort: connect to the maintenance database "postgres" (currently connected to "%")', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN ('talo_app', 'talo_provisioner')) THEN
    RAISE EXCEPTION 'Abort: talo_app/talo_provisioner still have open sessions';
  END IF;
  SELECT string_agg(DISTINCT coalesce(d.datname, '(shared)') || ':' || r.rolname || ':' || s.deptype::text, ', ')
    INTO blocking
    FROM pg_shdepend s
    JOIN pg_roles r ON r.oid = s.refobjid AND s.refclassid = 'pg_authid'::regclass
    LEFT JOIN pg_database d ON d.oid = s.dbid
   WHERE r.rolname IN ('talo_app', 'talo_provisioner') AND s.deptype IN ('o', 'a', 'r', 'i');
  IF blocking IS NOT NULL THEN
    RAISE EXCEPTION 'Abort: roles still own objects or hold privileges (database:role:deptype): %', blocking;
  END IF;
END
$$;

BEGIN;
DROP ROLE IF EXISTS talo_app;
DROP ROLE IF EXISTS talo_provisioner;
COMMIT;

SELECT count(*) AS remaining_roles FROM pg_roles WHERE rolname IN ('talo_app', 'talo_provisioner');
