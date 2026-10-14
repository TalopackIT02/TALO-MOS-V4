-- TALO-MOS-V4 · AUTH-SC5-V1 · harness 01 — create the test-harness login role (cluster level)
-- TARGET: maintenance database "postgres", as a role with CREATEROLE. No password (container-local use only).
-- Contains no DROP/TRUNCATE.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Abort: connect to the maintenance database "postgres" (currently connected to "%")', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_test_harness') THEN
    RAISE EXCEPTION 'Abort: talo_test_harness already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'talo_mos_v4_test') THEN
    RAISE EXCEPTION 'Abort: talo_mos_v4_test does not exist';
  END IF;
END
$$;

BEGIN;
CREATE ROLE talo_test_harness
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 5;
COMMENT ON ROLE talo_test_harness IS 'TALO-MOS SC5 integration test harness: fixtures, writer simulation, cleanup on talo_mos_v4_test only';
COMMIT;

SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin, rolconnlimit,
       (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'talo_test_harness') AS no_password
FROM pg_roles WHERE rolname = 'talo_test_harness';
