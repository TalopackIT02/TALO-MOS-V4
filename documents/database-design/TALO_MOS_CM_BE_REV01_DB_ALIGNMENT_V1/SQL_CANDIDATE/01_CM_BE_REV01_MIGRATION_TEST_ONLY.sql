-- CM BE REV01 / DB ALIGNMENT V1 — MIGRATION CANDIDATE / TEST ONLY
-- SOURCE: installed CRM REV01 R2; SQL reference is not a live database dump.
-- ADDS: 4 tables, 3 columns to existing 11 tables, supporting indexes/constraints.
-- Requires: owner approval, live schema diff, clone dry-run. Never run automatically from this package.
-- WARNING: this script MUST NOT be run on DEV or PROD.
\set ON_ERROR_STOP on
\pset pager off

\if :{?cm_be_migration_ack}
SELECT set_config('cm_be.migration_ack', :'cm_be_migration_ack', false);
\else
DO $cm_be_missing_ack$ BEGIN RAISE EXCEPTION 'CM BE REV01 STOP: missing cm_be_migration_ack'; END $cm_be_missing_ack$;
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $cm_be_guard$
DECLARE v_tables integer; v_cols integer; v_owner text;
BEGIN
 IF current_database() <> 'talo_mos_v4_test' THEN RAISE EXCEPTION 'TEST ONLY: database %', current_database(); END IF;
 IF session_user <> 'admin' OR current_user <> 'admin' THEN RAISE EXCEPTION 'admin only'; END IF;
 IF current_setting('cm_be.migration_ack',true) IS DISTINCT FROM 'APPROVED_CM_BE_REV01_TEST' THEN
  RAISE EXCEPTION 'CM BE REV01 STOP: owner approval missing/incorrect'; END IF;
 IF current_setting('transaction_read_only') = 'on' THEN RAISE EXCEPTION 'read-only session'; END IF;
 SELECT pg_get_userbyid(nspowner) INTO v_owner FROM pg_namespace WHERE nspname='cm';
 IF v_owner IS DISTINCT FROM 'talo_cm_owner' THEN RAISE EXCEPTION 'wrong/missing cm schema owner: %',v_owner; END IF;
 IF NOT pg_has_role(session_user,'talo_cm_owner','SET') THEN RAISE EXCEPTION 'admin cannot SET ROLE owner'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='talo_app' AND rolcanlogin AND NOT rolsuper) THEN
  RAISE EXCEPTION 'talo_app missing / privilege drift'; END IF;
 SELECT count(*) INTO v_tables FROM pg_class WHERE relnamespace='cm'::regnamespace AND relkind='r';
 SELECT count(*) INTO v_cols FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 WHERE c.relnamespace='cm'::regnamespace AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped;
 IF v_tables <> 11 OR v_cols <> 114 THEN
  RAISE EXCEPTION 'R2 baseline drift: expected 11 tables/114 columns; actual %/%',v_tables,v_cols; END IF;
 IF to_regclass('cm.cm_customer_legal_change_requests') IS NOT NULL
 OR to_regclass('cm.cm_customer_legal_change_approvals') IS NOT NULL
 OR to_regclass('cm.cm_customer_handovers') IS NOT NULL
 OR to_regclass('cm.cm_customer_handover_activity_transfers') IS NOT NULL THEN
  RAISE EXCEPTION 'migration objects already present; STOP not idempotent'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='cm' AND c.relname='uq_cm_customer_assignments_current' AND c.relkind='i') THEN
  RAISE EXCEPTION 'expected R2 assignment index missing'; END IF;
 -- Existing data must be reconciled before changing independent record status semantics.
 IF EXISTS(SELECT 1 FROM cm.cm_customers) THEN
  RAISE EXCEPTION 'cm_customers is no longer empty; require owner-approved data backfill, do not silently mark all DRAFT'; END IF;
END $cm_be_guard$;

SET LOCAL ROLE talo_cm_owner;

-- 1. DRAFT/VERIFIED independent of relationship status PROSPECT/ACTIVE/etc.
ALTER TABLE cm.cm_customers ADD COLUMN record_status_code varchar(12) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE cm.cm_customers ADD CONSTRAINT ck_cm_customers_record_status
 CHECK (record_status_code IN ('DRAFT','VERIFIED'));
ALTER TABLE cm.cm_customers DROP CONSTRAINT ck_cm_customers_official_profile;
ALTER TABLE cm.cm_customers ADD CONSTRAINT ck_cm_customers_official_profile
 CHECK (record_status_code <> 'VERIFIED' OR
       (NULLIF(BTRIM(legal_name),'') IS NOT NULL
        AND legal_identifier_type_code IS NOT NULL
        AND NULLIF(BTRIM(legal_identifier_normalized),'') IS NOT NULL
        AND NULLIF(BTRIM(address_line),'') IS NOT NULL
        AND (country_code <> 'VN' OR (province_code IS NOT NULL AND ward_code IS NOT NULL))));

-- 2. One PRIMARY and many SUPPORT assignments; keep immutable closed history.
ALTER TABLE cm.cm_customer_assignments
 ADD COLUMN assignment_role_code varchar(16) NOT NULL DEFAULT 'PRIMARY';
ALTER TABLE cm.cm_customer_assignments
 ADD CONSTRAINT ck_cm_customer_assignments_role
 CHECK (assignment_role_code IN ('PRIMARY','SUPPORT'));
DROP INDEX cm.uq_cm_customer_assignments_current;
CREATE UNIQUE INDEX uq_cm_customer_assignments_active_primary
 ON cm.cm_customer_assignments(customer_id)
 WHERE ended_at IS NULL AND assignment_role_code = 'PRIMARY';
CREATE UNIQUE INDEX uq_cm_customer_assignments_active_sale
 ON cm.cm_customer_assignments(customer_id,sale_account_id)
 WHERE ended_at IS NULL;
-- Additional composite identity to bind a handover to an assignment of the same customer.
ALTER TABLE cm.cm_customer_assignments ADD CONSTRAINT uq_cm_assignment_customer
 UNIQUE(assignment_id,customer_id);

-- 3. Version link, same-customer referential integrity, no overwrites of old storage files.
ALTER TABLE cm.cm_customer_documents ADD COLUMN supersedes_document_id uuid;
ALTER TABLE cm.cm_customer_documents ADD CONSTRAINT uq_cm_document_customer
 UNIQUE(document_id,customer_id);
ALTER TABLE cm.cm_customer_documents ADD CONSTRAINT fk_cm_documents_supersedes_same_customer
 FOREIGN KEY(supersedes_document_id,customer_id)
 REFERENCES cm.cm_customer_documents(document_id,customer_id) ON DELETE RESTRICT;
ALTER TABLE cm.cm_customer_documents ADD CONSTRAINT ck_cm_documents_not_self_supersede
 CHECK (supersedes_document_id IS NULL OR supersedes_document_id <> document_id);
CREATE UNIQUE INDEX uq_cm_documents_one_successor
 ON cm.cm_customer_documents(supersedes_document_id) WHERE supersedes_document_id IS NOT NULL;

-- 4. Legal field change: immutable proposed/before snapshots; decisions are separate, no direct-PATCH bypass.
CREATE TABLE cm.cm_customer_legal_change_requests (
 change_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL,
 requested_by_account_id uuid NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 status_code varchar(24) NOT NULL DEFAULT 'PENDING_MANAGEMENT',
 reason text NOT NULL,
 evidence_document_id uuid NOT NULL,
 old_legal_name varchar(255),
 new_legal_name varchar(255) NOT NULL,
 old_country_code char(2) NOT NULL,
 new_country_code char(2) NOT NULL,
 old_customer_type_code varchar(30),
 new_customer_type_code varchar(30) NOT NULL,
 old_identifier_type_code varchar(30),
 new_identifier_type_code varchar(30) NOT NULL,
 old_identifier_normalized varchar(128),
 new_identifier_normalized varchar(128) NOT NULL,
 resolved_at timestamptz,
 applied_at timestamptz,
 applied_by_account_id uuid,
 CONSTRAINT pk_cm_legal_change_requests PRIMARY KEY(change_request_id),
 CONSTRAINT fk_cm_legal_request_customer FOREIGN KEY(customer_id)
   REFERENCES cm.cm_customers(customer_id) ON DELETE RESTRICT,
 CONSTRAINT fk_cm_legal_request_evidence_same_customer FOREIGN KEY(evidence_document_id,customer_id)
   REFERENCES cm.cm_customer_documents(document_id,customer_id) ON DELETE RESTRICT,
 CONSTRAINT ck_cm_legal_request_status CHECK(status_code IN
   ('PENDING_MANAGEMENT','PENDING_ACCOUNTING','APPLIED','REJECTED','CANCELLED')),
 CONSTRAINT ck_cm_legal_request_reason CHECK(NULLIF(BTRIM(reason),'') IS NOT NULL),
 CONSTRAINT ck_cm_legal_request_applied CHECK(
    (status_code='APPLIED' AND applied_at IS NOT NULL) OR (status_code<>'APPLIED' AND applied_at IS NULL))
);
CREATE UNIQUE INDEX uq_cm_legal_request_one_pending_customer
 ON cm.cm_customer_legal_change_requests(customer_id)
 WHERE status_code IN ('PENDING_MANAGEMENT','PENDING_ACCOUNTING');
CREATE INDEX ix_cm_legal_request_customer_time
 ON cm.cm_customer_legal_change_requests(customer_id,requested_at DESC);

CREATE TABLE cm.cm_customer_legal_change_approvals (
 approval_id uuid NOT NULL DEFAULT gen_random_uuid(),
 change_request_id uuid NOT NULL,
 stage_code varchar(16) NOT NULL,
 decision_code varchar(12) NOT NULL,
 decided_by_account_id uuid NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT now(),
 decision_note text,
 CONSTRAINT pk_cm_legal_change_approvals PRIMARY KEY(approval_id),
 CONSTRAINT fk_cm_legal_approval_request FOREIGN KEY(change_request_id)
   REFERENCES cm.cm_customer_legal_change_requests(change_request_id) ON DELETE RESTRICT,
 CONSTRAINT uq_cm_legal_approval_stage UNIQUE(change_request_id,stage_code),
 CONSTRAINT ck_cm_legal_approval_stage CHECK(stage_code IN ('MANAGEMENT','ACCOUNTING')),
 CONSTRAINT ck_cm_legal_approval_decision CHECK(decision_code IN ('APPROVED','REJECTED'))
);

-- 5. Two handover flows: single request/acknowledgement record per attempt.
CREATE TABLE cm.cm_customer_handovers (
 handover_id uuid NOT NULL DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL,
 from_assignment_id uuid NOT NULL,
 to_sale_account_id uuid NOT NULL,
 initiated_by_account_id uuid NOT NULL,
 handover_mode_code varchar(20) NOT NULL,
 status_code varchar(26) NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 manager_approved_by_account_id uuid,
 manager_approved_at timestamptz,
 current_ack_by_account_id uuid,
 current_ack_at timestamptz,
 current_ack_override_by_account_id uuid,
 current_ack_override_reason text,
 receiver_ack_by_account_id uuid,
 receiver_ack_at timestamptz,
 rejected_by_account_id uuid,
 rejected_at timestamptz,
 rejection_reason text,
 completed_at timestamptz,
 handover_note text,
 CONSTRAINT pk_cm_customer_handovers PRIMARY KEY(handover_id),
 CONSTRAINT fk_cm_handover_customer FOREIGN KEY(customer_id)
    REFERENCES cm.cm_customers(customer_id) ON DELETE RESTRICT,
 CONSTRAINT fk_cm_handover_assignment_same_customer FOREIGN KEY(from_assignment_id,customer_id)
    REFERENCES cm.cm_customer_assignments(assignment_id,customer_id) ON DELETE RESTRICT,
 CONSTRAINT ck_cm_handover_mode CHECK(handover_mode_code IN ('MANAGER_INITIATED','SALE_INITIATED')),
 CONSTRAINT ck_cm_handover_status CHECK(status_code IN
    ('PENDING_APPROVAL','PENDING_CURRENT_ACK','PENDING_RECEIVER_ACK','COMPLETED','REJECTED','CANCELLED')),
 CONSTRAINT ck_cm_handover_override CHECK(
   (current_ack_override_by_account_id IS NULL AND current_ack_override_reason IS NULL) OR
   (current_ack_override_by_account_id IS NOT NULL AND NULLIF(BTRIM(current_ack_override_reason),'') IS NOT NULL)),
 CONSTRAINT ck_cm_handover_rejected CHECK(status_code<>'REJECTED' OR
    (rejected_by_account_id IS NOT NULL AND rejected_at IS NOT NULL)),
 CONSTRAINT ck_cm_handover_completed CHECK((status_code='COMPLETED')=(completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_cm_handover_one_open_customer
 ON cm.cm_customer_handovers(customer_id)
 WHERE status_code IN ('PENDING_APPROVAL','PENDING_CURRENT_ACK','PENDING_RECEIVER_ACK');
CREATE INDEX ix_cm_handovers_requested_by_status
 ON cm.cm_customer_handovers(initiated_by_account_id,status_code,requested_at DESC);
ALTER TABLE cm.cm_customer_handovers ADD CONSTRAINT uq_cm_handover_customer UNIQUE(handover_id,customer_id);

-- 6. Preserve old/new assignee when open activities are transferred after an accepted handover.
ALTER TABLE cm.cm_customer_activities ADD CONSTRAINT uq_cm_activity_customer UNIQUE(activity_id,customer_id);
CREATE TABLE cm.cm_customer_handover_activity_transfers (
 transfer_id uuid NOT NULL DEFAULT gen_random_uuid(),
 handover_id uuid NOT NULL,
 activity_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 previous_assignee_account_id uuid NOT NULL,
 new_assignee_account_id uuid NOT NULL,
 transferred_by_account_id uuid NOT NULL,
 transferred_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT pk_cm_handover_activity_transfers PRIMARY KEY(transfer_id),
 CONSTRAINT uq_cm_handover_activity UNIQUE(handover_id,activity_id),
 CONSTRAINT fk_cm_handover_transfer_handover FOREIGN KEY(handover_id,customer_id)
   REFERENCES cm.cm_customer_handovers(handover_id,customer_id) ON DELETE RESTRICT,
 CONSTRAINT fk_cm_handover_transfer_activity FOREIGN KEY(activity_id,customer_id)
   REFERENCES cm.cm_customer_activities(activity_id,customer_id) ON DELETE RESTRICT,
 CONSTRAINT ck_cm_handover_transfer_distinct CHECK(previous_assignee_account_id<>new_assignee_account_id)
);

-- 7. Column-level GRANT delta only. DB permissions are NOT IAM permissions.
GRANT INSERT(record_status_code) ON cm.cm_customers TO talo_app;
GRANT UPDATE(record_status_code) ON cm.cm_customers TO talo_app;
GRANT INSERT(assignment_role_code) ON cm.cm_customer_assignments TO talo_app;
GRANT INSERT(supersedes_document_id) ON cm.cm_customer_documents TO talo_app;
GRANT UPDATE(document_name,document_type_code,note,signed_date,effective_date,expiry_date)
 ON cm.cm_customer_documents TO talo_app;

GRANT SELECT ON cm.cm_customer_legal_change_requests TO talo_app;
GRANT INSERT(customer_id,requested_by_account_id,reason,evidence_document_id,
 old_legal_name,new_legal_name,old_country_code,new_country_code,old_customer_type_code,new_customer_type_code,
 old_identifier_type_code,new_identifier_type_code,
 old_identifier_normalized,new_identifier_normalized)
 ON cm.cm_customer_legal_change_requests TO talo_app;
GRANT UPDATE(status_code,resolved_at,applied_at,applied_by_account_id)
 ON cm.cm_customer_legal_change_requests TO talo_app;
GRANT SELECT ON cm.cm_customer_legal_change_approvals TO talo_app;
GRANT INSERT(change_request_id,stage_code,decision_code,decided_by_account_id,decision_note)
 ON cm.cm_customer_legal_change_approvals TO talo_app;
GRANT SELECT ON cm.cm_customer_handovers TO talo_app;
GRANT INSERT(customer_id,from_assignment_id,to_sale_account_id,initiated_by_account_id,
 handover_mode_code,status_code,handover_note)
 ON cm.cm_customer_handovers TO talo_app;
GRANT UPDATE(status_code,manager_approved_by_account_id,manager_approved_at,
 current_ack_by_account_id,current_ack_at,current_ack_override_by_account_id,current_ack_override_reason,
 receiver_ack_by_account_id,receiver_ack_at,
 rejected_by_account_id,rejected_at,rejection_reason,completed_at)
 ON cm.cm_customer_handovers TO talo_app;
GRANT SELECT ON cm.cm_customer_handover_activity_transfers TO talo_app;
GRANT INSERT(handover_id,activity_id,customer_id,previous_assignee_account_id,
 new_assignee_account_id,transferred_by_account_id)
 ON cm.cm_customer_handover_activity_transfers TO talo_app;

RESET ROLE;

DO $cm_be_postcheck$
DECLARE v_tables integer;
BEGIN
 SELECT count(*) INTO v_tables FROM pg_class WHERE relnamespace='cm'::regnamespace AND relkind='r';
 IF v_tables<>15 THEN RAISE EXCEPTION 'expected 15 CM tables, got %',v_tables; END IF;
 IF NOT has_column_privilege('talo_app','cm.cm_customers','record_status_code','UPDATE') THEN
  RAISE EXCEPTION 'missing record_status_code UPDATE grant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE c.relnamespace='cm'::regnamespace AND c.relname='uq_cm_customer_assignments_active_primary') THEN
  RAISE EXCEPTION 'missing active PRIMARY unique index'; END IF;
 RAISE NOTICE 'CM BE REV01 CANDIDATE POSTCHECK PASS: 15 tables; pending detailed verification';
END $cm_be_postcheck$;
COMMIT;
