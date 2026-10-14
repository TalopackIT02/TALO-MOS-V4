-- TALO-MOS-V4 · P-4e recovery · 04 — read-only verification (test database). Expected values in comments.
-- STATUS: PROPOSAL FOR REVIEW — run after 01-03 were approved and executed.

\set ON_ERROR_STOP on
SET default_transaction_read_only = on;

-- Function properties: SECURITY DEFINER, fixed search_path + lock_timeout, owner = talo_credential_recovery.
SELECT p.oid::regprocedure AS function, p.prosecdef AS security_definer,            -- t
       pg_get_userbyid(p.proowner) AS owner,                                        -- talo_credential_recovery
       p.proconfig                                                                  -- {"search_path=pg_catalog, pg_temp","lock_timeout=5s"}
  FROM pg_proc p WHERE p.oid = 'iam.reissue_temporary_credential(text,text,uuid,uuid)'::regprocedure;

-- EXECUTE: talo_provisioner only (no PUBLIC entry in the ACL).
SELECT has_function_privilege('talo_provisioner', 'iam.reissue_temporary_credential(text,text,uuid,uuid)', 'EXECUTE') AS provisioner, -- t
       has_function_privilege('talo_app', 'iam.reissue_temporary_credential(text,text,uuid,uuid)', 'EXECUTE') AS app,                 -- f
       has_function_privilege('talo_test_harness', 'iam.reissue_temporary_credential(text,text,uuid,uuid)', 'EXECUTE') AS harness,    -- f
       (SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
         WHERE p.oid = 'iam.reissue_temporary_credential(text,text,uuid,uuid)'::regprocedure AND a.grantee = 0) AS public_grants;      -- 0

-- talo_provisioner gained NO direct table privilege (all f).
SELECT has_table_privilege('talo_provisioner', 'iam.iam_credentials', 'UPDATE') AS cred_update,
       has_column_privilege('talo_provisioner', 'iam.iam_credentials', 'password_hash', 'UPDATE') AS hash_update,
       has_table_privilege('talo_provisioner', 'iam.iam_sessions', 'UPDATE') AS sessions_update,
       has_table_privilege('talo_provisioner', 'iam.iam_sessions', 'SELECT') AS sessions_select,
       has_table_privilege('talo_provisioner', 'iam.iam_user_accounts', 'UPDATE') AS accounts_update;

-- Owner cannot log in and holds no membership.
SELECT rolcanlogin, rolsuper, rolinherit,                                            -- f f f
       (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid OR m.roleid = r.oid) AS memberships   -- 0
  FROM pg_roles r WHERE rolname = 'talo_credential_recovery';
