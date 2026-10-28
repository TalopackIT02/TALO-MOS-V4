-- Read-only catalog verification after 01-03. Run as database admin on talo_mos_v4_test.
\set ON_ERROR_STOP on
SET default_transaction_read_only = on;

DO $verify$
DECLARE
  v_owner oid := (SELECT oid FROM pg_roles WHERE rolname = 'talo_audit_reader');
  v_f regprocedure := to_regprocedure('audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer)');
  v_i regprocedure := to_regprocedure('audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer)');
  v_s regprocedure := to_regprocedure('audit_api.read_foundation_audit_summary(timestamptz,timestamptz)');
  v_errors text[] := '{}';
  r record;
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF v_owner IS NULL THEN v_errors := v_errors || 'owner role missing'; END IF;
  IF v_f IS NULL OR v_i IS NULL OR v_s IS NULL THEN v_errors := v_errors || 'one or more audit functions missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid = v_owner
               AND (rolcanlogin OR rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)) THEN
    v_errors := v_errors || 'owner role attributes are broader than approved';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_owner OR roleid = v_owner) THEN
    v_errors := v_errors || 'owner role has a membership path';
  END IF;

  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p
            WHERE p.oid IN (v_f::oid, v_i::oid, v_s::oid)
              AND (NOT p.prosecdef OR p.proowner <> v_owner
                   OR NOT coalesce(p.proconfig,'{}') @> ARRAY['search_path=pg_catalog','statement_timeout=5s']) LOOP
    v_errors := v_errors || format('unsafe function properties: %s', r.fn);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p, aclexplode(p.proacl) a
            WHERE p.oid IN (v_f::oid, v_i::oid, v_s::oid) AND a.grantee = 0 LOOP
    v_errors := v_errors || format('PUBLIC can execute: %s', r.fn);
  END LOOP;
  IF v_f IS NOT NULL AND NOT has_function_privilege('talo_app', v_f, 'EXECUTE') THEN
    v_errors := v_errors || 'talo_app cannot execute Foundation reader';
  END IF;
  IF v_i IS NOT NULL AND NOT has_function_privilege('talo_app', v_i, 'EXECUTE') THEN
    v_errors := v_errors || 'talo_app cannot execute IAM reader';
  END IF;
  IF v_s IS NOT NULL AND NOT has_function_privilege('talo_app', v_s, 'EXECUTE') THEN
    v_errors := v_errors || 'talo_app cannot execute Foundation audit summary';
  END IF;
  IF has_any_column_privilege('talo_app','foundation.fnd_audit_logs','SELECT')
     OR has_any_column_privilege('talo_app','iam.iam_audit_logs','SELECT') THEN
    v_errors := v_errors || 'talo_app has direct audit-table SELECT';
  END IF;

  IF cardinality(v_errors) > 0 THEN
    RAISE EXCEPTION E'SCC audit verify FAILED (% issue(s)):\n  %', cardinality(v_errors), array_to_string(v_errors,E'\n  ');
  END IF;
  RAISE NOTICE 'SCC audit static verification: OK';
END
$verify$;
