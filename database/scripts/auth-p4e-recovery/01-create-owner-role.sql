-- TALO-MOS-V4 · P-4e recovery · 01 — owner role of the SECURITY DEFINER function (cluster level)
-- STATUS: PROPOSAL FOR REVIEW — NOT EXECUTED. Run only after explicit approval.
-- TARGET: maintenance database "postgres", as a role with CREATEROLE. NOLOGIN: nobody can connect as this role.
-- Contains no DROP/TRUNCATE.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Abort: connect to the maintenance database "postgres" (currently connected to "%")', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_credential_recovery') THEN
    RAISE EXCEPTION 'Abort: talo_credential_recovery already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_provisioner') THEN
    RAISE EXCEPTION 'Abort: talo_provisioner does not exist';
  END IF;
END
$$;

BEGIN;
CREATE ROLE talo_credential_recovery
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
COMMENT ON ROLE talo_credential_recovery IS
  'TALO-MOS P-4e: owner of iam.reissue_temporary_credential only (SECURITY DEFINER). NOLOGIN, column-level grants.';
COMMIT;

SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolbypassrls,
       (SELECT count(*) FROM pg_auth_members WHERE member = r.oid OR roleid = r.oid) AS memberships
FROM pg_roles r WHERE rolname = 'talo_credential_recovery';
