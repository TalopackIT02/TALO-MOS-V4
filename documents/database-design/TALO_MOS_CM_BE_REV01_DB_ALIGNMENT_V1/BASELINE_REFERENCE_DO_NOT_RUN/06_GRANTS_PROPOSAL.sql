-- =====================================================================================================================
-- CM V1 REV01 -- 06 RUNTIME GRANTS FOR talo_app -- PROPOSAL -- talo_mos_v4_test ONLY
-- STATUS : DRAFT, NOT EXECUTED, NOT APPROVED. Grants are a protected change (CLAUDE.md rule 4).
-- Source : REV01 06_FOUNDATION_IAM_AND_GRANTS.md "GRANT khuyen nghi" + 04 A.1 / C; base matrix = 7-table draft
--          (CM_DB_V1_SQL_DRAFT_20261029-115639/05), extended for the new columns.
-- PII GATE: after this file, the SCC Data Inspector (it reads every table talo_app may SELECT, no allowlist:
--          modules/SYSTEM_CONTROLLER_CENTER/backend/data-inspector.sql.ts:17-30) shows cm.* rows including legal name,
--          legal identifier, representative phone, addresses and contacts. The owner must accept this risk for TEST
--          (not PROD) before running, and the operator must pass:  -v pii_risk_ack=ACCEPT_TEST_PII_RISK
-- Order  : after 03 + 04 (+ 05) COMMITTED and 07 verification PASSED with GRANTS: NOT_APPLIED.
-- Run    : docker exec talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test -X -v ON_ERROR_STOP=1 \
--                 -v pii_risk_ack=ACCEPT_TEST_PII_RISK -f <file>
-- Effect : one transaction, issued AS talo_cm_owner. Only talo_app receives privileges:
--            USAGE on schema cm; SELECT on the 11 tables; USAGE (not UPDATE, not SELECT) on cm.customer_code_seq so the
--            column DEFAULT can call nextval(); column-level INSERT 62 / UPDATE 43; DELETE only on
--            cm_customer_group_members. Reference tables: SELECT only (seeded by the owner, never by the runtime).
--          Never granted: customer_code / customer_id / created_at INSERT or UPDATE, setval()/ALTER on the sequence,
--          GRANT ALL, CREATE, TRUNCATE, REFERENCES, TRIGGER, ownership, anything for PUBLIC, any new role.
--          DB grants are NOT application permissions: IAM checks in the backend remain mandatory.
-- =====================================================================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

\if :{?pii_risk_ack}
SELECT set_config('cm_r01.pii_risk_ack', :'pii_risk_ack', true);
\else
\echo 'CM REV01 06 STOP: pass -v pii_risk_ack=ACCEPT_TEST_PII_RISK (owner acceptance of the SCC Data Inspector PII risk on TEST)'
DO $cm_r01_06_noack$ BEGIN RAISE EXCEPTION 'CM REV01 06 STOP: pii_risk_ack missing'; END $cm_r01_06_noack$;
\endif

DO $cm_r01_06_guard$
BEGIN
    IF current_setting('cm_r01.pii_risk_ack', true) IS DISTINCT FROM 'ACCEPT_TEST_PII_RISK' THEN
        RAISE EXCEPTION 'CM REV01 06 STOP: pii_risk_ack must be exactly ACCEPT_TEST_PII_RISK';
    END IF;
    IF current_database() <> 'talo_mos_v4_test' THEN
        RAISE EXCEPTION 'CM REV01 06 STOP: connected to "%" -- talo_mos_v4_test only', current_database();
    END IF;
    IF session_user <> 'admin' OR current_user <> 'admin' THEN
        RAISE EXCEPTION 'CM REV01 06 STOP: run as admin (session_user=%, current_user=%)', session_user, current_user;
    END IF;
    IF current_setting('transaction_read_only') = 'on' THEN
        RAISE EXCEPTION 'CM REV01 06 STOP: transaction is read-only';
    END IF;
    IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'cm') IS DISTINCT FROM 'talo_cm_owner'
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'cm'::regnamespace AND relkind = 'r') <> 11
       OR to_regclass('cm.customer_code_seq') IS NULL THEN
        RAISE EXCEPTION 'CM REV01 06 STOP: schema cm missing, not owned by talo_cm_owner, or not holding 11 tables + sequence';
    END IF;
    IF (SELECT nspacl FROM pg_namespace WHERE nspname = 'cm') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'cm'::regnamespace AND relacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                  WHERE c.relnamespace = 'cm'::regnamespace AND a.attacl IS NOT NULL) THEN
        RAISE EXCEPTION 'CM REV01 06 STOP: schema cm already has grants (expected none after 03/04/05)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talo_app' AND rolcanlogin AND NOT rolsuper) THEN
        RAISE EXCEPTION 'CM REV01 06 STOP: role talo_app missing or superuser';
    END IF;
END
$cm_r01_06_guard$;

SET LOCAL ROLE talo_cm_owner;

GRANT USAGE ON SCHEMA cm TO talo_app;

-- Q0 sequence: nextval() in the customer_code DEFAULT needs USAGE; no UPDATE (setval) and no SELECT
GRANT USAGE ON SEQUENCE cm.customer_code_seq TO talo_app;

-- R1-R4 reference tables: read only for the runtime
GRANT SELECT ON cm.cm_ref_provinces TO talo_app;
GRANT SELECT ON cm.cm_ref_wards TO talo_app;
GRANT SELECT ON cm.cm_ref_economic_regions TO talo_app;
GRANT SELECT ON cm.cm_ref_province_region_map TO talo_app;

-- G1 cm_customers: SELECT - INSERT 18 (no customer_id/customer_code/created_at/updated_*) - UPDATE 19 - no DELETE
GRANT SELECT ON cm.cm_customers TO talo_app;
GRANT INSERT (display_name, legal_name, registered_address, representative_name, representative_phone,
              customer_type_code, customer_status_code, internal_note, created_account_id, is_hidden,
              legal_identifier_type_code, legal_identifier_normalized, address_line, province_code, ward_code,
              country_code, foreign_locality, foreign_state_province)
    ON cm.cm_customers TO talo_app;
GRANT UPDATE (display_name, legal_name, registered_address, representative_name, representative_phone,
              customer_type_code, customer_status_code, internal_note, updated_at, updated_account_id, is_hidden,
              legal_identifier_type_code, legal_identifier_normalized, address_line, province_code, ward_code,
              country_code, foreign_locality, foreign_state_province)
    ON cm.cm_customers TO talo_app;

-- G2 cm_customer_contacts: SELECT - INSERT 9 - UPDATE 8 - no DELETE
GRANT SELECT ON cm.cm_customer_contacts TO talo_app;
GRANT INSERT (customer_id, full_name, position_title, phone, zalo_phone, email, is_primary, is_active, created_account_id)
    ON cm.cm_customer_contacts TO talo_app;
GRANT UPDATE (full_name, position_title, phone, zalo_phone, email, is_primary, is_active, updated_at)
    ON cm.cm_customer_contacts TO talo_app;

-- G3 cm_customer_groups: SELECT - INSERT 6 - UPDATE 4 - no DELETE
GRANT SELECT ON cm.cm_customer_groups TO talo_app;
GRANT INSERT (group_code, group_name, parent_group_id, description, is_active, created_account_id)
    ON cm.cm_customer_groups TO talo_app;
GRANT UPDATE (group_name, parent_group_id, description, is_active)
    ON cm.cm_customer_groups TO talo_app;

-- G4 cm_customer_group_members: SELECT - INSERT 3 - DELETE (controlled removal via backend/IAM)
GRANT SELECT ON cm.cm_customer_group_members TO talo_app;
GRANT INSERT (customer_id, group_id, assigned_account_id)
    ON cm.cm_customer_group_members TO talo_app;
GRANT DELETE ON cm.cm_customer_group_members TO talo_app;

-- G5 cm_customer_assignments: SELECT - INSERT 4 - UPDATE 6 - no DELETE
GRANT SELECT ON cm.cm_customer_assignments TO talo_app;
GRANT INSERT (customer_id, sale_account_id, assigned_by_account_id, assigned_at)
    ON cm.cm_customer_assignments TO talo_app;
GRANT UPDATE (ended_at, ended_by_account_id, handover_to_account_id, handover_note, handover_accepted_at,
              handover_accepted_by_account_id)
    ON cm.cm_customer_assignments TO talo_app;

-- G6 cm_customer_activities: SELECT - INSERT 10 - UPDATE 6 - no DELETE
GRANT SELECT ON cm.cm_customer_activities TO talo_app;
GRANT INSERT (customer_id, activity_type_code, activity_status_code, title, description, occurred_at, due_at,
              assigned_to_account_id, created_by_account_id, completed_at)
    ON cm.cm_customer_activities TO talo_app;
GRANT UPDATE (activity_status_code, title, description, due_at, assigned_to_account_id, completed_at)
    ON cm.cm_customer_activities TO talo_app;

-- G7 cm_customer_documents: SELECT - INSERT 12 - no UPDATE (a new file = a new row) - no DELETE
GRANT SELECT ON cm.cm_customer_documents TO talo_app;
GRANT INSERT (customer_id, document_name, document_type_code, file_name, storage_path, file_type, file_size,
              uploaded_by_account_id, note, signed_date, effective_date, expiry_date)
    ON cm.cm_customer_documents TO talo_app;

RESET ROLE;

-- Exact post-condition (inside the transaction): any difference = exception = nothing granted.
DO $cm_r01_06_check$
DECLARE
    v_diff text;
BEGIN
    IF NOT has_schema_privilege('talo_app', 'cm', 'USAGE') OR has_schema_privilege('talo_app', 'cm', 'CREATE') THEN
        RAISE EXCEPTION 'CM REV01 06 CHECK: talo_app must have USAGE only on schema cm';
    END IF;
    IF (SELECT nspacl::text FROM pg_namespace WHERE nspname = 'cm')
       IS DISTINCT FROM '{talo_cm_owner=UC/talo_cm_owner,talo_app=U/talo_cm_owner}' THEN
        RAISE EXCEPTION 'CM REV01 06 CHECK: schema cm ACL differs: %', (SELECT nspacl::text FROM pg_namespace WHERE nspname = 'cm');
    END IF;
    IF (SELECT relacl::text FROM pg_class WHERE oid = 'cm.customer_code_seq'::regclass)
       IS DISTINCT FROM '{talo_cm_owner=rwU/talo_cm_owner,talo_app=U/talo_cm_owner}'
       OR has_sequence_privilege('talo_app', 'cm.customer_code_seq', 'UPDATE')
       OR has_sequence_privilege('talo_app', 'cm.customer_code_seq', 'SELECT') THEN
        RAISE EXCEPTION 'CM REV01 06 CHECK: customer_code_seq ACL must be owner + talo_app USAGE only: %',
            (SELECT relacl::text FROM pg_class WHERE oid = 'cm.customer_code_seq'::regclass);
    END IF;
    -- every (grantee, table, column-or-*, privilege) present on cm tables must be exactly the matrix, and vice versa
    WITH expected(tbl, col, priv) AS (
        SELECT t, '*', 'SELECT' FROM unnest(ARRAY['cm_ref_provinces','cm_ref_wards','cm_ref_economic_regions',
            'cm_ref_province_region_map','cm_customers','cm_customer_contacts','cm_customer_groups',
            'cm_customer_group_members','cm_customer_assignments','cm_customer_activities','cm_customer_documents']) t
        UNION ALL SELECT 'cm_customer_group_members', '*', 'DELETE'
        UNION ALL SELECT 'cm_customers', c, 'INSERT' FROM unnest(ARRAY['display_name','legal_name','registered_address',
            'representative_name','representative_phone','customer_type_code','customer_status_code','internal_note',
            'created_account_id','is_hidden','legal_identifier_type_code','legal_identifier_normalized','address_line',
            'province_code','ward_code','country_code','foreign_locality','foreign_state_province']) c
        UNION ALL SELECT 'cm_customers', c, 'UPDATE' FROM unnest(ARRAY['display_name','legal_name','registered_address',
            'representative_name','representative_phone','customer_type_code','customer_status_code','internal_note',
            'updated_at','updated_account_id','is_hidden','legal_identifier_type_code','legal_identifier_normalized',
            'address_line','province_code','ward_code','country_code','foreign_locality','foreign_state_province']) c
        UNION ALL SELECT 'cm_customer_contacts', c, 'INSERT' FROM unnest(ARRAY['customer_id','full_name','position_title',
            'phone','zalo_phone','email','is_primary','is_active','created_account_id']) c
        UNION ALL SELECT 'cm_customer_contacts', c, 'UPDATE' FROM unnest(ARRAY['full_name','position_title','phone',
            'zalo_phone','email','is_primary','is_active','updated_at']) c
        UNION ALL SELECT 'cm_customer_groups', c, 'INSERT' FROM unnest(ARRAY['group_code','group_name','parent_group_id',
            'description','is_active','created_account_id']) c
        UNION ALL SELECT 'cm_customer_groups', c, 'UPDATE' FROM unnest(ARRAY['group_name','parent_group_id','description',
            'is_active']) c
        UNION ALL SELECT 'cm_customer_group_members', c, 'INSERT' FROM unnest(ARRAY['customer_id','group_id',
            'assigned_account_id']) c
        UNION ALL SELECT 'cm_customer_assignments', c, 'INSERT' FROM unnest(ARRAY['customer_id','sale_account_id',
            'assigned_by_account_id','assigned_at']) c
        UNION ALL SELECT 'cm_customer_assignments', c, 'UPDATE' FROM unnest(ARRAY['ended_at','ended_by_account_id',
            'handover_to_account_id','handover_note','handover_accepted_at','handover_accepted_by_account_id']) c
        UNION ALL SELECT 'cm_customer_activities', c, 'INSERT' FROM unnest(ARRAY['customer_id','activity_type_code',
            'activity_status_code','title','description','occurred_at','due_at','assigned_to_account_id',
            'created_by_account_id','completed_at']) c
        UNION ALL SELECT 'cm_customer_activities', c, 'UPDATE' FROM unnest(ARRAY['activity_status_code','title',
            'description','due_at','assigned_to_account_id','completed_at']) c
        UNION ALL SELECT 'cm_customer_documents', c, 'INSERT' FROM unnest(ARRAY['customer_id','document_name',
            'document_type_code','file_name','storage_path','file_type','file_size','uploaded_by_account_id','note',
            'signed_date','effective_date','expiry_date']) c
    ), actual AS (
        SELECT c.relname::text AS tbl, '*'::text AS col, x.privilege_type::text AS priv,
               CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee
        FROM pg_class c, LATERAL aclexplode(c.relacl) x
        WHERE c.relnamespace = 'cm'::regnamespace AND c.relkind = 'r' AND x.grantee <> c.relowner
        UNION ALL
        SELECT c.relname::text, a.attname::text, x.privilege_type::text,
               CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, LATERAL aclexplode(a.attacl) x
        WHERE c.relnamespace = 'cm'::regnamespace AND c.relkind = 'r' AND a.attacl IS NOT NULL
    ), diff AS (
        (SELECT 'missing ' || tbl || '.' || col || ':' || priv AS d
         FROM (SELECT tbl, col, priv FROM expected EXCEPT SELECT tbl, col, priv FROM actual WHERE grantee = 'talo_app') e)
        UNION ALL
        (SELECT 'unexpected ' || grantee || ' ' || tbl || '.' || col || ':' || priv
         FROM (SELECT tbl, col, priv, grantee FROM actual
               EXCEPT SELECT tbl, col, priv, 'talo_app' FROM expected) x)
    )
    SELECT string_agg(d, ', ' ORDER BY d) INTO v_diff FROM diff;
    IF v_diff IS NOT NULL THEN
        RAISE EXCEPTION 'CM REV01 06 CHECK: grant matrix differs: %', v_diff;
    END IF;
    IF (SELECT count(*) FROM pg_class c, LATERAL aclexplode(c.relacl) x
        WHERE c.relnamespace = 'cm'::regnamespace AND c.relkind = 'r' AND x.grantee <> c.relowner) <> 12 THEN
        RAISE EXCEPTION 'CM REV01 06 CHECK: expected 12 table-level grants (11 SELECT + 1 DELETE)';
    END IF;
    RAISE NOTICE 'CM REV01 06 CHECK PASSED: talo_app = USAGE cm + seq USAGE + 11 SELECT + 1 DELETE + 62 INSERT cols + 43 UPDATE cols';
END
$cm_r01_06_check$;

COMMIT;
