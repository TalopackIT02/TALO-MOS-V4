import { describe, expect, it } from 'vitest';
import { createIamCatalog } from '../../../src/modules/foundation/foundation.installer.iam.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';

describe('Installer IAM policy evidence', () => {
  it('counts valid static ALLOW policy and eligible dynamic TALO_SYSTEM_ADMIN without mutating IAM', async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const db: FoundationDb = {
      async query(sql, params) {
        calls.push({ sql, params });
        return [{ n: '2' }];
      },
      async execute() { throw new Error('unexpected mutation'); },
      async transaction<R>(_fn: (tx: SqlExecutor) => Promise<R>): Promise<R> { throw new Error('unexpected transaction'); },
    };

    expect(await createIamCatalog(db, null).assignments('SYSTEM_CONTROLLER_CENTER')).toBe(2);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call).toBeDefined();
    if (call === undefined) throw new Error('query was not recorded');
    const { sql, params } = call;
    expect(params).toEqual(['SYSTEM_CONTROLLER_CENTER']);
    expect(sql).toContain("r.role_code = 'TALO_SYSTEM_ADMIN'");
    expect(sql).toContain('role_grant.is_active = TRUE');
    expect(sql).toContain('role_user.revoked_at IS NULL');
    expect(sql).toContain("role_account.account_status = 'ACTIVE'");
    expect(sql).toContain("a.account_status = 'ACTIVE'");
    expect(sql).toContain('a.disabled_at IS NULL');
    expect(sql).toContain('r.is_active = TRUE');
    expect(sql).toContain('ur.revoked_at IS NULL');
    expect(sql).toContain('ur.assigned_at <= statement_timestamp()');
    expect(sql).toContain("up.effect = 'ALLOW'");
    expect(sql).toContain('up.expires_at IS NULL OR up.expires_at > statement_timestamp()');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i);
  });
});
