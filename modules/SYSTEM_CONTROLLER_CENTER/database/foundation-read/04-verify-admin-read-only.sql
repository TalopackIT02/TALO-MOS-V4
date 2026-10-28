-- TALO-MOS-V4 · SCC 0.1.2 Foundation controlled read · 04 — structural verification (admin, READ ONLY)
-- Every check raises on failure; success prints one PASS line per check.
\set ON_ERROR_STOP on
SET default_transaction_read_only = on;

DO $$
DECLARE
  v_fn text;
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN RAISE EXCEPTION 'Abort: talo_mos_v4_test only'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_foundation_reader' AND NOT rolcanlogin AND NOT rolinherit
                   AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'FAIL R1: talo_foundation_reader attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.member, m.roleid) WHERE r.rolname = 'talo_foundation_reader') THEN
    RAISE EXCEPTION 'FAIL R2: talo_foundation_reader has memberships';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer)',
    'foundation_read_api.read_data_access_rules(uuid,boolean,integer,integer)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND p.prosecdef
                     AND pg_get_userbyid(p.proowner) = 'talo_foundation_reader'
                     AND p.proconfig = ARRAY['search_path=pg_catalog']) THEN
      RAISE EXCEPTION 'FAIL F1: % must be SECURITY DEFINER, owned by talo_foundation_reader, search_path=pg_catalog', v_fn;
    END IF;
    IF NOT has_function_privilege('talo_app', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL F2: talo_app cannot execute %', v_fn; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = to_regprocedure(v_fn) AND a.privilege_type = 'EXECUTE'
                  AND a.grantee NOT IN ((SELECT oid FROM pg_roles WHERE rolname = 'talo_app'), p.proowner)) THEN
      RAISE EXCEPTION 'FAIL F3: % is executable by a role other than talo_app / owner (PUBLIC?)', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'foundation_read_api'::regnamespace) <> 2 THEN
    RAISE EXCEPTION 'FAIL F4: foundation_read_api must contain exactly the two proposed functions';
  END IF;
  IF has_schema_privilege('public', 'foundation_read_api', 'USAGE') OR has_schema_privilege('public', 'foundation_read_api', 'CREATE')
     OR has_schema_privilege('talo_app', 'foundation_read_api', 'CREATE') THEN
    RAISE EXCEPTION 'FAIL S1: foundation_read_api schema privileges too wide';
  END IF;

  IF has_table_privilege('talo_app', 'foundation.fnd_module_events', 'SELECT')
     OR has_any_column_privilege('talo_app', 'foundation.fnd_module_events', 'SELECT')
     OR has_any_column_privilege('talo_app', 'foundation.fnd_data_access_rules', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL P1: talo_app must not read target tables directly';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace IN ('foundation'::regnamespace, 'iam'::regnamespace) AND c.relkind IN ('r','p','v','m')
               AND c.oid NOT IN ('foundation.fnd_module_events'::regclass, 'foundation.fnd_data_access_rules'::regclass)
               AND has_any_column_privilege('talo_foundation_reader', c.oid, 'SELECT')) THEN
    RAISE EXCEPTION 'FAIL P2: talo_foundation_reader reads a table outside the two targets';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace IN ('foundation'::regnamespace, 'iam'::regnamespace) AND c.relkind IN ('r','p')
               AND (has_any_column_privilege('talo_foundation_reader', c.oid, 'INSERT') OR has_any_column_privilege('talo_foundation_reader', c.oid, 'UPDATE')
                    OR has_table_privilege('talo_foundation_reader', c.oid, 'DELETE') OR has_table_privilege('talo_foundation_reader', c.oid, 'TRUNCATE'))) THEN
    RAISE EXCEPTION 'FAIL P3: talo_foundation_reader has a write privilege';
  END IF;
  RAISE NOTICE 'PASS 04: role, functions, ACL and least privilege verified';
END
$$;
