// CM-DB-PREFLIGHT-001 — read-only PostgreSQL catalog metadata. No business rows are read.
// Usage: node cm_preflight_meta.cjs <repoRoot> <outFile>
const fs = require('fs');
const path = require('path');
const [, , repoRoot, outFile] = process.argv;
const { Client } = require(path.join(repoRoot, 'backend', 'node_modules', 'pg'));

const env = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
const m = env.match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m);
if (!m) throw new Error('DATABASE_URL not found');
const url = new URL(m[1]);
if (url.pathname.slice(1) !== 'talo_mos_v4_test') throw new Error('Refusing: target is not talo_mos_v4_test');

const SYS = "('pg_catalog','information_schema','pg_toast')";
const Q = {
  Q01: `SELECT current_database() AS db_name, current_user AS role, current_schema() AS active_schema,
        current_setting('server_version') AS server_version, current_setting('search_path') AS search_path,
        current_setting('transaction_read_only') AS tx_read_only, current_setting('default_transaction_read_only') AS default_ro`,
  Q02: `SELECT n.nspname AS schema_name, r.rolname AS owner, n.nspacl::text AS acl
        FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1`,
  Q03: `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind, r.rolname AS owner
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
        WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ${SYS} ORDER BY 1,2`,
  Q04: `SELECT n.nspname AS schema, c.relname AS tbl, a.attnum AS pos, a.attname AS col,
        pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, NOT a.attnotnull AS nullable,
        pg_get_expr(d.adbin,d.adrelid) AS dflt
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT IN ${SYS}
        ORDER BY 1,2,3`,
  Q05: `SELECT n.nspname AS schema, c.relname AS tbl, con.conname AS name, con.contype AS type,
        pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ${SYS} ORDER BY 1,2,3`,
  Q06: `SELECT schemaname AS schema, tablename AS tbl, indexname AS name, indexdef AS def
        FROM pg_indexes WHERE schemaname NOT IN ${SYS} ORDER BY 1,2,3`,
  Q07: `SELECT extname, extversion, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1`,
  Q08: `SELECT n.nspname AS schema, c.relname AS tbl, c.relacl::text AS acl,
        has_table_privilege(current_user,c.oid,'SELECT') AS app_select
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p','v','m') AND n.nspname NOT IN ${SYS} ORDER BY 1,2`,
  Q09: `SELECT n.nspname AS schema, has_schema_privilege(current_user,n.oid,'USAGE') AS usage,
        has_schema_privilege(current_user,n.oid,'CREATE') AS create
        FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1`,
  Q10: `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit, rolbypassrls
        FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ORDER BY 1`,
  Q11: `SELECT r.rolname AS member, g.rolname AS member_of FROM pg_auth_members am
        JOIN pg_roles r ON r.oid=am.member JOIN pg_roles g ON g.oid=am.roleid
        WHERE r.rolname NOT LIKE 'pg\\_%' ORDER BY 1,2`,
  Q12: `SELECT d.datname, has_database_privilege(current_user,d.oid,'CREATE') AS app_create_schema,
        has_database_privilege(current_user,d.oid,'TEMP') AS app_temp, d.datacl::text AS acl
        FROM pg_database d WHERE d.datname=current_database()`,
  Q13: `SELECT r.rolname AS grantor_role, n.nspname AS schema, d.defaclobjtype AS objtype, d.defaclacl::text AS acl
        FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 1,2`,
  Q14: `SELECT n.nspname AS schema, c.relname AS name, c.relkind
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ${SYS} AND c.relkind IN ('r','p','v','m','S')
          AND c.relname ~* '(cust|crm|client|partner|country|countr|admin_unit|province|district|ward|region|bank|currenc|industr|ref_|lookup|catalog|master|contact|address|payment|tax|document|attach|file)'
        ORDER BY 1,2`,
  Q15: `SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
        r.rolname AS owner, p.prosecdef AS security_definer
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
        WHERE n.nspname NOT IN ${SYS} ORDER BY 1,2`,
  Q16: `SELECT event_object_schema AS schema, event_object_table AS tbl, trigger_name FROM information_schema.triggers ORDER BY 1,2,3`,
  Q17: `SELECT n.nspname AS schema, t.typname, t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname NOT IN ${SYS} AND t.typtype IN ('e','d') ORDER BY 1,2`,
  Q18: `SELECT n.nspname AS schema, c.relname AS seq FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='S' AND n.nspname NOT IN ${SYS} ORDER BY 1,2`,
  Q19: `SELECT name, setting FROM pg_settings WHERE name IN ('server_version_num','TimeZone','default_transaction_isolation','statement_timeout','lc_collate','server_encoding')`,
};

(async () => {
  const client = new Client({ connectionString: m[1], options: '-c default_transaction_read_only=on', application_name: 'cm-db-preflight-readonly' });
  await client.connect();
  const out = { ranAt: new Date().toISOString(), results: {} };
  try {
    await client.query('BEGIN READ ONLY');
    const ctx = await client.query(Q.Q01);
    if (ctx.rows[0].db_name !== 'talo_mos_v4_test') throw new Error('Refusing: current_database mismatch');
    for (const [id, sql] of Object.entries(Q)) {
      try { const r = await client.query(sql); out.results[id] = r.rows; }
      catch (e) { out.results[id] = { error: e.code + ' ' + e.message }; }
    }
    await client.query('ROLLBACK');
  } finally { await client.end(); }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  for (const [id, rows] of Object.entries(out.results)) console.log(id, Array.isArray(rows) ? rows.length + ' rows' : JSON.stringify(rows));
})().catch((e) => { console.error('FAILED', e.code || '', e.message); process.exit(1); });
