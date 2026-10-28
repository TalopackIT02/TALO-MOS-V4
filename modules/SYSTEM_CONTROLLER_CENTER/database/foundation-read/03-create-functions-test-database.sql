-- TALO-MOS-V4 · SCC 0.1.2 Foundation controlled read · 03 — bounded readers exposed to talo_app
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED ON TEST.
-- TARGET: talo_mos_v4_test, as admin (able to change function ownership).
-- talo_app gets EXECUTE only. Raw SELECT on fnd_module_events / fnd_data_access_rules remains denied.
-- No free-form JSON leaves the database: lifecycle states are reduced to allow-listed, format-checked keys.
-- Timeout: the Module Host runs every read in a READ ONLY transaction with SET LOCAL statement_timeout = 5000
-- (a function-level SET statement_timeout is not effective and is deliberately not declared here).

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF to_regnamespace('foundation_read_api') IS NOT NULL THEN
    RAISE EXCEPTION 'Abort: schema foundation_read_api already exists; review manually';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_foundation_reader'
                   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Abort: restricted owner talo_foundation_reader is missing';
  END IF;
  IF NOT has_column_privilege('talo_foundation_reader', 'foundation.fnd_module_events', 'event_type', 'SELECT')
     OR NOT has_column_privilege('talo_foundation_reader', 'foundation.fnd_data_access_rules', 'access_rule_id', 'SELECT') THEN
    RAISE EXCEPTION 'Abort: run 02 first';
  END IF;
END
$$;

BEGIN;
CREATE SCHEMA foundation_read_api;
REVOKE ALL ON SCHEMA foundation_read_api FROM PUBLIC;
GRANT USAGE ON SCHEMA foundation_read_api TO talo_foundation_reader, talo_app;

-- B07 lifecycle events, newest first. Window <= 366 days, page <= 101 rows, offset <= 100000.
CREATE FUNCTION foundation_read_api.read_module_events(
  p_from timestamptz, p_to timestamptz, p_module_id uuid, p_event_type text, p_limit integer, p_offset integer)
RETURNS TABLE (
  event_id text, module_id text, version_id text, event_type text, actor_account_id text, occurred_at text,
  correlation_id text, before_status text, after_status text, before_enabled text, after_enabled text, manifest_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER ROWS 101
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF session_user <> 'talo_app' THEN
    RAISE insufficient_privilege USING MESSAGE = 'foundation reader: caller not allowed';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > interval '366 days'
     OR p_event_type IS NULL OR (p_event_type <> '' AND p_event_type NOT IN
        ('REGISTER','SUBMIT','APPROVE','REJECT','ACTIVATE','RETIRE','ROLLBACK','ENABLE','DISABLE'))
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE invalid_parameter_value USING MESSAGE = 'foundation reader: invalid filter';
  END IF;

  RETURN QUERY
  SELECT e.event_id::text, e.module_id::text, e.version_id::text, e.event_type::text, e.actor_account_id::text,
         to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         CASE WHEN e.correlation_id ~ '^[A-Za-z0-9_.:-]{1,100}$' THEN e.correlation_id::text END,
         CASE WHEN (e.before_state->>'status') ~ '^[A-Z_]{1,40}$' THEN e.before_state->>'status' END,
         CASE WHEN (e.after_state->>'status') ~ '^[A-Z_]{1,40}$' THEN e.after_state->>'status' END,
         CASE WHEN jsonb_typeof(e.before_state->'is_enabled') = 'boolean' THEN e.before_state->>'is_enabled' END,
         CASE WHEN jsonb_typeof(e.after_state->'is_enabled') = 'boolean' THEN e.after_state->>'is_enabled' END,
         CASE WHEN (e.after_state->>'manifest_hash') ~ '^[0-9a-f]{64}$' THEN e.after_state->>'manifest_hash' END
    FROM foundation.fnd_module_events AS e
   WHERE e.occurred_at >= p_from AND e.occurred_at <= p_to
     AND (p_module_id IS NULL OR e.module_id = p_module_id)
     AND (p_event_type = '' OR e.event_type = p_event_type)
   ORDER BY e.occurred_at DESC, e.event_id DESC
   LIMIT p_limit OFFSET p_offset;
END
$fn$;

-- Data access rules (MIC-06 governance), stable order. Page <= 101 rows, offset <= 100000.
CREATE FUNCTION foundation_read_api.read_data_access_rules(
  p_data_contract_id uuid, p_enabled boolean, p_limit integer, p_offset integer)
RETURNS TABLE (
  access_rule_id text, data_contract_id text, version_action_id text, data_operation text, approval_mode text,
  workflow_key text, is_enabled text, created_at text)
LANGUAGE plpgsql STABLE SECURITY DEFINER ROWS 101
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF session_user <> 'talo_app' THEN
    RAISE insufficient_privilege USING MESSAGE = 'foundation reader: caller not allowed';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE invalid_parameter_value USING MESSAGE = 'foundation reader: invalid page';
  END IF;

  RETURN QUERY
  SELECT r.access_rule_id::text, r.data_contract_id::text, r.version_action_id::text, r.data_operation::text,
         r.approval_mode::text,
         CASE WHEN r.workflow_key ~ '^[A-Za-z0-9_.:-]{1,150}$' THEN r.workflow_key::text END,
         r.is_enabled::text,
         to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM foundation.fnd_data_access_rules AS r
   WHERE (p_data_contract_id IS NULL OR r.data_contract_id = p_data_contract_id)
     AND (p_enabled IS NULL OR r.is_enabled = p_enabled)
   ORDER BY r.access_rule_id
   LIMIT p_limit OFFSET p_offset;
END
$fn$;

ALTER FUNCTION foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer) OWNER TO talo_foundation_reader;
ALTER FUNCTION foundation_read_api.read_data_access_rules(uuid,boolean,integer,integer) OWNER TO talo_foundation_reader;
REVOKE ALL ON FUNCTION foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION foundation_read_api.read_data_access_rules(uuid,boolean,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer) TO talo_app;
GRANT EXECUTE ON FUNCTION foundation_read_api.read_data_access_rules(uuid,boolean,integer,integer) TO talo_app;
COMMENT ON FUNCTION foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer) IS
  'SCC 0.1.2 bounded projection of B07 lifecycle events; talo_app EXECUTE only; 366 days, 101 rows, offset 100000 maximum.';
COMMENT ON FUNCTION foundation_read_api.read_data_access_rules(uuid,boolean,integer,integer) IS
  'SCC 0.1.2 bounded projection of Foundation data access rules; talo_app EXECUTE only; 101 rows, offset 100000 maximum.';
COMMIT;
