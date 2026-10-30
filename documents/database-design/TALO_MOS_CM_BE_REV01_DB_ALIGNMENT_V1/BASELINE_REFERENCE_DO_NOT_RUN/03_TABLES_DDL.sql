-- =====================================================================================================================
-- CM V1 REV01 -- 03 DDL: 11 TABLES / 114 COLUMNS + SEQUENCE cm.customer_code_seq -- talo_mos_v4_test ONLY
-- STATUS : DRAFT, NOT EXECUTED, NOT APPROVED. Needs owner approval of this exact file (SHA-256 in MANIFEST_SHA256.txt).
-- Source : TALO_MOS_CM_V1_REV01_SQL_HANDOFF -- 03_COLUMN_INVENTORY_114.csv (sha256 9ac3a971...0dc3),
--          02_TABLES_AND_ERD.md, 04_CONSTRAINTS_AND_VALIDATION.md sec. A, 06_FOUNDATION_IAM_AND_GRANTS.md.
--          Reused from CM_DB_V1_SQL_DRAFT_20261029-115639/03 and adjusted (see DELTA_FROM_7_TABLE_DRAFT.md).
-- Order  : after 02_ROLE_SCHEMA_PROPOSAL.sql COMMITTED. Business DDL only; no role/schema creation here.
-- Run    : docker exec talo-mos-v4-postgres psql -U admin -d talo_mos_v4_test -X -v ON_ERROR_STOP=1 -f <file>
-- Effect : one transaction; objects created AS talo_cm_owner (SET LOCAL ROLE).
-- Creates: 1 sequence (000001..999999, NO CYCLE) - 11 tables - 114 columns - 11 PK - 3 UNIQUE - 12 FK (all ON DELETE
--          RESTRICT, 1 composite) - 10 CHECK.
-- NOT    : indexes (04), seed (05), grants (06), triggers, functions, views, enums, extensions, FK to schema iam,
--          country/customer-type/document-type/industry lookup tables, separate legal table.
-- Notes  : *_account_id = logical reference to iam.iam_user_accounts.user_account_id (uuid), no FK (06 L6, ERD L40).
--          *_code columns without a lookup table are validated by the backend (CODE_CONTRACT); no CHECK lists here.
-- =====================================================================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- STEP 1 -- guard
DO $cm_r01_03_guard$
BEGIN
    IF current_database() <> 'talo_mos_v4_test' THEN
        RAISE EXCEPTION 'CM REV01 03 STOP: connected to "%" -- talo_mos_v4_test only', current_database();
    END IF;
    IF session_user <> 'admin' OR current_user <> 'admin' THEN
        RAISE EXCEPTION 'CM REV01 03 STOP: run as admin (session_user=%, current_user=%)', session_user, current_user;
    END IF;
    IF current_setting('transaction_read_only') = 'on' THEN
        RAISE EXCEPTION 'CM REV01 03 STOP: transaction is read-only';
    END IF;
    IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'cm') IS DISTINCT FROM 'talo_cm_owner' THEN
        RAISE EXCEPTION 'CM REV01 03 STOP: schema cm missing or not owned by talo_cm_owner (run 02 first)';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'cm'::regnamespace) THEN
        RAISE EXCEPTION 'CM REV01 03 STOP: schema cm is not empty (REV01 01 L13: STOP, no DROP/ALTER)';
    END IF;
    IF NOT pg_has_role(session_user, 'talo_cm_owner', 'SET') THEN
        RAISE EXCEPTION 'CM REV01 03 STOP: % cannot SET ROLE talo_cm_owner', session_user;
    END IF;
END
$cm_r01_03_guard$;

-- STEP 2 -- objects created AS the schema owner. SET LOCAL ends with the transaction.
SET LOCAL ROLE talo_cm_owner;

-- ---------------------------------------------------------------------------------------------------------------------
-- R1 cm.cm_ref_provinces -- 8 columns (QD 19/2025/QD-TTg, 2-character code)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_ref_provinces (
    province_code           char(2)       NOT NULL,
    province_name           varchar(150)  NOT NULL,
    unit_type_code          varchar(20)   NOT NULL,                           -- CODE_CONTRACT: TINH / THANH_PHO
    valid_from              date          NOT NULL,
    valid_to                date,
    is_active               boolean       NOT NULL DEFAULT true,
    source_ref              varchar(255)  NOT NULL,
    source_version          varchar(60)   NOT NULL,
    CONSTRAINT pk_cm_ref_provinces PRIMARY KEY (province_code)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- R2 cm.cm_ref_wards -- 9 columns (5-character code; UNIQUE (ward_code, province_code) backs the composite FK of
--    cm_customers so that a ward of another province is rejected -- ERD L37)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_ref_wards (
    ward_code               char(5)       NOT NULL,
    province_code           char(2)       NOT NULL,
    ward_name               varchar(150)  NOT NULL,
    unit_type_code          varchar(20)   NOT NULL,                           -- CODE_CONTRACT: PHUONG / XA / DAC_KHU
    valid_from              date          NOT NULL,
    valid_to                date,
    is_active               boolean       NOT NULL DEFAULT true,
    source_ref              varchar(255)  NOT NULL,
    source_version          varchar(60)   NOT NULL,
    CONSTRAINT pk_cm_ref_wards PRIMARY KEY (ward_code),
    CONSTRAINT uq_cm_ref_wards_ward_province UNIQUE (ward_code, province_code),
    CONSTRAINT fk_cm_ref_wards_province_code FOREIGN KEY (province_code)
        REFERENCES cm.cm_ref_provinces (province_code) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------------------------------------------------
-- R3 cm.cm_ref_economic_regions -- 6 columns (6 socio-economic regions)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_ref_economic_regions (
    region_code             varchar(20)   NOT NULL,
    region_name             varchar(150)  NOT NULL,
    valid_from              date          NOT NULL,
    valid_to                date,
    is_active               boolean       NOT NULL DEFAULT true,
    source_ref              varchar(255)  NOT NULL,
    CONSTRAINT pk_cm_ref_economic_regions PRIMARY KEY (region_code)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- R4 cm.cm_ref_province_region_map -- 7 columns (only place holding economic region + 3-mien business convention)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_ref_province_region_map (
    province_code           char(2)       NOT NULL,
    region_code             varchar(20)   NOT NULL,
    macro_region_code       varchar(15)   NOT NULL,                           -- CODE_CONTRACT: NORTH / CENTRAL / SOUTH
    valid_from              date          NOT NULL,
    valid_to                date,                                             -- NULL = current mapping
    source_ref              varchar(255)  NOT NULL,
    mapping_version         varchar(60)   NOT NULL,
    CONSTRAINT pk_cm_ref_province_region_map PRIMARY KEY (province_code, valid_from),
    CONSTRAINT fk_cm_ref_province_region_map_province_code FOREIGN KEY (province_code)
        REFERENCES cm.cm_ref_provinces (province_code) ON DELETE RESTRICT,
    CONSTRAINT fk_cm_ref_province_region_map_region_code FOREIGN KEY (region_code)
        REFERENCES cm.cm_ref_economic_regions (region_code) ON DELETE RESTRICT,
    CONSTRAINT ck_cm_ref_province_region_map_valid_range
        CHECK (valid_to IS NULL OR valid_to >= valid_from)                      -- 04 A.9
);

-- ---------------------------------------------------------------------------------------------------------------------
-- S1 cm.customer_code_seq -- 000001..999999, NO CYCLE (04 A.1). Gaps after rollback are accepted; codes never reused.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE SEQUENCE cm.customer_code_seq
    AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 999999 NO CYCLE CACHE 1;

-- ---------------------------------------------------------------------------------------------------------------------
-- T1 cm.cm_customers -- 23 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_customers (
    customer_id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
    customer_code                varchar(6)    NOT NULL DEFAULT lpad(nextval('cm.customer_code_seq')::text, 6, '0'),
    display_name                 varchar(200)  NOT NULL,
    legal_name                   varchar(255),
    registered_address           text,                                       -- snapshot built by the backend
    representative_name          varchar(150),
    representative_phone         varchar(30),
    customer_type_code           varchar(30)   NOT NULL,                     -- no default: COMPANY/BRANCH/HOUSEHOLD/PERSON/FOREIGN_NO_VN_REG
    customer_status_code         varchar(30)   NOT NULL DEFAULT 'PROSPECT',  -- PROSPECT, NEW, ACTIVE, PAUSED, CLOSED
    internal_note                text,
    created_at                   timestamptz   NOT NULL DEFAULT now(),
    created_account_id           uuid,                                       -- IAM logical ref (no FK)
    updated_at                   timestamptz,                                -- set by the backend; no trigger
    updated_account_id           uuid,                                       -- IAM logical ref (no FK)
    is_hidden                    boolean       NOT NULL DEFAULT false,
    legal_identifier_type_code   varchar(30),                                -- VN_TAX_ID / VN_PERSONAL_ID / FOREIGN_REG
    legal_identifier_normalized  varchar(128),                               -- partial UNIQUE in 04 (hidden rows included)
    address_line                 text,
    province_code                char(2),
    ward_code                    char(5),
    country_code                 char(2)       NOT NULL DEFAULT 'VN',        -- ISO 3166-1 alpha-2 (contract, no lookup)
    foreign_locality             varchar(150),
    foreign_state_province       varchar(150),
    CONSTRAINT pk_cm_customers PRIMARY KEY (customer_id),
    CONSTRAINT uq_cm_customers_customer_code UNIQUE (customer_code),
    CONSTRAINT ck_cm_customers_customer_code_6_digit
        CHECK (customer_code ~ '^[0-9]{6}$'),                                   -- 04 A.1
    CONSTRAINT fk_cm_customers_province_code FOREIGN KEY (province_code)
        REFERENCES cm.cm_ref_provinces (province_code) ON DELETE RESTRICT,     -- ERD L36
    CONSTRAINT fk_cm_customers_ward_province FOREIGN KEY (ward_code, province_code)
        REFERENCES cm.cm_ref_wards (ward_code, province_code) ON DELETE RESTRICT, -- ERD L37 (composite)
    CONSTRAINT ck_cm_customers_ward_requires_province
        CHECK (ward_code IS NULL OR province_code IS NOT NULL),                 -- closes the MATCH SIMPLE gap of the composite FK (OI-R05)
    CONSTRAINT ck_cm_customers_foreign_no_vn_reg
        CHECK (customer_type_code <> 'FOREIGN_NO_VN_REG'
               OR (country_code <> 'VN' AND province_code IS NULL AND ward_code IS NULL)),   -- 04 A.4
    CONSTRAINT ck_cm_customers_official_profile
        CHECK (customer_status_code = 'PROSPECT'
               OR (NULLIF(BTRIM(legal_name), '') IS NOT NULL
                   AND legal_identifier_type_code IS NOT NULL
                   AND NULLIF(BTRIM(legal_identifier_normalized), '') IS NOT NULL
                   AND NULLIF(BTRIM(address_line), '') IS NOT NULL
                   AND (country_code <> 'VN' OR (province_code IS NOT NULL AND ward_code IS NOT NULL))))  -- 04 A.3 + A.5 (OI-R04)
);

-- the sequence belongs to the column it serves (dropped with it; no other use)
ALTER SEQUENCE cm.customer_code_seq OWNED BY cm.cm_customers.customer_code;

-- ---------------------------------------------------------------------------------------------------------------------
-- T2 cm.cm_customer_contacts -- 12 columns (unchanged from the 7-table draft)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_customer_contacts (
    contact_id              uuid          NOT NULL DEFAULT gen_random_uuid(),
    customer_id             uuid          NOT NULL,
    full_name               varchar(150)  NOT NULL,
    position_title          varchar(100),
    phone                   varchar(30),
    zalo_phone              varchar(30),
    email                   varchar(254),
    is_primary              boolean       NOT NULL DEFAULT false,
    is_active               boolean       NOT NULL DEFAULT true,
    created_at              timestamptz   NOT NULL DEFAULT now(),
    updated_at              timestamptz,
    created_account_id      uuid,
    CONSTRAINT pk_cm_customer_contacts PRIMARY KEY (contact_id),
    CONSTRAINT fk_cm_customer_contacts_customer_id FOREIGN KEY (customer_id)
        REFERENCES cm.cm_customers (customer_id) ON DELETE RESTRICT,
    CONSTRAINT ck_cm_customer_contacts_phone_or_zalo
        CHECK (NULLIF(BTRIM(phone), '') IS NOT NULL OR NULLIF(BTRIM(zalo_phone), '') IS NOT NULL)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- T3 cm.cm_customer_groups -- 8 columns (unchanged)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_customer_groups (
    group_id                uuid          NOT NULL DEFAULT gen_random_uuid(),
    group_code              varchar(30)   NOT NULL,
    group_name              varchar(150)  NOT NULL,
    parent_group_id         uuid,
    description             text,
    is_active               boolean       NOT NULL DEFAULT true,
    created_at              timestamptz   NOT NULL DEFAULT now(),
    created_account_id      uuid,
    CONSTRAINT pk_cm_customer_groups PRIMARY KEY (group_id),
    CONSTRAINT uq_cm_customer_groups_group_code UNIQUE (group_code),
    CONSTRAINT fk_cm_customer_groups_parent_group_id FOREIGN KEY (parent_group_id)
        REFERENCES cm.cm_customer_groups (group_id) ON DELETE RESTRICT,
    CONSTRAINT ck_cm_customer_groups_not_own_parent
        CHECK (parent_group_id IS NULL OR parent_group_id <> group_id)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- T4 cm.cm_customer_group_members -- 4 columns (unchanged)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_customer_group_members (
    customer_id             uuid          NOT NULL,
    group_id                uuid          NOT NULL,
    assigned_at             timestamptz   NOT NULL DEFAULT now(),
    assigned_account_id     uuid,
    CONSTRAINT pk_cm_customer_group_members PRIMARY KEY (customer_id, group_id),
    CONSTRAINT fk_cm_customer_group_members_customer_id FOREIGN KEY (customer_id)
        REFERENCES cm.cm_customers (customer_id) ON DELETE RESTRICT,
    CONSTRAINT fk_cm_customer_group_members_group_id FOREIGN KEY (group_id)
        REFERENCES cm.cm_customer_groups (group_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------------------------------------------------
-- T5 cm.cm_customer_assignments -- 11 columns (unchanged)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_customer_assignments (
    assignment_id                    uuid         NOT NULL DEFAULT gen_random_uuid(),
    customer_id                      uuid         NOT NULL,
    sale_account_id                  uuid         NOT NULL,
    assigned_by_account_id           uuid,
    assigned_at                      timestamptz  NOT NULL DEFAULT now(),
    ended_at                         timestamptz,
    ended_by_account_id              uuid,
    handover_to_account_id           uuid,
    handover_note                    text,
    handover_accepted_at             timestamptz,
    handover_accepted_by_account_id  uuid,
    CONSTRAINT pk_cm_customer_assignments PRIMARY KEY (assignment_id),
    CONSTRAINT fk_cm_customer_assignments_customer_id FOREIGN KEY (customer_id)
        REFERENCES cm.cm_customers (customer_id) ON DELETE RESTRICT,
    CONSTRAINT ck_cm_customer_assignments_time_order
        CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- T6 cm.cm_customer_activities -- 12 columns (unchanged)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_customer_activities (
    activity_id             uuid          NOT NULL DEFAULT gen_random_uuid(),
    customer_id             uuid          NOT NULL,
    activity_type_code      varchar(30)   NOT NULL,
    activity_status_code    varchar(30)   NOT NULL DEFAULT 'OPEN',
    title                   varchar(255)  NOT NULL,
    description             text,
    occurred_at             timestamptz   NOT NULL DEFAULT now(),
    due_at                  timestamptz,
    assigned_to_account_id  uuid,
    created_by_account_id   uuid,
    created_at              timestamptz   NOT NULL DEFAULT now(),
    completed_at            timestamptz,
    CONSTRAINT pk_cm_customer_activities PRIMARY KEY (activity_id),
    CONSTRAINT fk_cm_customer_activities_customer_id FOREIGN KEY (customer_id)
        REFERENCES cm.cm_customers (customer_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------------------------------------------------
-- T7 cm.cm_customer_documents -- 14 columns (+ signed_date, effective_date, expiry_date)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE cm.cm_customer_documents (
    document_id             uuid          NOT NULL DEFAULT gen_random_uuid(),
    customer_id             uuid          NOT NULL,
    document_name           varchar(255)  NOT NULL,
    document_type_code      varchar(30)   NOT NULL,
    file_name               varchar(255)  NOT NULL,
    storage_path            varchar(500)  NOT NULL,
    file_type               varchar(100)  NOT NULL,
    file_size               bigint        NOT NULL,
    uploaded_by_account_id  uuid,
    uploaded_at             timestamptz   NOT NULL DEFAULT now(),
    note                    text,
    signed_date             date,
    effective_date          date,
    expiry_date             date,
    CONSTRAINT pk_cm_customer_documents PRIMARY KEY (document_id),
    CONSTRAINT fk_cm_customer_documents_customer_id FOREIGN KEY (customer_id)
        REFERENCES cm.cm_customers (customer_id) ON DELETE RESTRICT,
    CONSTRAINT ck_cm_customer_documents_file_size CHECK (file_size >= 0),
    CONSTRAINT ck_cm_customer_documents_effective_expiry
        CHECK (effective_date IS NULL OR expiry_date IS NULL OR effective_date <= expiry_date)   -- 04 A.6
);

RESET ROLE;
SET LOCAL search_path = pg_catalog;

-- STEP 3 -- in-transaction self-check (as admin). Any mismatch raises, so COMMIT is never reached.
--           Types / NOT NULL / presence of a default are compared exactly; the exact default TEXT is compared by the
--           read-only 07 (V-04), so a rendering difference cannot block this deployment step.
DO $cm_r01_03_check$
DECLARE
    v_diff text;
    v_seq  record;
BEGIN
    IF (SELECT count(*) FROM pg_class WHERE relnamespace = 'cm'::regnamespace AND relkind = 'r') <> 11
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'cm'::regnamespace AND relkind = 'S') <> 1
       OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'cm'::regnamespace AND relkind NOT IN ('r', 'i', 'S'))
       OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'cm'::regnamespace AND pg_get_userbyid(relowner) <> 'talo_cm_owner') THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: schema cm must hold exactly 11 tables + 1 sequence owned by talo_cm_owner';
    END IF;
    WITH expected(tbl, pos, col, typ, not_null, has_default) AS (VALUES
        ('cm_customers', 1, 'customer_id', 'uuid', true, true),
        ('cm_customers', 2, 'customer_code', 'character varying(6)', true, true),
        ('cm_customers', 3, 'display_name', 'character varying(200)', true, false),
        ('cm_customers', 4, 'legal_name', 'character varying(255)', false, false),
        ('cm_customers', 5, 'registered_address', 'text', false, false),
        ('cm_customers', 6, 'representative_name', 'character varying(150)', false, false),
        ('cm_customers', 7, 'representative_phone', 'character varying(30)', false, false),
        ('cm_customers', 8, 'customer_type_code', 'character varying(30)', true, false),
        ('cm_customers', 9, 'customer_status_code', 'character varying(30)', true, true),
        ('cm_customers', 10, 'internal_note', 'text', false, false),
        ('cm_customers', 11, 'created_at', 'timestamp with time zone', true, true),
        ('cm_customers', 12, 'created_account_id', 'uuid', false, false),
        ('cm_customers', 13, 'updated_at', 'timestamp with time zone', false, false),
        ('cm_customers', 14, 'updated_account_id', 'uuid', false, false),
        ('cm_customers', 15, 'is_hidden', 'boolean', true, true),
        ('cm_customers', 16, 'legal_identifier_type_code', 'character varying(30)', false, false),
        ('cm_customers', 17, 'legal_identifier_normalized', 'character varying(128)', false, false),
        ('cm_customers', 18, 'address_line', 'text', false, false),
        ('cm_customers', 19, 'province_code', 'character(2)', false, false),
        ('cm_customers', 20, 'ward_code', 'character(5)', false, false),
        ('cm_customers', 21, 'country_code', 'character(2)', true, true),
        ('cm_customers', 22, 'foreign_locality', 'character varying(150)', false, false),
        ('cm_customers', 23, 'foreign_state_province', 'character varying(150)', false, false),
        ('cm_customer_contacts', 1, 'contact_id', 'uuid', true, true),
        ('cm_customer_contacts', 2, 'customer_id', 'uuid', true, false),
        ('cm_customer_contacts', 3, 'full_name', 'character varying(150)', true, false),
        ('cm_customer_contacts', 4, 'position_title', 'character varying(100)', false, false),
        ('cm_customer_contacts', 5, 'phone', 'character varying(30)', false, false),
        ('cm_customer_contacts', 6, 'zalo_phone', 'character varying(30)', false, false),
        ('cm_customer_contacts', 7, 'email', 'character varying(254)', false, false),
        ('cm_customer_contacts', 8, 'is_primary', 'boolean', true, true),
        ('cm_customer_contacts', 9, 'is_active', 'boolean', true, true),
        ('cm_customer_contacts', 10, 'created_at', 'timestamp with time zone', true, true),
        ('cm_customer_contacts', 11, 'updated_at', 'timestamp with time zone', false, false),
        ('cm_customer_contacts', 12, 'created_account_id', 'uuid', false, false),
        ('cm_customer_groups', 1, 'group_id', 'uuid', true, true),
        ('cm_customer_groups', 2, 'group_code', 'character varying(30)', true, false),
        ('cm_customer_groups', 3, 'group_name', 'character varying(150)', true, false),
        ('cm_customer_groups', 4, 'parent_group_id', 'uuid', false, false),
        ('cm_customer_groups', 5, 'description', 'text', false, false),
        ('cm_customer_groups', 6, 'is_active', 'boolean', true, true),
        ('cm_customer_groups', 7, 'created_at', 'timestamp with time zone', true, true),
        ('cm_customer_groups', 8, 'created_account_id', 'uuid', false, false),
        ('cm_customer_group_members', 1, 'customer_id', 'uuid', true, false),
        ('cm_customer_group_members', 2, 'group_id', 'uuid', true, false),
        ('cm_customer_group_members', 3, 'assigned_at', 'timestamp with time zone', true, true),
        ('cm_customer_group_members', 4, 'assigned_account_id', 'uuid', false, false),
        ('cm_customer_assignments', 1, 'assignment_id', 'uuid', true, true),
        ('cm_customer_assignments', 2, 'customer_id', 'uuid', true, false),
        ('cm_customer_assignments', 3, 'sale_account_id', 'uuid', true, false),
        ('cm_customer_assignments', 4, 'assigned_by_account_id', 'uuid', false, false),
        ('cm_customer_assignments', 5, 'assigned_at', 'timestamp with time zone', true, true),
        ('cm_customer_assignments', 6, 'ended_at', 'timestamp with time zone', false, false),
        ('cm_customer_assignments', 7, 'ended_by_account_id', 'uuid', false, false),
        ('cm_customer_assignments', 8, 'handover_to_account_id', 'uuid', false, false),
        ('cm_customer_assignments', 9, 'handover_note', 'text', false, false),
        ('cm_customer_assignments', 10, 'handover_accepted_at', 'timestamp with time zone', false, false),
        ('cm_customer_assignments', 11, 'handover_accepted_by_account_id', 'uuid', false, false),
        ('cm_customer_activities', 1, 'activity_id', 'uuid', true, true),
        ('cm_customer_activities', 2, 'customer_id', 'uuid', true, false),
        ('cm_customer_activities', 3, 'activity_type_code', 'character varying(30)', true, false),
        ('cm_customer_activities', 4, 'activity_status_code', 'character varying(30)', true, true),
        ('cm_customer_activities', 5, 'title', 'character varying(255)', true, false),
        ('cm_customer_activities', 6, 'description', 'text', false, false),
        ('cm_customer_activities', 7, 'occurred_at', 'timestamp with time zone', true, true),
        ('cm_customer_activities', 8, 'due_at', 'timestamp with time zone', false, false),
        ('cm_customer_activities', 9, 'assigned_to_account_id', 'uuid', false, false),
        ('cm_customer_activities', 10, 'created_by_account_id', 'uuid', false, false),
        ('cm_customer_activities', 11, 'created_at', 'timestamp with time zone', true, true),
        ('cm_customer_activities', 12, 'completed_at', 'timestamp with time zone', false, false),
        ('cm_customer_documents', 1, 'document_id', 'uuid', true, true),
        ('cm_customer_documents', 2, 'customer_id', 'uuid', true, false),
        ('cm_customer_documents', 3, 'document_name', 'character varying(255)', true, false),
        ('cm_customer_documents', 4, 'document_type_code', 'character varying(30)', true, false),
        ('cm_customer_documents', 5, 'file_name', 'character varying(255)', true, false),
        ('cm_customer_documents', 6, 'storage_path', 'character varying(500)', true, false),
        ('cm_customer_documents', 7, 'file_type', 'character varying(100)', true, false),
        ('cm_customer_documents', 8, 'file_size', 'bigint', true, false),
        ('cm_customer_documents', 9, 'uploaded_by_account_id', 'uuid', false, false),
        ('cm_customer_documents', 10, 'uploaded_at', 'timestamp with time zone', true, true),
        ('cm_customer_documents', 11, 'note', 'text', false, false),
        ('cm_customer_documents', 12, 'signed_date', 'date', false, false),
        ('cm_customer_documents', 13, 'effective_date', 'date', false, false),
        ('cm_customer_documents', 14, 'expiry_date', 'date', false, false),
        ('cm_ref_provinces', 1, 'province_code', 'character(2)', true, false),
        ('cm_ref_provinces', 2, 'province_name', 'character varying(150)', true, false),
        ('cm_ref_provinces', 3, 'unit_type_code', 'character varying(20)', true, false),
        ('cm_ref_provinces', 4, 'valid_from', 'date', true, false),
        ('cm_ref_provinces', 5, 'valid_to', 'date', false, false),
        ('cm_ref_provinces', 6, 'is_active', 'boolean', true, true),
        ('cm_ref_provinces', 7, 'source_ref', 'character varying(255)', true, false),
        ('cm_ref_provinces', 8, 'source_version', 'character varying(60)', true, false),
        ('cm_ref_wards', 1, 'ward_code', 'character(5)', true, false),
        ('cm_ref_wards', 2, 'province_code', 'character(2)', true, false),
        ('cm_ref_wards', 3, 'ward_name', 'character varying(150)', true, false),
        ('cm_ref_wards', 4, 'unit_type_code', 'character varying(20)', true, false),
        ('cm_ref_wards', 5, 'valid_from', 'date', true, false),
        ('cm_ref_wards', 6, 'valid_to', 'date', false, false),
        ('cm_ref_wards', 7, 'is_active', 'boolean', true, true),
        ('cm_ref_wards', 8, 'source_ref', 'character varying(255)', true, false),
        ('cm_ref_wards', 9, 'source_version', 'character varying(60)', true, false),
        ('cm_ref_economic_regions', 1, 'region_code', 'character varying(20)', true, false),
        ('cm_ref_economic_regions', 2, 'region_name', 'character varying(150)', true, false),
        ('cm_ref_economic_regions', 3, 'valid_from', 'date', true, false),
        ('cm_ref_economic_regions', 4, 'valid_to', 'date', false, false),
        ('cm_ref_economic_regions', 5, 'is_active', 'boolean', true, true),
        ('cm_ref_economic_regions', 6, 'source_ref', 'character varying(255)', true, false),
        ('cm_ref_province_region_map', 1, 'province_code', 'character(2)', true, false),
        ('cm_ref_province_region_map', 2, 'region_code', 'character varying(20)', true, false),
        ('cm_ref_province_region_map', 3, 'macro_region_code', 'character varying(15)', true, false),
        ('cm_ref_province_region_map', 4, 'valid_from', 'date', true, false),
        ('cm_ref_province_region_map', 5, 'valid_to', 'date', false, false),
        ('cm_ref_province_region_map', 6, 'source_ref', 'character varying(255)', true, false),
        ('cm_ref_province_region_map', 7, 'mapping_version', 'character varying(60)', true, false)
    ), actual AS (
        SELECT c.relname::text AS tbl, a.attnum::int AS pos, a.attname::text AS col,
               format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull AS not_null, a.atthasdef AS has_default
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relnamespace = 'cm'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
    ), diff AS (
        (SELECT 'missing ' || e.tbl || '.' || e.col AS d FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) e)
        UNION ALL
        (SELECT 'unexpected ' || x.tbl || '.' || x.col FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) x)
    )
    SELECT string_agg(d, ', ' ORDER BY d) INTO v_diff FROM diff;
    IF v_diff IS NOT NULL THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: column contract differs: %', v_diff;
    END IF;
    -- customer_code default must call the cm sequence (not hand-entered, not MAX+1)
    IF NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                   WHERE d.adrelid = 'cm.cm_customers'::regclass AND a.attname = 'customer_code'
                     AND pg_get_expr(d.adbin, d.adrelid) LIKE '%nextval(''cm.customer_code_seq''::regclass)%') THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: cm_customers.customer_code default does not use cm.customer_code_seq';
    END IF;
    -- sequence parameters (04 A.1)
    SELECT * INTO v_seq FROM pg_sequence WHERE seqrelid = 'cm.customer_code_seq'::regclass;
    IF v_seq.seqtypid <> 'integer'::regtype OR v_seq.seqstart <> 1 OR v_seq.seqincrement <> 1 OR v_seq.seqmin <> 1
       OR v_seq.seqmax <> 999999 OR v_seq.seqcycle OR v_seq.seqcache <> 1 THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: customer_code_seq parameters differ from 1..999999 NO CYCLE';
    END IF;
    -- constraints (PostgreSQL 18 also records NOT NULL as contype 'n'; those are not counted here)
    IF (SELECT count(*) FROM pg_constraint WHERE connamespace = 'cm'::regnamespace AND contype = 'p') <> 11
       OR (SELECT count(*) FROM pg_constraint WHERE connamespace = 'cm'::regnamespace AND contype = 'u') <> 3
       OR (SELECT count(*) FROM pg_constraint WHERE connamespace = 'cm'::regnamespace AND contype = 'f') <> 12
       OR (SELECT count(*) FROM pg_constraint WHERE connamespace = 'cm'::regnamespace AND contype = 'c') <> 10
       OR EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'cm'::regnamespace AND contype NOT IN ('p', 'u', 'f', 'c', 'n')) THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: constraint counts differ from PK 11 / UNIQUE 3 / FK 12 / CHECK 10';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'cm'::regnamespace AND contype = 'f'
               AND (confdeltype <> 'r' OR (SELECT relnamespace FROM pg_class WHERE oid = confrelid) <> 'cm'::regnamespace)) THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: an FK is not ON DELETE RESTRICT or references outside schema cm';
    END IF;
    IF (SELECT array_agg(conname::text ORDER BY conname::text COLLATE "C") FROM pg_constraint
        WHERE connamespace = 'cm'::regnamespace AND contype = 'c')
       IS DISTINCT FROM ARRAY['ck_cm_customer_assignments_time_order', 'ck_cm_customer_contacts_phone_or_zalo',
                              'ck_cm_customer_documents_effective_expiry', 'ck_cm_customer_documents_file_size',
                              'ck_cm_customer_groups_not_own_parent', 'ck_cm_customers_customer_code_6_digit',
                              'ck_cm_customers_foreign_no_vn_reg', 'ck_cm_customers_official_profile',
                              'ck_cm_customers_ward_requires_province', 'ck_cm_ref_province_region_map_valid_range']::text[] THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: CHECK constraint names differ from the 10 of this file';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'cm'::regnamespace AND NOT t.tgisinternal) THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: a user trigger exists on a cm table (FK triggers are internal and excluded)';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'cm'::regnamespace AND relacl IS NOT NULL)
       OR (SELECT nspacl FROM pg_namespace WHERE nspname = 'cm') IS NOT NULL THEN
        RAISE EXCEPTION 'CM REV01 03 SELF-CHECK: grants exist on cm (expected none before 06)';
    END IF;
    RAISE NOTICE 'CM REV01 03 SELF-CHECK PASSED: 11 tables / 114 columns / seq 1..999999 NO CYCLE / PK 11 / UQ 3 / FK 12 / CHECK 10';
END
$cm_r01_03_check$;

COMMIT;
