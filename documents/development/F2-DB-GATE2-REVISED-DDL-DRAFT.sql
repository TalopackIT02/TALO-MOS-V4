-- =====================================================================================================================
-- DO NOT EXECUTE — OWNER APPROVAL REQUIRED
-- TALO-MOS-V4 — F2-DB-GATE2-REVISION-02 — Foundation PostgreSQL DDL DRAFT (REVIEW-ONLY)
-- Baseline : Foundation Database Design Baseline v1.0 (DESIGN LOCKED, 16/10/2026) — 14 tables / 125 columns
-- Decisions: owner-approved Q01–Q08 (REVISION-01) and the CHECK decisions of REVISION-02.
--            Database execution NOT approved (Gate 3 / Gate 4 pending).
-- Status   : never executed; PostgreSQL syntax NOT_TESTED. No GRANT/REVOKE, no role, no trigger/function/policy,
--            no reference to schema iam. Target database, schema owner and grants are NOT decided.
--
-- Classification used in this file
--   ACTIVE   [A]   stated in the baseline (PK, single-column FK, UNIQUE, CHECK value lists, defaults) — 11 CHECKs
--   ACTIVE   [Q01] partial UNIQUE index "one ACTIVE version per Module" (type approved by owner)
--   ACTIVE   [Q02] 2 supporting UNIQUE + 6 composite FKs "same Module" (type approved by owner)
--   ACTIVE   [OWNER APPROVED]           19 CHECKs approved verbatim: D-01…D-08, N-01…N-06 (except N-07), N-08, N-09,
--                                      N-10, N-12, N-13
--   ACTIVE   [OWNER APPROVED — REVISED] D-09, N-11 (expressions replaced by owner decision, REVISION-02)
--   PENDING  N-07, N-14: CHECK expressions still awaiting owner review — commented out at the end of this file
--   SUPERSEDED A-12 ck_fnd_compatibility_changes_area (4 values) — replaced by Q05 list N-10
--   BACKEND / PRIVILEGE / BLOCKED rules: noted inline, detailed in F2-DB-GATE2-CONSTRAINT-COVERAGE.md
-- Expected totals: PK 14 · FK 29 · UNIQUE 12 · partial UNIQUE index 1 · CHECK 32 (11 [A] + 19 + 2) · pending 2.
-- FK delete rule: ON DELETE RESTRICT everywhere (Q07). UUID: gen_random_uuid() (PostgreSQL 13+ core, as IAM v0.3).
-- =====================================================================================================================

BEGIN;

-- Anti-execution guard: the transaction aborts here; every later statement is ignored and nothing is created.
DO $$ BEGIN RAISE EXCEPTION 'DO NOT EXECUTE — Foundation DDL DRAFT requires owner approval (Gate 3)'; END $$;

CREATE SCHEMA foundation;   -- AUTHORIZATION (schema owner) NOT DECIDED — Gate 3

-- ---------------------------------------------------------------------------------------------------------------------
-- B01 foundation.fnd_modules — 9 columns (LOCKED)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_modules (
    module_id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    module_key              VARCHAR(80)  NOT NULL,                       -- Q03 identifier rule (D-01)
    module_name             VARCHAR(150) NOT NULL,
    description             TEXT,
    module_type             VARCHAR(20)  NOT NULL,
    is_enabled              BOOLEAN      NOT NULL DEFAULT false,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),          -- K03: backend updates; no trigger
    created_by_account_id   UUID,                                        -- logical ref IAM (no FK)
    CONSTRAINT pk_fnd_modules PRIMARY KEY (module_id),                                          -- [A]
    CONSTRAINT uq_fnd_modules_module_key UNIQUE (module_key),                                   -- [A]
    CONSTRAINT ck_fnd_modules_module_type CHECK (module_type IN ('INTERNAL','EXTERNAL')),       -- [A] A-01
    CONSTRAINT ck_fnd_modules_module_key_format
        CHECK (module_key ~ '^[A-Z][A-Z0-9_]*$')                                                -- [OWNER APPROVED] D-01
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B02 foundation.fnd_module_versions — 12 columns (LOCKED)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_module_versions (
    version_id              UUID         NOT NULL DEFAULT gen_random_uuid(),
    module_id               UUID         NOT NULL,
    module_version          VARCHAR(40)  NOT NULL,
    contract_version        VARCHAR(40)  NOT NULL,
    status                  VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',       -- transitions (Q04) = BACKEND
    manifest_json           JSONB,                                       -- RFC 8785 canonical MIC (Q03); D-04
    manifest_hash           CHAR(64),                                    -- SHA-256 lowercase hex (Q03); N-03, D-04
    submitted_by_account_id UUID,                                        -- logical ref IAM (no FK)
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    reviewed_by_account_id  UUID,                                        -- logical ref IAM (no FK); D-05
    reviewed_at             TIMESTAMPTZ,                                 -- D-05
    activated_at            TIMESTAMPTZ,                                 -- first activation; D-06
    CONSTRAINT pk_fnd_module_versions PRIMARY KEY (version_id),                                 -- [A]
    CONSTRAINT fk_fnd_module_versions_module_id FOREIGN KEY (module_id)
        REFERENCES foundation.fnd_modules (module_id) ON DELETE RESTRICT,                       -- [A]
    CONSTRAINT uq_fnd_module_versions_module_version UNIQUE (module_id, module_version),        -- [A]
    CONSTRAINT uq_fnd_module_versions_version_module UNIQUE (version_id, module_id),            -- [Q02] supporting UNIQUE 1/2
    CONSTRAINT ck_fnd_module_versions_status
        CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','ACTIVE','RETIRED','REJECTED')),       -- [A] A-02
    CONSTRAINT ck_fnd_module_versions_manifest_required
        CHECK (status = 'DRAFT' OR (manifest_json IS NOT NULL AND manifest_hash IS NOT NULL)),  -- [OWNER APPROVED] D-04
    CONSTRAINT ck_fnd_module_versions_review
        CHECK ((status IN ('DRAFT','IN_REVIEW')) = (reviewed_at IS NULL)
           AND (status IN ('DRAFT','IN_REVIEW')) = (reviewed_by_account_id IS NULL)),           -- [OWNER APPROVED] D-05
    CONSTRAINT ck_fnd_module_versions_activation
        CHECK ((status IN ('ACTIVE','RETIRED')) = (activated_at IS NOT NULL)),                  -- [OWNER APPROVED] D-06
    CONSTRAINT ck_fnd_module_versions_manifest_hash_format
        CHECK (manifest_hash IS NULL OR manifest_hash ~ '^[0-9a-f]{64}$')                       -- [OWNER APPROVED] N-03
);

-- [Q01] At most one ACTIVE version per Module. Non-deferrable: inside the activation / rollback transaction the
-- current ACTIVE version must be set to RETIRED BEFORE the new one is set to ACTIVE; any error rolls back both.
CREATE UNIQUE INDEX uq_fnd_module_versions_one_active
    ON foundation.fnd_module_versions (module_id)
    WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------------------------------------------------
-- B03 foundation.fnd_functions — 6 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_functions (
    function_id             UUID         NOT NULL DEFAULT gen_random_uuid(),
    module_id               UUID         NOT NULL,
    function_key            VARCHAR(100) NOT NULL,                       -- Q03 identifier rule (D-02)
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    retired_at              TIMESTAMPTZ,                                 -- K09
    replaces_function_id    UUID,                                        -- multi-level cycles: BACKEND (Q06); D-07
    CONSTRAINT pk_fnd_functions PRIMARY KEY (function_id),                                      -- [A]
    CONSTRAINT fk_fnd_functions_module_id FOREIGN KEY (module_id)
        REFERENCES foundation.fnd_modules (module_id) ON DELETE RESTRICT,                       -- [A]
    CONSTRAINT fk_fnd_functions_replaces_function_id FOREIGN KEY (replaces_function_id)
        REFERENCES foundation.fnd_functions (function_id) ON DELETE RESTRICT,                   -- [A]
    CONSTRAINT uq_fnd_functions_module_function_key UNIQUE (module_id, function_key),           -- [A]
    CONSTRAINT uq_fnd_functions_function_module UNIQUE (function_id, module_id),                -- [Q02] supporting UNIQUE 2/2
    CONSTRAINT fk_fnd_functions_replaces_same_module FOREIGN KEY (replaces_function_id, module_id)
        REFERENCES foundation.fnd_functions (function_id, module_id) ON DELETE RESTRICT,        -- [Q02] composite FK 1/6
    CONSTRAINT ck_fnd_functions_function_key_format
        CHECK (function_key ~ '^[A-Z][A-Z0-9_]*$'),                                             -- [OWNER APPROVED] D-02
    CONSTRAINT ck_fnd_functions_not_self_replacing
        CHECK (replaces_function_id IS NULL OR replaces_function_id <> function_id)             -- [OWNER APPROVED] D-07
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B04 foundation.fnd_actions — 5 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_actions (
    action_id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    function_id             UUID         NOT NULL,
    action_key              VARCHAR(30)  NOT NULL,                       -- Q03 identifier rule (D-03)
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    retired_at              TIMESTAMPTZ,                                 -- K09
    CONSTRAINT pk_fnd_actions PRIMARY KEY (action_id),                                          -- [A]
    CONSTRAINT fk_fnd_actions_function_id FOREIGN KEY (function_id)
        REFERENCES foundation.fnd_functions (function_id) ON DELETE RESTRICT,                   -- [A]
    CONSTRAINT uq_fnd_actions_function_action_key UNIQUE (function_id, action_key),             -- [A]
    CONSTRAINT ck_fnd_actions_action_key_format
        CHECK (action_key ~ '^[A-Z][A-Z0-9_]*$')                                                -- [OWNER APPROVED] D-03
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B05 foundation.fnd_version_functions — 7 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_version_functions (
    version_function_id     UUID         NOT NULL DEFAULT gen_random_uuid(),
    version_id              UUID         NOT NULL,
    function_id             UUID         NOT NULL,
    display_name            VARCHAR(150) NOT NULL,
    route_key               VARCHAR(200),
    definition_hash         CHAR(64),                                    -- SHA-256 lowercase hex (Q03); N-04
    is_deprecated           BOOLEAN      NOT NULL DEFAULT false,
    CONSTRAINT pk_fnd_version_functions PRIMARY KEY (version_function_id),                      -- [A]
    CONSTRAINT fk_fnd_version_functions_version_id FOREIGN KEY (version_id)
        REFERENCES foundation.fnd_module_versions (version_id) ON DELETE RESTRICT,              -- [A]
    CONSTRAINT fk_fnd_version_functions_function_id FOREIGN KEY (function_id)
        REFERENCES foundation.fnd_functions (function_id) ON DELETE RESTRICT,                   -- [A]
    CONSTRAINT uq_fnd_version_functions_version_function UNIQUE (version_id, function_id),      -- [A]
    CONSTRAINT ck_fnd_version_functions_definition_hash_format
        CHECK (definition_hash IS NULL OR definition_hash ~ '^[0-9a-f]{64}$')                   -- [OWNER APPROVED] N-04
    -- Version and Function in the same Module: no module_id column → BACKEND REQUIRED (Q02).
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B06 foundation.fnd_version_actions — 7 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_version_actions (
    version_action_id       UUID         NOT NULL DEFAULT gen_random_uuid(),
    version_function_id     UUID         NOT NULL,
    action_id               UUID         NOT NULL,
    description             TEXT,
    action_spec             JSONB,                                       -- RFC 8785 canonical form for hashing (Q03)
    definition_hash         CHAR(64),                                    -- SHA-256 lowercase hex (Q03); N-05
    is_deprecated           BOOLEAN      NOT NULL DEFAULT false,
    CONSTRAINT pk_fnd_version_actions PRIMARY KEY (version_action_id),                          -- [A]
    CONSTRAINT fk_fnd_version_actions_version_function_id FOREIGN KEY (version_function_id)
        REFERENCES foundation.fnd_version_functions (version_function_id) ON DELETE RESTRICT,   -- [A]
    CONSTRAINT fk_fnd_version_actions_action_id FOREIGN KEY (action_id)
        REFERENCES foundation.fnd_actions (action_id) ON DELETE RESTRICT,                       -- [A]
    CONSTRAINT uq_fnd_version_actions_version_function_action UNIQUE (version_function_id, action_id),  -- [A]
    CONSTRAINT ck_fnd_version_actions_definition_hash_format
        CHECK (definition_hash IS NULL OR definition_hash ~ '^[0-9a-f]{64}$')                   -- [OWNER APPROVED] N-05
    -- Action belongs to the Function of the version_function: no function_id column → BACKEND REQUIRED (Q02).
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B07 foundation.fnd_module_events — 9 columns (append-only: PRIVILEGE + BACKEND, Q07)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_module_events (
    event_id                UUID         NOT NULL DEFAULT gen_random_uuid(),
    module_id               UUID         NOT NULL,
    version_id              UUID,
    event_type              VARCHAR(40)  NOT NULL,                       -- Q05 list (N-08)
    actor_account_id        UUID,                                        -- logical ref IAM (no FK)
    before_state            JSONB,
    after_state             JSONB,
    occurred_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    correlation_id          VARCHAR(100),
    CONSTRAINT pk_fnd_module_events PRIMARY KEY (event_id),                                     -- [A]
    CONSTRAINT fk_fnd_module_events_module_id FOREIGN KEY (module_id)
        REFERENCES foundation.fnd_modules (module_id) ON DELETE RESTRICT,                       -- [A]
    CONSTRAINT fk_fnd_module_events_version_id FOREIGN KEY (version_id)
        REFERENCES foundation.fnd_module_versions (version_id) ON DELETE RESTRICT,              -- [A]
    CONSTRAINT fk_fnd_module_events_version_same_module FOREIGN KEY (version_id, module_id)
        REFERENCES foundation.fnd_module_versions (version_id, module_id) ON DELETE RESTRICT,   -- [Q02] composite FK 2/6
    CONSTRAINT ck_fnd_module_events_event_type
        CHECK (event_type IN ('REGISTER','SUBMIT','APPROVE','REJECT','ENABLE','DISABLE','ACTIVATE','RETIRE','ROLLBACK'))  -- [OWNER APPROVED] N-08
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B08 foundation.fnd_audit_logs — 15 columns (append-only: PRIVILEGE + BACKEND, Q07; IAM audit unchanged)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_audit_logs (
    audit_id                UUID         NOT NULL DEFAULT gen_random_uuid(),
    event_id                UUID         NOT NULL,                       -- anti-duplicate key; NOT an FK to B07 (Q07)
    module_id               UUID,                                        -- K06: NULL for Foundation-wide events; N-01
    version_id              UUID,                                        -- N-01: requires module_id
    actor_account_id        UUID,                                        -- logical ref IAM (no FK)
    session_id              UUID,                                        -- logical ref IAM (no FK)
    action_code             VARCHAR(120) NOT NULL,                       -- K07 list not approved → BLOCKED (no CHECK)
    target_type             VARCHAR(100) NOT NULL,
    target_id               VARCHAR(160),
    outcome                 VARCHAR(20)  NOT NULL,
    occurred_at             TIMESTAMPTZ  NOT NULL,                       -- source time from backend (no default)
    recorded_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    correlation_id          VARCHAR(100),
    source_service          VARCHAR(120) NOT NULL,
    metadata                JSONB,
    CONSTRAINT pk_fnd_audit_logs PRIMARY KEY (audit_id),                                        -- [A]
    CONSTRAINT uq_fnd_audit_logs_event_id UNIQUE (event_id),                                    -- [A]
    CONSTRAINT fk_fnd_audit_logs_module_id FOREIGN KEY (module_id)
        REFERENCES foundation.fnd_modules (module_id) ON DELETE RESTRICT,                       -- [A]
    CONSTRAINT fk_fnd_audit_logs_version_id FOREIGN KEY (version_id)
        REFERENCES foundation.fnd_module_versions (version_id) ON DELETE RESTRICT,              -- [A]
    CONSTRAINT fk_fnd_audit_logs_version_same_module FOREIGN KEY (version_id, module_id)
        REFERENCES foundation.fnd_module_versions (version_id, module_id) ON DELETE RESTRICT,   -- [Q02] composite FK 3/6
    CONSTRAINT ck_fnd_audit_logs_outcome CHECK (outcome IN ('SUCCESS','FAILURE','DENIED')),     -- [A] A-03
    CONSTRAINT ck_fnd_audit_logs_version_requires_module
        CHECK (version_id IS NULL OR module_id IS NOT NULL)                                     -- [OWNER APPROVED] N-01
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B09 foundation.fnd_navigation_items — 8 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_navigation_items (
    navigation_id           UUID         NOT NULL DEFAULT gen_random_uuid(),
    parent_id               UUID,                                        -- multi-level cycles: BACKEND (Q06); D-08
    module_id               UUID,                                        -- N-02
    function_id             UUID,                                        -- N-02: requires module_id
    menu_title              VARCHAR(150) NOT NULL,
    sort_order              INTEGER      NOT NULL DEFAULT 0,
    is_visible              BOOLEAN      NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_fnd_navigation_items PRIMARY KEY (navigation_id),                             -- [A]
    CONSTRAINT fk_fnd_navigation_items_parent_id FOREIGN KEY (parent_id)
        REFERENCES foundation.fnd_navigation_items (navigation_id) ON DELETE RESTRICT,          -- [A]
    CONSTRAINT fk_fnd_navigation_items_module_id FOREIGN KEY (module_id)
        REFERENCES foundation.fnd_modules (module_id) ON DELETE RESTRICT,                       -- [A]
    CONSTRAINT fk_fnd_navigation_items_function_id FOREIGN KEY (function_id)
        REFERENCES foundation.fnd_functions (function_id) ON DELETE RESTRICT,                   -- [A]
    CONSTRAINT fk_fnd_navigation_items_function_same_module FOREIGN KEY (function_id, module_id)
        REFERENCES foundation.fnd_functions (function_id, module_id) ON DELETE RESTRICT,        -- [Q02] composite FK 4/6
    CONSTRAINT ck_fnd_navigation_items_not_own_parent
        CHECK (parent_id IS NULL OR parent_id <> navigation_id),                                -- [OWNER APPROVED] D-08
    CONSTRAINT ck_fnd_navigation_items_function_requires_module
        CHECK (function_id IS NULL OR module_id IS NOT NULL)                                    -- [OWNER APPROVED] N-02
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B10 foundation.fnd_data_contracts — 11 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_data_contracts (
    data_contract_id        UUID         NOT NULL DEFAULT gen_random_uuid(),
    version_id              UUID         NOT NULL,
    resource_key            VARCHAR(120) NOT NULL,
    data_owner_key          VARCHAR(80)  NOT NULL,
    interface_kind          VARCHAR(20)  NOT NULL,
    schema_name             VARCHAR(100),                                -- N-11: required (non-blank) for DIRECT_DB
    table_name              VARCHAR(100),                                -- N-11: required (non-blank) for DIRECT_DB
    schema_version          VARCHAR(40)  NOT NULL,
    contract_spec           JSONB        NOT NULL,                       -- RFC 8785 canonical form for hashing (Q03)
    contract_hash           CHAR(64)     NOT NULL,                       -- SHA-256 lowercase hex (Q03); N-06
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_fnd_data_contracts PRIMARY KEY (data_contract_id),                            -- [A]
    CONSTRAINT fk_fnd_data_contracts_version_id FOREIGN KEY (version_id)
        REFERENCES foundation.fnd_module_versions (version_id) ON DELETE RESTRICT,              -- [A]
    CONSTRAINT uq_fnd_data_contracts_version_resource UNIQUE (version_id, resource_key),        -- [A]
    CONSTRAINT ck_fnd_data_contracts_interface_kind
        CHECK (interface_kind IN ('API','VIEW','EVENT','DIRECT_DB')),                           -- [A] A-04
    CONSTRAINT ck_fnd_data_contracts_contract_hash_format
        CHECK (contract_hash ~ '^[0-9a-f]{64}$'),                                               -- [OWNER APPROVED] N-06
    CONSTRAINT ck_fnd_data_contracts_direct_db_target
        CHECK (
            interface_kind <> 'DIRECT_DB'
            OR (
                NULLIF(btrim(schema_name), '') IS NOT NULL
                AND NULLIF(btrim(table_name), '') IS NOT NULL
            )
        )                                                                                       -- [OWNER APPROVED — REVISED] N-11
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B11 foundation.fnd_data_fields — 9 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_data_fields (
    field_id                UUID         NOT NULL DEFAULT gen_random_uuid(),
    data_contract_id        UUID         NOT NULL,
    field_name              VARCHAR(100) NOT NULL,
    field_type              VARCHAR(100) NOT NULL,
    is_required             BOOLEAN      NOT NULL DEFAULT false,
    default_expression      TEXT,                                        -- description only, never executed
    is_primary_key          BOOLEAN      NOT NULL DEFAULT false,
    references_target       VARCHAR(250),                                -- K10 schema.table.column; N-14 PENDING
    description             TEXT,
    CONSTRAINT pk_fnd_data_fields PRIMARY KEY (field_id),                                       -- [A]
    CONSTRAINT fk_fnd_data_fields_data_contract_id FOREIGN KEY (data_contract_id)
        REFERENCES foundation.fnd_data_contracts (data_contract_id) ON DELETE RESTRICT,         -- [A]
    CONSTRAINT uq_fnd_data_fields_contract_field UNIQUE (data_contract_id, field_name)          -- [A]
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B12 foundation.fnd_data_access_rules — 8 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_data_access_rules (
    access_rule_id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    data_contract_id        UUID         NOT NULL,
    version_action_id       UUID         NOT NULL,
    data_operation          VARCHAR(20)  NOT NULL,
    approval_mode           VARCHAR(20)  NOT NULL DEFAULT 'UNSPECIFIED', -- N-12, D-09
    workflow_key            VARCHAR(120),                                -- D-09; workflow existence/validity = BACKEND
    is_enabled              BOOLEAN      NOT NULL DEFAULT false,         -- N-12
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_fnd_data_access_rules PRIMARY KEY (access_rule_id),                           -- [A]
    CONSTRAINT fk_fnd_data_access_rules_data_contract_id FOREIGN KEY (data_contract_id)
        REFERENCES foundation.fnd_data_contracts (data_contract_id) ON DELETE RESTRICT,         -- [A]
    CONSTRAINT fk_fnd_data_access_rules_version_action_id FOREIGN KEY (version_action_id)
        REFERENCES foundation.fnd_version_actions (version_action_id) ON DELETE RESTRICT,       -- [A]
    CONSTRAINT uq_fnd_data_access_rules_contract_action_operation
        UNIQUE (data_contract_id, version_action_id, data_operation),                           -- [A]
    CONSTRAINT ck_fnd_data_access_rules_data_operation
        CHECK (data_operation IN ('SELECT','INSERT','UPDATE','DELETE')),                        -- [A] A-05
    CONSTRAINT ck_fnd_data_access_rules_approval_mode
        CHECK (approval_mode IN ('REQUIRED','NOT_REQUIRED','UNSPECIFIED')),                     -- [A] A-06
    CONSTRAINT ck_fnd_data_access_rules_workflow_when_required
        CHECK (
            approval_mode <> 'REQUIRED'
            OR (
                workflow_key IS NOT NULL
                AND btrim(workflow_key) <> ''
            )
        ),                                                                                      -- [OWNER APPROVED — REVISED] D-09
    CONSTRAINT ck_fnd_data_access_rules_enabled_needs_mode
        CHECK (NOT (is_enabled AND approval_mode = 'UNSPECIFIED'))                              -- [OWNER APPROVED] N-12
    -- Data Contract and Version Action in the same Version: spans B10/B06/B05 → BACKEND REQUIRED (Q02).
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B13 foundation.fnd_compatibility_checks — 9 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_compatibility_checks (
    check_id                UUID         NOT NULL DEFAULT gen_random_uuid(),
    module_id               UUID         NOT NULL,
    from_version_id         UUID,                                        -- NULL on first registration
    to_version_id           UUID         NOT NULL,
    environment             VARCHAR(20)  NOT NULL,
    check_result            VARCHAR(20)  NOT NULL DEFAULT 'PENDING',     -- BLOCK = overall result (Q05)
    database_fingerprint    CHAR(64),                                    -- algorithm/input NOT decided; N-07 PENDING
    started_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at            TIMESTAMPTZ,                                 -- N-13
    CONSTRAINT pk_fnd_compatibility_checks PRIMARY KEY (check_id),                              -- [A]
    CONSTRAINT fk_fnd_compatibility_checks_module_id FOREIGN KEY (module_id)
        REFERENCES foundation.fnd_modules (module_id) ON DELETE RESTRICT,                       -- [A]
    CONSTRAINT fk_fnd_compatibility_checks_from_version_id FOREIGN KEY (from_version_id)
        REFERENCES foundation.fnd_module_versions (version_id) ON DELETE RESTRICT,              -- [A]
    CONSTRAINT fk_fnd_compatibility_checks_to_version_id FOREIGN KEY (to_version_id)
        REFERENCES foundation.fnd_module_versions (version_id) ON DELETE RESTRICT,              -- [A]
    CONSTRAINT fk_fnd_compatibility_checks_from_same_module FOREIGN KEY (from_version_id, module_id)
        REFERENCES foundation.fnd_module_versions (version_id, module_id) ON DELETE RESTRICT,   -- [Q02] composite FK 5/6
    CONSTRAINT fk_fnd_compatibility_checks_to_same_module FOREIGN KEY (to_version_id, module_id)
        REFERENCES foundation.fnd_module_versions (version_id, module_id) ON DELETE RESTRICT,   -- [Q02] composite FK 6/6
    CONSTRAINT ck_fnd_compatibility_checks_environment
        CHECK (environment IN ('DEV','TEST','PROD')),                                           -- [A] A-07
    CONSTRAINT ck_fnd_compatibility_checks_result
        CHECK (check_result IN ('PASS','WARN','BLOCK','FAILED','PENDING')),                     -- [A] A-08
    CONSTRAINT ck_fnd_compatibility_checks_distinct_versions
        CHECK (from_version_id IS NULL OR from_version_id <> to_version_id),                    -- [A] A-09
    CONSTRAINT ck_fnd_compatibility_checks_completed_after_start
        CHECK (completed_at IS NULL OR completed_at >= started_at)                              -- [OWNER APPROVED] N-13
);

-- ---------------------------------------------------------------------------------------------------------------------
-- B14 foundation.fnd_compatibility_changes — 10 columns
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE foundation.fnd_compatibility_changes (
    change_id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    check_id                UUID         NOT NULL,
    change_area             VARCHAR(30)  NOT NULL,                       -- Q05 list (N-10, replaces A-12)
    object_key              VARCHAR(250) NOT NULL,
    change_type             VARCHAR(30)  NOT NULL,
    severity                VARCHAR(20)  NOT NULL,                       -- BLOCKING = severity of one change (Q05)
    previous_value          JSONB,
    proposed_value          JSONB,
    resolution_status       VARCHAR(20)  NOT NULL DEFAULT 'OPEN',        -- Q05 list (N-09)
    details                 TEXT,
    CONSTRAINT pk_fnd_compatibility_changes PRIMARY KEY (change_id),                            -- [A]
    CONSTRAINT fk_fnd_compatibility_changes_check_id FOREIGN KEY (check_id)
        REFERENCES foundation.fnd_compatibility_checks (check_id) ON DELETE RESTRICT,           -- [A]
    CONSTRAINT ck_fnd_compatibility_changes_type
        CHECK (change_type IN ('ADDED','REMOVED','MODIFIED','MISSING')),                        -- [A] A-10
    CONSTRAINT ck_fnd_compatibility_changes_severity
        CHECK (severity IN ('INFO','WARNING','BLOCKING')),                                      -- [A] A-11
    CONSTRAINT ck_fnd_compatibility_changes_resolution_status
        CHECK (resolution_status IN ('OPEN','RESOLVED')),                                       -- [OWNER APPROVED] N-09
    CONSTRAINT ck_fnd_compatibility_changes_area
        CHECK (change_area IN ('FUNCTION','ACTION','DATA','API','MODULE','UI','IAM','AUDIT','COMPATIBILITY','INTEGRITY'))  -- [OWNER APPROVED] N-10
    -- SUPERSEDED A-12: CHECK (change_area IN ('FUNCTION','ACTION','DATA','API')) — replaced by Q05 list N-10.
);

-- =====================================================================================================================
-- PENDING OWNER REVIEW — NOT ACTIVE. Each line becomes active only after the owner approves its exact expression.
-- Details, examples and limits: F2-DB-GATE2-CHECK-D-REVIEW.md
-- =====================================================================================================================
-- N-07 ALTER TABLE foundation.fnd_compatibility_checks ADD CONSTRAINT ck_fnd_compatibility_checks_fingerprint_format
--        CHECK (database_fingerprint IS NULL OR database_fingerprint ~ '^[0-9a-f]{64}$');
--      (owner, REVISION-02: fingerprint algorithm and metadata input NOT decided; do not assume SHA-256)
-- N-14 ALTER TABLE foundation.fnd_data_fields ADD CONSTRAINT ck_fnd_data_fields_references_target_format
--        CHECK (references_target IS NULL
--               OR references_target ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$');
--      (owner, REVISION-02: K10 rule kept; regex, quoted identifiers and letter case NOT decided)

ROLLBACK;   -- draft only: never COMMIT. Gate 3 supplies the approved script, target DB, owner, grants, tests, rollback.
