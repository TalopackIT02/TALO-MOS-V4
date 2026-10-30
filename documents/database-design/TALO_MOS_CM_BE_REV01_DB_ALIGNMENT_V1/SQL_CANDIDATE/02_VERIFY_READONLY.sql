-- READ ONLY: verifies base + proposed migration; usable on clone after applying 01.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $cm_be_verify$
DECLARE n_table int; n_idx int; n_cols int; n_fk int;
BEGIN
 IF current_database() NOT IN ('talo_mos_v4_test') AND current_database() NOT LIKE '%clone%' THEN
  RAISE EXCEPTION 'verification only on TEST or a clearly named clone'; END IF;
 SELECT count(*) INTO n_table FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='cm' AND c.relkind='r';
 SELECT count(*) INTO n_cols FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 WHERE c.relnamespace='cm'::regnamespace AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped;
 SELECT count(*) INTO n_fk FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace
 WHERE n.nspname='cm' AND k.contype='f';
 IF n_table<>15 THEN RAISE EXCEPTION 'table count % !=15',n_table; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='cm.cm_customers'::regclass AND attname='record_status_code' AND NOT attisdropped)
 OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='cm.cm_customer_assignments'::regclass AND attname='assignment_role_code' AND NOT attisdropped)
 OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='cm.cm_customer_documents'::regclass AND attname='supersedes_document_id' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'required modified columns absent'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='cm'::regnamespace AND relname='uq_cm_customer_assignments_current') THEN
  RAISE EXCEPTION 'old single-current-assignment index still exists'; END IF;
 IF NOT has_column_privilege('talo_app','cm.cm_customers','record_status_code','INSERT')
 OR NOT has_column_privilege('talo_app','cm.cm_customer_assignments','assignment_role_code','INSERT')
 OR NOT has_column_privilege('talo_app','cm.cm_customer_documents','supersedes_document_id','INSERT') THEN
  RAISE EXCEPTION 'GRANT delta missing'; END IF;
 IF has_table_privilege('talo_app','cm.cm_customer_handovers','DELETE') THEN
  RAISE EXCEPTION 'DELETE must not be granted on handover history'; END IF;
 RAISE NOTICE 'CM BE VERIFY OK: % tables, % columns, % FK; check further workflow tests on clone', n_table,n_cols,n_fk;
END $cm_be_verify$;
ROLLBACK;
