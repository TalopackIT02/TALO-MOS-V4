-- TALO-MOS-V4 · SCC 0.1.2 Foundation controlled read · 01 — restricted owner role (cluster level)
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED ON TEST.
-- TARGET: PostgreSQL cluster of talo_mos_v4_test, run as a role with CREATEROLE (admin), connected to database postgres.
-- talo_foundation_reader never logs in, inherits nothing and only owns the foundation_read_api functions (03).

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_foundation_reader') THEN
    RAISE EXCEPTION 'Abort: role talo_foundation_reader already exists; review manually';
  END IF;
END
$$;

CREATE ROLE talo_foundation_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMENT ON ROLE talo_foundation_reader IS
  'SCC 0.1.2: NOLOGIN owner of foundation_read_api SECURITY DEFINER readers (fnd_module_events, fnd_data_access_rules). No login, no members.';
