import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import {
  REISSUE_CALL, REISSUE_FUNCTION_SIGNATURE, REISSUE_PHC_BOUNDS, REISSUE_PHC_PATTERN, isAcceptableReissueHash,
} from '../../../src/modules/auth/provisioning/reissueTemporaryPassword.js';

// Static guard of the P-4e recovery proposal (database/scripts/auth-p4e-recovery). The SQL is not executed here; these
// checks keep its security properties from being weakened while it is under review, and keep client and SQL in sync.

const dir = resolve(import.meta.dirname, '../../../../database/scripts/auth-p4e-recovery');
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8');
const fn = read('03-create-function.sql');
const grants = read('02-grant-owner-test-database.sql');
const verify = read('04-verify.sql');
const rollback = read('90-rollback-test-database.sql');
const body = fn.slice(fn.indexOf('AS $fn$'), fn.indexOf('$fn$;'));
const sqlPattern = /regexp_match\(p_password_hash,\s*'([^']+)'\)/.exec(body)?.[1] ?? '';

const SALT = 'A'.repeat(22);
const HASH = 'B'.repeat(43);
const phc = (head: string, salt = SALT, hash = HASH) => `${head}$${salt}$${hash}`;

describe('P-4e recovery proposal — SECURITY DEFINER function', () => {
  it('is SECURITY DEFINER with a fixed search_path (pg_temp last) and a lock timeout', () => {
    expect(fn).toMatch(/\bSECURITY DEFINER\b/);
    expect(fn).toMatch(/SET search_path = pg_catalog, pg_temp\b/);
    expect(fn).toMatch(/SET lock_timeout = '5s'/);
  });

  it('revokes EXECUTE from PUBLIC before granting it to talo_provisioner only, in the creating transaction', () => {
    const create = fn.indexOf('CREATE FUNCTION');
    const revoke = fn.indexOf('REVOKE ALL ON FUNCTION iam.reissue_temporary_credential(text, text, uuid) FROM PUBLIC');
    const grant = fn.indexOf('GRANT EXECUTE ON FUNCTION iam.reissue_temporary_credential(text, text, uuid) TO talo_provisioner;');
    expect(create).toBeGreaterThan(fn.indexOf('BEGIN;'));
    expect(revoke).toBeGreaterThan(create);
    expect(grant).toBeGreaterThan(revoke);
    expect(fn.lastIndexOf('COMMIT;')).toBeGreaterThan(grant);
    expect(fn.match(/GRANT EXECUTE/g)).toHaveLength(1);
    expect(fn).toMatch(/OWNER TO talo_credential_recovery/);
  });

  it('never gives talo_provisioner a table privilege; every 02 grant targets the NOLOGIN owner; 02 requires a fresh owner', () => {
    for (const name of ['01-create-owner-role.sql', '02-grant-owner-test-database.sql', '03-create-function.sql']) {
      expect(read(name)).not.toMatch(/GRANT[^;]*\bON\s+(TABLE\s+)?iam\.\w+[^;]*\bTO\s+talo_provisioner/i);
    }
    const targets = [...grants.matchAll(/^GRANT [^;]*\bTO\s+(\w+);/gm)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(5);
    expect(new Set(targets)).toEqual(new Set(['talo_credential_recovery']));
    expect(read('01-create-owner-role.sql')).toMatch(/NOLOGIN/);
    expect(grants).toMatch(/Fresh-owner guard/);
  });

  it('schema-qualifies every IAM table and every built-in function used in the body', () => {
    const unqualified = body.match(/(?<!iam\.)\biam_(user_accounts|memberships|credentials|sessions|audit_logs|user_roles|user_permissions)\b/g);
    expect(unqualified).toBeNull();
    for (const call of ['statement_timestamp', 'lower', 'btrim', 'length', 'jsonb_build_object', 'host', 'inet_client_addr', 'regexp_match']) {
      expect(body.match(new RegExp(`(?<!pg_catalog\\.)\\b${call}\\(`, 'g')), call).toBeNull();
    }
  });

  it('race control: the target row is locked FOR UPDATE (blocks FK KEY SHARE of new role/permission/session rows) before any re-check or write', () => {
    expect(body).toMatch(/FOR UPDATE OF a;/);
    expect(body).not.toMatch(/FOR NO KEY UPDATE/);
    const lock = body.indexOf('FOR UPDATE OF a');
    const order = ['FROM iam.iam_memberships AS m WHERE m.membership_id = v_target_member', 'iam.iam_user_roles', 'iam.iam_user_permissions',
      'UPDATE iam.iam_credentials', 'UPDATE iam.iam_sessions', 'INSERT INTO iam.iam_audit_logs'].map((s) => body.indexOf(s));
    expect(order.every((position) => position > lock)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toMatch(/updated_at = GREATEST\(pg_catalog\.statement_timestamp\(\), c\.updated_at \+ interval '1 microsecond'\)/);
  });

  it('identity model: no claimed operator — actor NULL, principal = session_user; nothing secret in the audit', () => {
    expect(fn).not.toMatch(/p_operator|operator_account/i); // no operator parameter or column
    expect(body).toMatch(/session_user <> 'talo_provisioner'/);
    const audit = body.slice(body.indexOf('INSERT INTO iam.iam_audit_logs'), body.indexOf('reissued_account_id :='));
    expect(audit).toMatch(/VALUES \(NULL, v_target_member/);
    expect(audit).toMatch(/'talo-provision-cli; principal=' \|\| session_user/);
    expect(audit).not.toMatch(/p_password_hash/);
    expect(audit).toMatch(/'CREDENTIAL_REISSUED'/);
  });

  it('client and SQL share the same PHC rule (pattern and bounds) and the same call', () => {
    expect(sqlPattern).toBe(REISSUE_PHC_PATTERN);
    expect(body).toContain(`v_phc[1]::integer NOT BETWEEN ${REISSUE_PHC_BOUNDS.m[0]} AND ${REISSUE_PHC_BOUNDS.m[1]}`);
    expect(body).toContain(`v_phc[2]::integer NOT BETWEEN ${REISSUE_PHC_BOUNDS.t[0]} AND ${REISSUE_PHC_BOUNDS.t[1]}`);
    expect(body).toContain(`v_phc[3]::integer NOT BETWEEN ${REISSUE_PHC_BOUNDS.p[0]} AND ${REISSUE_PHC_BOUNDS.p[1]}`);
    expect(body).toContain(`pg_catalog.length(p_password_hash) > ${REISSUE_PHC_BOUNDS.maxLength}`);
    // size limits are enforced (and raise) before the regular expression is evaluated
    const sizeCheck = body.indexOf(`pg_catalog.length(p_password_hash) > ${REISSUE_PHC_BOUNDS.maxLength}`);
    const firstRaise = body.indexOf('RAISE EXCEPTION', sizeCheck);
    expect(sizeCheck).toBeGreaterThan(0);
    expect(firstRaise).toBeLessThan(body.indexOf('pg_catalog.regexp_match('));
    expect(body).toContain('pg_catalog.length(p_username) > 200');
    expect(REISSUE_CALL).toContain('iam.reissue_temporary_credential($1, $2, $3::uuid)');
    expect(fn).toContain('reissued_account_id uuid, revoked_sessions integer');
    expect(REISSUE_FUNCTION_SIGNATURE).toBe('iam.reissue_temporary_credential(text,text,uuid)');
  });

  it('PHC rule accepts real local Argon2id hashes and rejects malformed or weak ones', async () => {
    const hasher = new PasswordHasher();
    const real = await hasher.hashPassword('example temporary password');
    expect(isAcceptableReissueHash(real)).toBe(true);
    expect(new RegExp(sqlPattern).test(real)).toBe(true);
    const rejected: [string, string][] = [
      ['empty', ''],
      ['plaintext', 'Xy7!correct-horse-battery'],
      ['argon2i', phc('$argon2i$v=19$m=19456,t=2,p=1')],
      ['argon2d', phc('$argon2d$v=19$m=19456,t=2,p=1')],
      ['old version', phc('$argon2id$v=16$m=19456,t=2,p=1')],
      ['memory below baseline', phc('$argon2id$v=19$m=4096,t=2,p=1')],
      ['memory too large', phc('$argon2id$v=19$m=2097152,t=2,p=1')],
      ['t = 1', phc('$argon2id$v=19$m=19456,t=1,p=1')],
      ['t too large', phc('$argon2id$v=19$m=19456,t=11,p=1')],
      ['p = 0', phc('$argon2id$v=19$m=19456,t=2,p=0')],
      ['p too large', phc('$argon2id$v=19$m=19456,t=2,p=17')],
      ['param order', phc('$argon2id$v=19$t=2,m=19456,p=1')],
      ['short salt', phc('$argon2id$v=19$m=19456,t=2,p=1', 'A'.repeat(21))],
      ['short hash', phc('$argon2id$v=19$m=19456,t=2,p=1', SALT, 'B'.repeat(42))],
      ['long hash', phc('$argon2id$v=19$m=19456,t=2,p=1', SALT, 'B'.repeat(44))],
      ['padding', phc('$argon2id$v=19$m=19456,t=2,p=1', `${'A'.repeat(20)}==`)],
      ['url-safe alphabet', phc('$argon2id$v=19$m=19456,t=2,p=1', `${'A'.repeat(21)}-`)],
      ['extra field', `${phc('$argon2id$v=19$m=19456,t=2,p=1')}$x`],
      ['keyid / data params', phc('$argon2id$v=19$m=19456,t=2,p=1,keyid=abc')],
      ['leading space', ` ${phc('$argon2id$v=19$m=19456,t=2,p=1')}`],
      ['trailing newline', `${phc('$argon2id$v=19$m=19456,t=2,p=1')}\n`],
      ['embedded NUL', phc('$argon2id$v=19$m=19456,t=2,p=1').replace('A', '\u0000')],
    ];
    for (const [name, value] of rejected) {
      expect(isAcceptableReissueHash(value), name).toBe(false);
    }
  });
});

describe('P-4e recovery proposal — verify and rollback scripts', () => {
  it('04-verify asserts memberships, EXECUTE holders, other SECURITY DEFINER functions, owned objects and the exact privilege matrix', () => {
    for (const marker of ['pg_auth_members', 'unexpected EXECUTE holder', 'another SECURITY DEFINER function', 'pg_default_acl',
      'has_any_column_privilege', 'has_column_privilege', 'P-4e verify FAILED', 'default_transaction_read_only = on']) {
      expect(verify, marker).toContain(marker);
    }
  });

  it('90-rollback revokes exactly the privileges of 02 (no REVOKE ALL), guards ownership and never drops the role', () => {
    expect(rollback).not.toMatch(/^\s*REVOKE ALL/im); // statements only, comments may mention it
    expect(rollback).not.toMatch(/^\s*DROP ROLE/im);
    const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
    const granted = [...grants.matchAll(/^GRANT ([^;]*) TO talo_credential_recovery;/gm)].map((m) => normalise(m[1] ?? ''));
    const revoked = [...rollback.matchAll(/^REVOKE ([^;]*) FROM talo_credential_recovery;/gm)].map((m) => normalise(m[1] ?? ''));
    expect(new Set(revoked)).toEqual(new Set(granted));
    expect(rollback).toMatch(/is not the P-4e function/);
    expect(rollback).toMatch(/outside the P-4e proposal/);
    expect(rollback).toMatch(/talo_provisioner baseline privileges changed/);
  });
});
