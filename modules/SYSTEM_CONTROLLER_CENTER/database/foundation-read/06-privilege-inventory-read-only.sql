-- TALO-MOS-V4 · SCC 0.1.2 Foundation controlled read · 06 — privilege inventory (admin, READ ONLY)
-- Run before 01 and after 03 (and after 90/91); the diff must equal the approved delta in the gate pack.
SET default_transaction_read_only = on;
\pset tuples_only on
\pset footer off
SELECT 'role '||rolname||' login='||rolcanlogin||' inherit='||rolinherit||' super='||rolsuper||' createrole='||rolcreaterole||' createdb='||rolcreatedb||' bypassrls='||rolbypassrls
  FROM pg_roles WHERE rolname LIKE 'talo%' OR rolname = 'admin' ORDER BY rolname;
SELECT 'member '||pg_get_userbyid(roleid)||' <- '||pg_get_userbyid(member) FROM pg_auth_members
 WHERE pg_get_userbyid(roleid) LIKE 'talo%' OR pg_get_userbyid(member) LIKE 'talo%' ORDER BY 1;
SELECT 'schema '||nspname||' owner='||pg_get_userbyid(nspowner)||' '||coalesce(nspacl::text,'{}') FROM pg_namespace
 WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname;
SELECT 'rel '||n.nspname||'.'||c.relname||' owner='||pg_get_userbyid(c.relowner)||' '||coalesce(c.relacl::text,'{}')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('foundation','iam') AND c.relkind IN ('r','p','v','m') ORDER BY 1;
SELECT 'col '||n.nspname||'.'||c.relname||'.'||a.attname||' '||a.attacl::text
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('foundation','iam') AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL ORDER BY 1;
SELECT 'func '||p.oid::regprocedure::text||' owner='||pg_get_userbyid(p.proowner)||' secdef='||p.prosecdef||' cfg='||coalesce(array_to_string(p.proconfig,','),'')||' '||coalesce(p.proacl::text,'{default}')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('audit_api','foundation_read_api') ORDER BY 1;
