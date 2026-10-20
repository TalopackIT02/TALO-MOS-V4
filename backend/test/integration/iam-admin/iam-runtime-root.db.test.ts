import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// Runtime check of the RUNNING backend (http://127.0.0.1:3000, development): IAM_ROOT_ADMIN_ACCOUNT_ID is applied — the real
// root administrator is reported isRoot = true, any other account false — and P-4e reports its state. READ-ONLY on the
// root: a fixture administrator holding only iam.accounts.read signs in and reads; nothing is changed on `admin`.
// TALO_IAM_RUNTIME_CHECK=1 (+ TALO_RUNTIME_URL, TALO_RUNTIME_ORIGIN to override). Fixtures removed by UUID.

const enabled = process.env['TALO_IAM_RUNTIME_CHECK'] === '1';
const BASE = process.env['TALO_RUNTIME_URL'] ?? 'http://127.0.0.1:3000';
const ORIGIN = process.env['TALO_RUNTIME_ORIGIN'] ?? 'http://127.0.0.1:5173';
const ROOT = '0e7b0190-0173-4bc2-8e35-816730a4002b';
const NIL = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!enabled)('IAM runtime — root administrator configured on the running backend', { timeout: 120_000 }, () => {
  let h: PsqlSession;
  let fx: AuthFixtures;
  const tag = `FBET-${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const roles: string[] = [];

  beforeAll(async () => {
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, new PasswordHasher());
    await fx.assertNoLeftovers();
  });

  afterAll(async () => {
    if (!h) return;
    await h.ok('BEGIN');
    await h.ok(`DELETE FROM iam.iam_user_roles WHERE user_account_id = ANY(${uuidArray(fx.accounts.length ? fx.accounts : [NIL])})`);
    await h.ok(`DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${uuidArray(roles.length ? roles : [NIL])})`);
    await h.ok(`DELETE FROM iam.iam_roles WHERE role_id = ANY(${uuidArray(roles.length ? roles : [NIL])}) AND role_code LIKE ${lit(`${tag}-%`)}`);
    await h.ok('COMMIT');
    await fx.cleanup();
    const remaining = await fx.remaining();
    await h.close();
    expect(remaining).toBe(0);
  });

  it('isRoot = true only for 0e7b0190-… on the running server; P-4e state reported', async () => {
    const reader = await fx.create();
    const roleId = randomUUID();
    roles.push(roleId);
    const [perm] = await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE permission_code = 'iam.accounts.read'`);
    await h.ok('BEGIN');
    await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(roleId)}, ${lit(`${tag}-RT`)}, 'FBET runtime reader', true, false)`);
    await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roleId)}, ${lit(perm?.[0] ?? NIL)})`);
    await h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(randomUUID())}, ${lit(reader.accountId)}, ${lit(roleId)})`);
    await h.ok('COMMIT');
    const headers = { 'User-Agent': fx.userAgent, Origin: ORIGIN, 'Content-Type': 'application/json' };
    const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username: reader.username, password: reader.password }) });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const get = async (path: string) => {
      const r = await fetch(`${BASE}/api${path}`, { headers: { 'User-Agent': fx.userAgent, Cookie: cookie } });
      return { status: r.status, body: JSON.parse(await r.text()) };
    };
    const root = await get(`/iam/admin/accounts/${ROOT}`);
    expect([root.status, root.body.account.username, root.body.account.isRoot]).toEqual([200, 'admin', true]);
    const self = await get(`/iam/admin/accounts/${reader.accountId}`);
    expect(self.body.account.isRoot).toBe(false);
    const caps = await get('/iam/admin/me/capabilities');
    expect(caps.body.permissions['iam.accounts.read']).toBe(true);
    expect(caps.body.permissions['iam.accounts.manage']).toBe(false); // READ does not imply MANAGE
    console.log(`[iam-runtime-root] root isRoot=${String(root.body.account.isRoot)} other isRoot=${String(self.body.account.isRoot)} temporaryCredentials=${String(caps.body.features.temporaryCredentials)}`);
  });
});
