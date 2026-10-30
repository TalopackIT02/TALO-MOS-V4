-- CM Backend REV01 preflight: metadata-only, no data rows returned.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT current_database() AS database_name, current_user AS db_user,
       current_setting('server_version') AS postgres_version;
SELECT n.nspname AS schema_name, pg_get_userbyid(n.nspowner) AS owner
FROM pg_namespace n WHERE n.nspname IN ('cm','foundation','iam') ORDER BY 1;
SELECT c.relname AS cm_table, count(a.attnum) FILTER (WHERE a.attnum>0 AND NOT a.attisdropped) AS columns
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attribute a ON a.attrelid=c.oid
WHERE n.nspname='cm' AND c.relkind='r'
GROUP BY c.relname ORDER BY 1;
SELECT c.relname AS index_name, t.relname AS table_name,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
JOIN pg_class t ON t.oid=i.indrelid
WHERE t.relnamespace='cm'::regnamespace ORDER BY 1;
SELECT c.relname AS table_name, k.conname AS constraint_name, k.contype,
       pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
WHERE c.relnamespace='cm'::regnamespace ORDER BY 1,2;
SELECT c.relname AS table_name, a.attname AS column_name, a.attacl::text AS column_acl
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
WHERE c.relnamespace='cm'::regnamespace AND a.attnum>0 AND NOT a.attisdropped
  AND a.attacl IS NOT NULL ORDER BY 1,2;
SELECT relname AS sequence_name, pg_get_userbyid(relowner) AS owner
FROM pg_class WHERE relnamespace='cm'::regnamespace AND relkind='S';
ROLLBACK;
