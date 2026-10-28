-- TALO-MOS-V4 · SCC Audit Read · 03 — bounded audit readers exposed to talo_app
-- STATUS: PROPOSAL FOR OWNER APPROVAL — NOT EXECUTED.
-- TARGET: talo_mos_v4_test only, as admin able to change function ownership.
-- talo_app gets EXECUTE only. Raw audit-table SELECT remains denied.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' THEN
    RAISE EXCEPTION 'Abort: run on talo_mos_v4_test (currently "%")', current_database();
  END IF;
  IF to_regnamespace('audit_api') IS NOT NULL THEN
    RAISE EXCEPTION 'Abort: schema audit_api already exists; review manually';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_audit_reader'
                   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Abort: restricted owner talo_audit_reader is missing';
  END IF;
END
$$;

BEGIN;
CREATE SCHEMA audit_api;
REVOKE ALL ON SCHEMA audit_api FROM PUBLIC;
GRANT USAGE ON SCHEMA audit_api TO talo_audit_reader, talo_app;

CREATE FUNCTION audit_api.read_foundation_audit(
  p_from timestamptz, p_to timestamptz, p_outcome text, p_action text, p_actor uuid, p_limit integer)
RETURNS TABLE (
  event_id text, source text, occurred_at text, actor_account_id text, actor_username text,
  action_code text, target_type text, target_id text, outcome text, reason text, error_code text,
  correlation_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER ROWS 501
SET search_path = pg_catalog
SET statement_timeout = '5s'
AS $fn$
BEGIN
  IF session_user <> 'talo_app' THEN
    RAISE insufficient_privilege USING MESSAGE = 'audit reader: caller not allowed';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > interval '31 days'
     OR p_outcome IS NULL OR p_outcome NOT IN ('ALL','ISSUES','SUCCESS','FAILURE','DENIED')
     OR p_action IS NULL OR length(p_action) > 80 OR p_action !~ '^[A-Za-z0-9_.-]*$'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 501 THEN
    RAISE invalid_parameter_value USING MESSAGE = 'audit reader: invalid filter';
  END IF;

  RETURN QUERY
  SELECT l.event_id::text, 'FOUNDATION'::text,
         to_char(l.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         l.actor_account_id::text, a.username::text, l.action_code::text, l.target_type::text,
         l.target_id::text, l.outcome::text,
         CASE WHEN length(l.metadata->>'reason') BETWEEN 1 AND 100
                    AND (l.metadata->>'reason') ~ '^[A-Za-z0-9_. -]+$' THEN l.metadata->>'reason' END,
         CASE WHEN length(l.metadata->>'errorCode') BETWEEN 1 AND 100
                    AND (l.metadata->>'errorCode') ~ '^[A-Za-z0-9_. -]+$' THEN l.metadata->>'errorCode' END,
         l.correlation_id::text
    FROM foundation.fnd_audit_logs AS l
    LEFT JOIN iam.iam_user_accounts AS a ON a.user_account_id = l.actor_account_id
   WHERE l.occurred_at >= p_from AND l.occurred_at <= p_to
     AND (p_outcome = 'ALL' OR (p_outcome = 'ISSUES' AND l.outcome IN ('FAILURE','DENIED')) OR l.outcome = p_outcome)
     AND (p_action = '' OR l.action_code ILIKE '%' || p_action || '%')
     AND (p_actor IS NULL OR l.actor_account_id = p_actor)
   ORDER BY l.occurred_at DESC, l.event_id DESC
   LIMIT p_limit;
END
$fn$;

CREATE FUNCTION audit_api.read_iam_audit(
  p_from timestamptz, p_to timestamptz, p_outcome text, p_action text, p_actor uuid, p_limit integer)
RETURNS TABLE (
  event_id text, source text, occurred_at text, actor_account_id text, actor_username text,
  action_code text, target_type text, target_id text, outcome text, reason text, error_code text,
  correlation_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER ROWS 501
SET search_path = pg_catalog
SET statement_timeout = '5s'
AS $fn$
BEGIN
  IF session_user <> 'talo_app' THEN
    RAISE insufficient_privilege USING MESSAGE = 'audit reader: caller not allowed';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > interval '31 days'
     OR p_outcome IS NULL OR p_outcome NOT IN ('ALL','ISSUES','SUCCESS','FAILURE','DENIED')
     OR p_action IS NULL OR length(p_action) > 80 OR p_action !~ '^[A-Za-z0-9_.-]*$'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 501 THEN
    RAISE invalid_parameter_value USING MESSAGE = 'audit reader: invalid filter';
  END IF;

  RETURN QUERY
  SELECT l.audit_id::text, 'IAM'::text,
         to_char(l.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         l.actor_account_id::text, a.username::text, l.action_code::text, l.target_type::text,
         l.target_id::text, l.outcome::text,
         CASE WHEN length(l.metadata->>'reason') BETWEEN 1 AND 100
                    AND (l.metadata->>'reason') ~ '^[A-Za-z0-9_. -]+$' THEN l.metadata->>'reason' END,
         CASE WHEN length(l.metadata->>'errorCode') BETWEEN 1 AND 100
                    AND (l.metadata->>'errorCode') ~ '^[A-Za-z0-9_. -]+$' THEN l.metadata->>'errorCode' END,
         NULL::text
    FROM iam.iam_audit_logs AS l
    LEFT JOIN iam.iam_user_accounts AS a ON a.user_account_id = l.actor_account_id
   WHERE l.occurred_at >= p_from AND l.occurred_at <= p_to
     AND (p_outcome = 'ALL' OR (p_outcome = 'ISSUES' AND l.outcome IN ('FAILURE','DENIED')) OR l.outcome = p_outcome)
     AND (p_action = '' OR l.action_code ILIKE '%' || p_action || '%')
     AND (p_actor IS NULL OR l.actor_account_id = p_actor)
   ORDER BY l.occurred_at DESC, l.audit_id DESC
   LIMIT p_limit;
END
$fn$;

CREATE FUNCTION audit_api.read_foundation_audit_summary(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (denied integer, failures integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER ROWS 1
SET search_path = pg_catalog
SET statement_timeout = '5s'
AS $fn$
BEGIN
  IF session_user <> 'talo_app' THEN
    RAISE insufficient_privilege USING MESSAGE = 'audit summary: caller not allowed';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > interval '24 hours' THEN
    RAISE invalid_parameter_value USING MESSAGE = 'audit summary: invalid interval';
  END IF;
  RETURN QUERY
  SELECT count(*) FILTER (WHERE l.outcome = 'DENIED')::integer,
         count(*) FILTER (WHERE l.outcome = 'FAILURE')::integer
    FROM foundation.fnd_audit_logs AS l
   WHERE l.occurred_at >= p_from AND l.occurred_at <= p_to;
END
$fn$;

ALTER FUNCTION audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer) OWNER TO talo_audit_reader;
ALTER FUNCTION audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer) OWNER TO talo_audit_reader;
ALTER FUNCTION audit_api.read_foundation_audit_summary(timestamptz,timestamptz) OWNER TO talo_audit_reader;
REVOKE ALL ON FUNCTION audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_api.read_foundation_audit_summary(timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer) TO talo_app;
GRANT EXECUTE ON FUNCTION audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer) TO talo_app;
GRANT EXECUTE ON FUNCTION audit_api.read_foundation_audit_summary(timestamptz,timestamptz) TO talo_app;
COMMENT ON FUNCTION audit_api.read_foundation_audit(timestamptz,timestamptz,text,text,uuid,integer) IS
  'SCC bounded projection of Foundation audit; talo_app EXECUTE only; 31 days and 501 rows maximum.';
COMMENT ON FUNCTION audit_api.read_iam_audit(timestamptz,timestamptz,text,text,uuid,integer) IS
  'SCC bounded projection of IAM audit; talo_app EXECUTE only; 31 days and 501 rows maximum.';
COMMENT ON FUNCTION audit_api.read_foundation_audit_summary(timestamptz,timestamptz) IS
  'SCC Foundation audit health counters; talo_app EXECUTE only; 24 hours maximum.';
COMMIT;
