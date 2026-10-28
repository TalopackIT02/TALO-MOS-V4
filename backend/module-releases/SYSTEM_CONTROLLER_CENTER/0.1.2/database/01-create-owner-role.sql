-- TALO-MOS-V4 · SCC Audit Read · 01 — dedicated SECURITY DEFINER owner (cluster level)
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED.
-- TARGET: maintenance database "postgres", as a role with CREATEROLE.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Abort: connect to postgres (currently "%")', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_audit_reader') THEN
    RAISE EXCEPTION 'Abort: talo_audit_reader already exists; review it manually';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_app') THEN
    RAISE EXCEPTION 'Abort: talo_app does not exist';
  END IF;
END
$$;

BEGIN;
CREATE ROLE talo_audit_reader
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
COMMENT ON ROLE talo_audit_reader IS
  'TALO-MOS SCC: owner of three bounded audit read functions only; NOLOGIN and column grants only.';
COMMIT;

SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolbypassrls
  FROM pg_roles WHERE rolname = 'talo_audit_reader';
