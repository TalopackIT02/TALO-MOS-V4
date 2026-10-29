const fs=require('fs'),path=require('path');const [, , repo, out]=process.argv;
const {Client}=require(path.join(repo,'backend','node_modules','pg'));
const m=fs.readFileSync(path.join(repo,'.env'),'utf8').match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m);
if(new URL(m[1]).pathname.slice(1)!=='talo_mos_v4_test') throw new Error('not TEST');
(async()=>{const c=new Client({connectionString:m[1],options:'-c default_transaction_read_only=on',application_name:'cm-db-preflight-readonly'});await c.connect();
await c.query('BEGIN READ ONLY');const db=(await c.query('select current_database() d')).rows[0].d;if(db!=='talo_mos_v4_test')throw new Error('mismatch');
const r=await c.query(`SELECT n.nspname AS schema, c.relname AS tbl, (x).grantee::regrole::text AS grantee, (x).privilege_type AS priv, string_agg(a.attname, ',' ORDER BY a.attnum) AS cols
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,
 LATERAL (SELECT aclexplode(a.attacl) AS x) e
 WHERE a.attacl IS NOT NULL AND n.nspname NOT IN ('pg_catalog','information_schema') GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`);
const f=await c.query(`SELECT n.nspname AS schema, p.proname, (x).grantee AS grantee_oid, CASE WHEN (x).grantee=0 THEN 'PUBLIC' ELSE (x).grantee::regrole::text END AS grantee, (x).privilege_type FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, LATERAL (SELECT aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) x) e WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,4`);
await c.query('ROLLBACK');await c.end();fs.writeFileSync(out,JSON.stringify({col:r.rows,fn:f.rows},null,1));
for(const x of r.rows)console.log(`${x.schema}.${x.tbl} | ${x.grantee} | ${x.priv} | ${x.cols}`);console.log('## function EXECUTE');for(const x of f.rows)console.log(`${x.schema}.${x.proname} | ${x.grantee} | ${x.privilege_type}`);})().catch(e=>{console.error('FAILED',e.code||'',e.message);process.exit(1)});
