-- TALO-MOS-V4 · Foundation F1 · 03 — create least-privilege login roles (cluster level)
-- STATUS: PREPARED, NOT EXECUTED. Requires a separate execution approval.
-- TARGET: cluster talo-mos-v4-postgres, connected to the maintenance database "postgres" as a role that can
--         create roles. Roles are cluster-wide; privileges are granted per database in 04 (test DB only).
-- No passwords are stored here: set them interactively afterwards with psql `\password talo_app` and
-- `\password talo_provisioner` (sent as a SCRAM hash, never in plain text).
-- Contains no DROP/TRUNCATE.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Abort: connect to the maintenance database "postgres" (currently connected to "%")', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('talo_app', 'talo_provisioner')) THEN
    RAISE EXCEPTION 'Abort: talo_app or talo_provisioner already exists';
  END IF;
END
$$;

BEGIN;

-- Backend runtime role (authentication/session/audit operations only). Never a superuser.
CREATE ROLE talo_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 20;

-- IT provisioning role (create membership/account/credential + audit). Separate from the runtime role.
CREATE ROLE talo_provisioner
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 2;

COMMENT ON ROLE talo_app IS 'TALO-MOS backend runtime (least privilege; see database/scripts/foundation-f1)';
COMMENT ON ROLE talo_provisioner IS 'TALO-MOS IT account provisioning (least privilege; see database/scripts/foundation-f1)';

COMMIT;

-- PENDING DECISION (values not approved yet) — session safety limits per role, e.g.:
--   ALTER ROLE talo_app SET statement_timeout = '<value>';
--   ALTER ROLE talo_app SET lock_timeout = '<value>';
--   ALTER ROLE talo_app SET idle_in_transaction_session_timeout = '<value>';

-- Post-check
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin, rolconnlimit
FROM pg_roles WHERE rolname IN ('talo_app', 'talo_provisioner') ORDER BY rolname;
