-- TALO-MOS-V4 · P-4e recovery · 04 — read-only verification (test database), self-asserting.
-- Run as admin after 01-03. Raises with the list of violations, otherwise NOTICE "P-4e verify: OK".
-- Checks: owner attributes, role memberships (inheritance / SET ROLE paths), function properties, EXECUTE holders,
-- other SECURITY DEFINER functions reachable by talo_provisioner, objects owned by the owner, and the EFFECTIVE
-- privilege matrix (table and column level) of talo_provisioner and talo_credential_recovery against expectations.

\set ON_ERROR_STOP on
SET default_transaction_read_only = on;

DO $verify$
DECLARE
  v_fn     regprocedure := to_regprocedure('iam.reissue_temporary_credential(text,text,uuid)');
  v_owner  oid := (SELECT oid FROM pg_roles WHERE rolname = 'talo_credential_recovery');
  v_prov   oid := (SELECT oid FROM pg_roles WHERE rolname = 'talo_provisioner');
  v_errors text[] := '{}';
  r        record;
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF v_prov IS NULL THEN RAISE EXCEPTION 'Abort: talo_provisioner missing'; END IF;
  IF v_owner IS NULL THEN v_errors := v_errors || 'owner role talo_credential_recovery missing'::text; END IF;
  IF v_fn IS NULL THEN v_errors := v_errors || 'function iam.reissue_temporary_credential(text,text,uuid) missing'::text; END IF;

  -- A. owner attributes: NOLOGIN, no superuser/createrole/createdb/bypassrls/replication, NOINHERIT
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid = v_owner
               AND (rolcanlogin OR rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN
    v_errors := v_errors || 'owner attributes broader than NOLOGIN/NOINHERIT/no special privileges'::text;
  END IF;

  -- B. memberships: nobody may SET ROLE / inherit the owner; owner and provisioner are members of nothing
  FOR r IN SELECT pg_get_userbyid(m.member) AS member, pg_get_userbyid(m.roleid) AS granted
             FROM pg_auth_members m WHERE m.roleid = v_owner OR m.member = v_owner OR m.member = v_prov LOOP
    v_errors := v_errors || format('unexpected membership: %s is member of %s', r.member, r.granted);
  END LOOP;

  -- C. function properties
  IF v_fn IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = v_fn AND p.prosecdef AND p.proowner = v_owner AND l.lanname = 'plpgsql'
                      AND p.pronamespace = 'iam'::regnamespace
                      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp', 'lock_timeout=5s']) THEN
      v_errors := v_errors || 'function properties differ (SECURITY DEFINER / owner / plpgsql / search_path / lock_timeout)'::text;
    END IF;
    -- D. EXECUTE holders: only talo_provisioner (and the owner); no PUBLIC entry
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_fn AND a.grantee = 0) OR
       (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = v_fn) THEN
      v_errors := v_errors || 'PUBLIC can execute the function'::text;
    END IF;
    FOR r IN SELECT rolname FROM pg_roles
              WHERE NOT rolsuper AND rolname NOT IN ('talo_provisioner', 'talo_credential_recovery')
                AND has_function_privilege(oid, v_fn, 'EXECUTE') LOOP
      v_errors := v_errors || format('unexpected EXECUTE holder: %s', r.rolname);
    END LOOP;
  END IF;
  IF v_fn IS NULL OR NOT has_function_privilege(v_prov, v_fn, 'EXECUTE') THEN
    v_errors := v_errors || 'talo_provisioner cannot EXECUTE the function'::text;
  END IF;

  -- E. other SECURITY DEFINER functions reachable by talo_provisioner outside pg_catalog / information_schema
  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p
            WHERE p.prosecdef AND p.oid IS DISTINCT FROM v_fn
              AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
              AND has_function_privilege(v_prov, p.oid, 'EXECUTE') LOOP
    v_errors := v_errors || format('talo_provisioner can execute another SECURITY DEFINER function: %s', r.fn);
  END LOOP;

  -- F. the owner owns exactly this function and nothing else; no default privileges
  IF v_owner IS NOT NULL THEN
    IF (SELECT count(*) FROM pg_proc WHERE proowner = v_owner) <> 1
       OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = v_owner)
       OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = v_owner)
       OR EXISTS (SELECT 1 FROM pg_type WHERE typowner = v_owner)
       OR EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole = v_owner) THEN
      v_errors := v_errors || 'owner owns other objects or has default privileges'::text;
    END IF;
  END IF;

  -- G. effective table-level matrix (any column for SELECT/INSERT/UPDATE/REFERENCES) vs expectation
  FOR r IN
    WITH roles(role) AS (VALUES ('talo_provisioner'), ('talo_credential_recovery')),
    privs(priv) AS (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')),
    actual AS (
      SELECT ro.role, c.relname::text AS tbl, pr.priv
        FROM roles ro CROSS JOIN privs pr
        JOIN pg_class c ON c.relnamespace = 'iam'::regnamespace AND c.relkind = 'r'
       WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ro.role)
         AND CASE WHEN pr.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                  THEN has_any_column_privilege(ro.role, c.oid, pr.priv)
                  ELSE has_table_privilege(ro.role, c.oid, pr.priv) END),
    expected(role, tbl, priv) AS (VALUES
      ('talo_provisioner', 'iam_memberships', 'SELECT'), ('talo_provisioner', 'iam_memberships', 'INSERT'),
      ('talo_provisioner', 'iam_user_accounts', 'SELECT'), ('talo_provisioner', 'iam_user_accounts', 'INSERT'),
      ('talo_provisioner', 'iam_credentials', 'INSERT'), ('talo_provisioner', 'iam_audit_logs', 'INSERT'),
      ('talo_credential_recovery', 'iam_user_accounts', 'SELECT'), ('talo_credential_recovery', 'iam_user_accounts', 'UPDATE'),
      ('talo_credential_recovery', 'iam_memberships', 'SELECT'), ('talo_credential_recovery', 'iam_user_roles', 'SELECT'),
      ('talo_credential_recovery', 'iam_user_permissions', 'SELECT'), ('talo_credential_recovery', 'iam_credentials', 'SELECT'),
      ('talo_credential_recovery', 'iam_credentials', 'UPDATE'), ('talo_credential_recovery', 'iam_sessions', 'SELECT'),
      ('talo_credential_recovery', 'iam_sessions', 'UPDATE'), ('talo_credential_recovery', 'iam_audit_logs', 'INSERT'))
    SELECT 'unexpected' AS kind, * FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) x
    UNION ALL
    SELECT 'missing', * FROM (SELECT * FROM expected e WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = e.role)
                              EXCEPT SELECT * FROM actual) y
  LOOP
    v_errors := v_errors || format('%s privilege: %s %s on iam.%s', r.kind, r.role, r.priv, r.tbl);
  END LOOP;

  -- H. exact column sets of the owner (SELECT and UPDATE)
  IF v_owner IS NOT NULL THEN
    FOR r IN
      WITH actual AS (
        SELECT c.relname::text AS tbl, a.attname::text AS col, pr.priv
          FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          CROSS JOIN (VALUES ('SELECT'), ('UPDATE'), ('INSERT')) pr(priv)
         WHERE c.relnamespace = 'iam'::regnamespace AND c.relkind = 'r'
           AND has_column_privilege(v_owner, c.oid, a.attnum, pr.priv)
           AND NOT (c.relname = 'iam_audit_logs' AND pr.priv = 'INSERT')),
      expected(tbl, col, priv) AS (VALUES
        ('iam_user_accounts', 'user_account_id', 'SELECT'), ('iam_user_accounts', 'membership_id', 'SELECT'),
        ('iam_user_accounts', 'username', 'SELECT'), ('iam_user_accounts', 'account_status', 'SELECT'),
        ('iam_user_accounts', 'disabled_at', 'SELECT'), ('iam_user_accounts', 'account_status', 'UPDATE'),
        ('iam_memberships', 'membership_id', 'SELECT'), ('iam_memberships', 'membership_status', 'SELECT'),
        ('iam_memberships', 'left_at', 'SELECT'),
        ('iam_user_roles', 'user_account_id', 'SELECT'), ('iam_user_roles', 'revoked_at', 'SELECT'),
        ('iam_user_permissions', 'user_account_id', 'SELECT'), ('iam_user_permissions', 'revoked_at', 'SELECT'),
        ('iam_credentials', 'user_account_id', 'SELECT'), ('iam_credentials', 'updated_at', 'SELECT'),
        ('iam_credentials', 'password_hash', 'UPDATE'), ('iam_credentials', 'must_change_password', 'UPDATE'),
        ('iam_credentials', 'failed_attempt_count', 'UPDATE'), ('iam_credentials', 'locked_until', 'UPDATE'),
        ('iam_credentials', 'updated_at', 'UPDATE'),
        ('iam_sessions', 'user_account_id', 'SELECT'), ('iam_sessions', 'revoked_at', 'SELECT'),
        ('iam_sessions', 'revoked_at', 'UPDATE'))
      SELECT 'unexpected' AS kind, * FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) x
      UNION ALL SELECT 'missing', * FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) y
    LOOP
      v_errors := v_errors || format('%s owner column privilege: %s(%s) on iam.%s', r.kind, r.priv, r.col, r.tbl);
    END LOOP;
  END IF;

  IF cardinality(v_errors) > 0 THEN
    RAISE EXCEPTION E'P-4e verify FAILED (% issue(s)):\n  %', cardinality(v_errors), array_to_string(v_errors, E'\n  ');
  END IF;
  RAISE NOTICE 'P-4e verify: OK';
END
$verify$;
