-- REVERSAL CANDIDATE — only if database has NO CRM BUSINESS DATA and changes need to be removed.
-- NEVER run automatically after an error. Prefer backup/owner-approved recovery plan for any real data.
\set ON_ERROR_STOP on
\if :{?cm_be_rollback_ack}
SELECT set_config('cm_be.rollback_ack', :'cm_be_rollback_ack', false);
\else
DO $cm_be_no_rollback$ BEGIN RAISE EXCEPTION 'rollback acknowledgement missing'; END $cm_be_no_rollback$;
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $cm_be_rollback_guard$
BEGIN
 IF current_database()<>'talo_mos_v4_test' OR current_user<>'admin' OR session_user<>'admin' THEN
  RAISE EXCEPTION 'Rollback candidate: TEST admin only'; END IF;
 IF current_setting('cm_be.rollback_ack',true) IS DISTINCT FROM 'APPROVED_EMPTY_CM_BE_REV01_ROLLBACK' THEN
  RAISE EXCEPTION 'Not approved for empty rollback'; END IF;
 IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='cm')<>'talo_cm_owner' THEN
  RAISE EXCEPTION 'CM schema owner drift'; END IF;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='cm'::regnamespace AND relkind='r')<>15 THEN
  RAISE EXCEPTION 'Expected 15 CRM tables'; END IF;
 IF EXISTS(SELECT 1 FROM cm.cm_customers) OR EXISTS(SELECT 1 FROM cm.cm_customer_contacts)
 OR EXISTS(SELECT 1 FROM cm.cm_customer_groups) OR EXISTS(SELECT 1 FROM cm.cm_customer_group_members)
 OR EXISTS(SELECT 1 FROM cm.cm_customer_assignments) OR EXISTS(SELECT 1 FROM cm.cm_customer_activities)
 OR EXISTS(SELECT 1 FROM cm.cm_customer_documents)
 OR EXISTS(SELECT 1 FROM cm.cm_customer_handovers)
 OR EXISTS(SELECT 1 FROM cm.cm_customer_handover_activity_transfers)
 OR EXISTS(SELECT 1 FROM cm.cm_customer_legal_change_requests)
 OR EXISTS(SELECT 1 FROM cm.cm_customer_legal_change_approvals) THEN
  RAISE EXCEPTION 'NON-EMPTY CRM, no destructive rollback permitted'; END IF;
END $cm_be_rollback_guard$;
SET LOCAL ROLE talo_cm_owner;
DROP TABLE cm.cm_customer_handover_activity_transfers;
DROP TABLE cm.cm_customer_handovers;
DROP TABLE cm.cm_customer_legal_change_approvals;
DROP TABLE cm.cm_customer_legal_change_requests;
REVOKE UPDATE(document_name,document_type_code,note,signed_date,effective_date,expiry_date)
 ON cm.cm_customer_documents FROM talo_app;
ALTER TABLE cm.cm_customer_documents DROP COLUMN supersedes_document_id;
ALTER TABLE cm.cm_customer_documents DROP CONSTRAINT uq_cm_document_customer;
DROP INDEX cm.uq_cm_customer_assignments_active_primary;
DROP INDEX cm.uq_cm_customer_assignments_active_sale;
ALTER TABLE cm.cm_customer_assignments DROP COLUMN assignment_role_code;
ALTER TABLE cm.cm_customer_assignments DROP CONSTRAINT uq_cm_assignment_customer;
CREATE UNIQUE INDEX uq_cm_customer_assignments_current
 ON cm.cm_customer_assignments(customer_id) WHERE ended_at IS NULL;
ALTER TABLE cm.cm_customer_activities DROP CONSTRAINT uq_cm_activity_customer;
ALTER TABLE cm.cm_customers DROP CONSTRAINT ck_cm_customers_official_profile;
ALTER TABLE cm.cm_customers DROP COLUMN record_status_code;
ALTER TABLE cm.cm_customers ADD CONSTRAINT ck_cm_customers_official_profile
 CHECK(customer_status_code='PROSPECT' OR
       (NULLIF(BTRIM(legal_name),'') IS NOT NULL AND legal_identifier_type_code IS NOT NULL
        AND NULLIF(BTRIM(legal_identifier_normalized),'') IS NOT NULL AND NULLIF(BTRIM(address_line),'') IS NOT NULL
        AND (country_code<>'VN' OR (province_code IS NOT NULL AND ward_code IS NOT NULL))));
RESET ROLE;
DO $cm_be_rollback_verify$
DECLARE n_tables integer; n_cols integer;
BEGIN
 SELECT count(*) INTO n_tables FROM pg_class WHERE relnamespace='cm'::regnamespace AND relkind='r';
 SELECT count(*) INTO n_cols FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 WHERE c.relnamespace='cm'::regnamespace AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped;
 IF n_tables<>11 OR n_cols<>114 THEN RAISE EXCEPTION 'Rollback count mismatch %/%',n_tables,n_cols; END IF;
 RAISE NOTICE 'ROLLBACK EMPTY CM BE REV01 CHECK PASS (still verify exact ACL/index/fingerprint)';
END $cm_be_rollback_verify$;
COMMIT;
