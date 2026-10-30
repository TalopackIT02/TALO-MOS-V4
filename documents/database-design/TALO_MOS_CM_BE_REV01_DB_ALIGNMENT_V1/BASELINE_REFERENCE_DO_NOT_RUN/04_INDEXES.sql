-- =====================================================================================================================
-- CM V1 REV01 -- 04 PARTIAL UNIQUE + SECONDARY INDEXES -- talo_mos_v4_test ONLY
-- STATUS : DRAFT, NOT EXECUTED, NOT APPROVED.
-- Source : REV01 08 item 5 ("index toi thieu, 2 partial unique baseline, partial unique legal identifier, mapping index +
--          composite ward FK. Khong index du"), 04 A.2 / A.7 / A.9, and the 7-table contract 03 sec. B for the baseline
--          indexes (the tax_number index is removed together with the column).
-- Order  : after 03 COMMITTED (tables are new and empty -> plain CREATE INDEX inside one transaction).
-- Run    : docker exec talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test -X -v ON_ERROR_STOP=1 -f <file>
-- Creates: 4 partial UNIQUE + 7 non-unique indexes, AS talo_cm_owner. With the 14 indexes backing the 11 PK + 3 UNIQUE
--          constraints of 03, schema cm then holds 25 indexes. The composite ward FK itself is backed by the UNIQUE
--          constraint uq_cm_ref_wards_ward_province created in 03.
-- =====================================================================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

DO $cm_r01_04_guard$
BEGIN
    IF current_database() <> 'talo_mos_v4_test' THEN
        RAISE EXCEPTION 'CM REV01 04 STOP: connected to "%" -- talo_mos_v4_test only', current_database();
    END IF;
    IF session_user <> 'admin' OR current_user <> 'admin' THEN
        RAISE EXCEPTION 'CM REV01 04 STOP: run as admin (session_user=%, current_user=%)', session_user, current_user;
    END IF;
    IF current_setting('transaction_read_only') = 'on' THEN
        RAISE EXCEPTION 'CM REV01 04 STOP: transaction is read-only';
    END IF;
    IF (SELECT count(*) FROM pg_class WHERE relnamespace = 'cm'::regnamespace AND relkind = 'r') <> 11 THEN
        RAISE EXCEPTION 'CM REV01 04 STOP: schema cm does not hold the 11 tables of 03';
    END IF;
    IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid WHERE c.relnamespace = 'cm'::regnamespace) <> 14 THEN
        RAISE EXCEPTION 'CM REV01 04 STOP: expected only the 14 PK/UNIQUE indexes of 03 before this file';
    END IF;
END
$cm_r01_04_guard$;

SET LOCAL ROLE talo_cm_owner;

-- Partial UNIQUE -- baseline (04 A.7)
CREATE UNIQUE INDEX uq_cm_customer_contacts_primary_active
    ON cm.cm_customer_contacts (customer_id) WHERE is_primary = true AND is_active = true;
CREATE UNIQUE INDEX uq_cm_customer_assignments_current
    ON cm.cm_customer_assignments (customer_id) WHERE ended_at IS NULL;
-- Partial UNIQUE -- legal identifier per (country, type, value), hidden customers included (04 A.2)
CREATE UNIQUE INDEX uq_cm_customers_legal_identifier
    ON cm.cm_customers (country_code, legal_identifier_type_code, legal_identifier_normalized)
    WHERE legal_identifier_type_code IS NOT NULL AND legal_identifier_normalized IS NOT NULL;
-- Partial UNIQUE -- one current mapping (valid_to IS NULL) per province (04 A.9)
CREATE UNIQUE INDEX uq_cm_ref_province_region_map_current
    ON cm.cm_ref_province_region_map (province_code) WHERE valid_to IS NULL;

-- Non-unique -- baseline of the 7-table contract (tax_number index removed with the column)
CREATE INDEX ix_cm_customers_status
    ON cm.cm_customers (customer_status_code);
CREATE INDEX ix_cm_customer_contacts_customer
    ON cm.cm_customer_contacts (customer_id);
CREATE INDEX ix_cm_customer_activities_customer_time
    ON cm.cm_customer_activities (customer_id, occurred_at DESC);
CREATE INDEX ix_cm_customer_activities_assignee_status_due
    ON cm.cm_customer_activities (assigned_to_account_id, activity_status_code, due_at);
CREATE INDEX ix_cm_customer_documents_customer_time
    ON cm.cm_customer_documents (customer_id, uploaded_at DESC);
CREATE INDEX ix_cm_customer_assignments_sale
    ON cm.cm_customer_assignments (sale_account_id, ended_at);
-- Non-unique -- ward lookup by province (dropdown filter, TC-08; FK cm_ref_wards -> cm_ref_provinces)
CREATE INDEX ix_cm_ref_wards_province
    ON cm.cm_ref_wards (province_code);

RESET ROLE;

-- Self-check: names, uniqueness, partial or not, and target table. The exact pg_get_indexdef() text is compared by the
-- read-only 07_VERIFY_READONLY.sql (V-06), so a rendering difference cannot block this deployment step.
DO $cm_r01_04_check$
DECLARE
    v_diff text;
BEGIN
    WITH expected(name, tbl, is_unique, is_partial) AS (VALUES
        ('uq_cm_customer_contacts_primary_active', 'cm_customer_contacts', true, true),
        ('uq_cm_customer_assignments_current', 'cm_customer_assignments', true, true),
        ('uq_cm_customers_legal_identifier', 'cm_customers', true, true),
        ('uq_cm_ref_province_region_map_current', 'cm_ref_province_region_map', true, true),
        ('ix_cm_customers_status', 'cm_customers', false, false),
        ('ix_cm_customer_contacts_customer', 'cm_customer_contacts', false, false),
        ('ix_cm_customer_activities_customer_time', 'cm_customer_activities', false, false),
        ('ix_cm_customer_activities_assignee_status_due', 'cm_customer_activities', false, false),
        ('ix_cm_customer_documents_customer_time', 'cm_customer_documents', false, false),
        ('ix_cm_customer_assignments_sale', 'cm_customer_assignments', false, false),
        ('ix_cm_ref_wards_province', 'cm_ref_wards', false, false)
    ), actual AS (
        SELECT ci.relname::text AS name, ct.relname::text AS tbl, i.indisunique AS is_unique, i.indpred IS NOT NULL AS is_partial
        FROM pg_index i JOIN pg_class ci ON ci.oid = i.indexrelid JOIN pg_class ct ON ct.oid = i.indrelid
        WHERE ct.relnamespace = 'cm'::regnamespace
          AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u'))
    ), diff AS (
        (SELECT 'missing ' || name AS d FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) e)
        UNION ALL
        (SELECT 'unexpected ' || name FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) x)
    )
    SELECT string_agg(d, ', ' ORDER BY d) INTO v_diff FROM diff;
    IF v_diff IS NOT NULL THEN
        RAISE EXCEPTION 'CM REV01 04 SELF-CHECK: index set differs: %', v_diff;
    END IF;
    IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid WHERE c.relnamespace = 'cm'::regnamespace) <> 25 THEN
        RAISE EXCEPTION 'CM REV01 04 SELF-CHECK: expected 25 indexes in schema cm (14 PK/UNIQUE + 11 from this file)';
    END IF;
    RAISE NOTICE 'CM REV01 04 SELF-CHECK PASSED: 4 partial UNIQUE + 7 indexes; 25 indexes in schema cm';
END
$cm_r01_04_check$;

COMMIT;
