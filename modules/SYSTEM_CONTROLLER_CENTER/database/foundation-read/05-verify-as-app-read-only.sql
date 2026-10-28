-- TALO-MOS-V4 · SCC 0.1.2 Foundation controlled read · 05 — runtime verification as talo_app (READ ONLY)
-- Connect directly as talo_app to talo_mos_v4_test. Raises on any unexpected result.
\set ON_ERROR_STOP on
SET default_transaction_read_only = on;

DO $$
BEGIN
  IF current_database() <> 'talo_mos_v4_test' OR current_user <> 'talo_app' OR session_user <> 'talo_app' THEN
    RAISE EXCEPTION 'Abort: connect directly as talo_app to talo_mos_v4_test (db=%, current=%, session=%)',
      current_database(), current_user, session_user;
  END IF;
END
$$;

SELECT 'MODULE_EVENTS_366D' AS reader, count(*) AS returned_rows
  FROM foundation_read_api.read_module_events(now() - interval '366 days', now(), NULL, '', 101, 0);
SELECT 'MODULE_EVENTS_SCC' AS reader, count(*) AS returned_rows
  FROM foundation_read_api.read_module_events(now() - interval '366 days', now(),
       (SELECT module_id FROM foundation.fnd_modules WHERE module_key = 'SYSTEM_CONTROLLER_CENTER'), '', 101, 0);
SELECT 'DATA_ACCESS_RULES' AS reader, count(*) AS returned_rows
  FROM foundation_read_api.read_data_access_rules(NULL, NULL, 101, 0);

DO $$
DECLARE
  v_cases text[] := ARRAY[
    $q$SELECT 1 FROM foundation_read_api.read_module_events(NULL, now(), NULL, '', 10, 0)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_module_events(now(), now() - interval '1 day', NULL, '', 10, 0)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_module_events(now() - interval '367 days', now(), NULL, '', 10, 0)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_module_events(now() - interval '1 day', now(), NULL, 'DROP', 10, 0)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_module_events(now() - interval '1 day', now(), NULL, NULL, 10, 0)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_module_events(now() - interval '1 day', now(), NULL, '', 102, 0)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_module_events(now() - interval '1 day', now(), NULL, '', 10, -1)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_module_events(now() - interval '1 day', now(), NULL, '', 10, 100001)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_data_access_rules(NULL, NULL, 0, 0)$q$,
    $q$SELECT 1 FROM foundation_read_api.read_data_access_rules(NULL, NULL, 10, 100001)$q$];
  v_case text;
  v_state text;
BEGIN
  FOREACH v_case IN ARRAY v_cases LOOP
    BEGIN
      EXECUTE v_case;
      RAISE EXCEPTION 'FAIL: invalid input accepted: %', v_case;
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM 1 FROM foundation.fnd_module_events LIMIT 1;
    RAISE EXCEPTION 'FAIL: direct fnd_module_events SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM foundation.fnd_data_access_rules LIMIT 1;
    RAISE EXCEPTION 'FAIL: direct fnd_data_access_rules SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SET LOCAL ROLE talo_foundation_reader;
    RAISE EXCEPTION 'FAIL: talo_app could assume talo_foundation_reader';
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  RAISE NOTICE 'PASS 05: 10 invalid inputs -> 22023, raw SELECT -> 42501, SET ROLE -> 42501';
END
$$;

-- Result shape: exactly the declared columns, no JSON column.
SELECT 'SHAPE_MODULE_EVENTS' AS reader, string_agg(a.attname, ',' ORDER BY a.attnum) AS columns
  FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargnames[7:], p.proallargtypes[7:]) WITH ORDINALITY AS a(attname, atttype, attnum)
 WHERE p.oid = 'foundation_read_api.read_module_events(timestamptz,timestamptz,uuid,text,integer,integer)'::regprocedure;
