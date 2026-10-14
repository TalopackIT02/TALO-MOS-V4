import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REISSUE_CALL, REISSUE_FUNCTION_SIGNATURE } from '../../../src/modules/auth/provisioning/reissueTemporaryPassword.js';

// Static guard of the P-4e recovery proposal (database/scripts/auth-p4e-recovery). The SQL is not executed here; these
// checks keep the security properties from being weakened while it is under review.

const dir = resolve(import.meta.dirname, '../../../../database/scripts/auth-p4e-recovery');
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8');
const fn = read('03-create-function.sql');
const grants = read('02-grant-owner-test-database.sql');
const body = fn.slice(fn.indexOf('AS $fn$'), fn.indexOf('$fn$;'));

describe('P-4e recovery proposal — SECURITY DEFINER function', () => {
  it('is SECURITY DEFINER with a fixed search_path (pg_temp last) and a lock timeout', () => {
    expect(fn).toMatch(/\bSECURITY DEFINER\b/);
    expect(fn).toMatch(/SET search_path = pg_catalog, pg_temp\b/);
    expect(fn).toMatch(/SET lock_timeout = '5s'/);
  });

  it('revokes EXECUTE from PUBLIC before granting it to talo_provisioner only, in the creating transaction', () => {
    const create = fn.indexOf('CREATE FUNCTION');
    const revoke = fn.indexOf('REVOKE ALL ON FUNCTION iam.reissue_temporary_credential(text, text, uuid, uuid) FROM PUBLIC');
    const grant = fn.indexOf('GRANT EXECUTE ON FUNCTION iam.reissue_temporary_credential(text, text, uuid, uuid) TO talo_provisioner;');
    const commit = fn.lastIndexOf('COMMIT;');
    expect(create).toBeGreaterThan(fn.indexOf('BEGIN;'));
    expect(revoke).toBeGreaterThan(create);
    expect(grant).toBeGreaterThan(revoke);
    expect(commit).toBeGreaterThan(grant);
    expect(fn.match(/GRANT EXECUTE/g)).toHaveLength(1);
    expect(fn).toMatch(/OWNER TO talo_credential_recovery/);
  });

  it('never gives talo_provisioner a direct UPDATE (or any table privilege) anywhere in the proposal', () => {
    for (const name of ['01-create-owner-role.sql', '02-grant-owner-test-database.sql', '03-create-function.sql']) {
      expect(read(name)).not.toMatch(/GRANT[^;]*\bON\s+(TABLE\s+)?iam\.\w+[^;]*\bTO\s+talo_provisioner/i);
    }
    const grantTargets = [...grants.matchAll(/^GRANT [^;]*\bTO\s+(\w+);/gm)].map((m) => m[1]);
    expect(grantTargets.length).toBeGreaterThan(5);
    expect(new Set(grantTargets)).toEqual(new Set(['talo_credential_recovery']));
    expect(read('01-create-owner-role.sql')).toMatch(/NOLOGIN/);
  });

  it('schema-qualifies every IAM table and every built-in function used in the body', () => {
    const unqualifiedTables = body.match(/(?<!iam\.)\biam_(user_accounts|memberships|credentials|sessions|audit_logs|user_roles|user_permissions)\b/g);
    expect(unqualifiedTables).toBeNull();
    for (const call of ['statement_timestamp', 'lower', 'btrim', 'length', 'jsonb_build_object', 'host', 'inet_client_addr']) {
      expect(body.match(new RegExp(`(?<!pg_catalog\\.)\\b${call}\\(`, 'g')), call).toBeNull();
    }
  });

  it('follows the writer protocol: target row lock before the credential write, sessions revoked, then audit', () => {
    const lock = body.indexOf('FOR NO KEY UPDATE OF a');
    const recheck = body.indexOf('FROM iam.iam_memberships AS m WHERE m.membership_id = v_target_member');
    const credential = body.indexOf('UPDATE iam.iam_credentials');
    const sessions = body.indexOf('UPDATE iam.iam_sessions');
    const audit = body.indexOf('INSERT INTO iam.iam_audit_logs');
    expect(lock).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(lock);
    expect(credential).toBeGreaterThan(recheck);
    expect(sessions).toBeGreaterThan(credential);
    expect(audit).toBeGreaterThan(sessions);
    expect(body).toMatch(/updated_at = GREATEST\(pg_catalog\.statement_timestamp\(\), c\.updated_at \+ interval '1 microsecond'\)/);
  });

  it('controls caller, operator, target and keeps the hash / plaintext out of the audit', () => {
    expect(body).toMatch(/session_user <> 'talo_provisioner'/);
    expect(body).toMatch(/v_target_id = p_operator_account_id/);
    expect(body).toMatch(/iam\.iam_user_roles/);
    expect(body).toMatch(/\^\\\$argon2id\\\$v=19/);
    const auditStatement = body.slice(body.indexOf('INSERT INTO iam.iam_audit_logs'), body.indexOf('reissued_account_id :='));
    expect(auditStatement).not.toMatch(/p_password_hash/);
    expect(auditStatement).toMatch(/'CREDENTIAL_REISSUED'/);
  });

  it('matches the client call', () => {
    expect(REISSUE_CALL).toContain('iam.reissue_temporary_credential($1, $2, $3::uuid, $4::uuid)');
    expect(fn).toContain('reissued_account_id uuid, revoked_sessions integer');
    expect(REISSUE_FUNCTION_SIGNATURE).toBe('iam.reissue_temporary_credential(text,text,uuid,uuid)');
  });
});
