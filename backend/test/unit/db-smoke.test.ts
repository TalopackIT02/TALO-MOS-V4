import { describe, expect, it } from 'vitest';
import { checkSmokeUrl, isNotReadyError, isPermissionDenied, runDbSmoke } from '../smoke/dbSmoke.js';

describe('DB smoke test guards (no database needed)', () => {
  it('reports NOT_READY when DATABASE_URL is missing, without connecting', async () => {
    const report = await runDbSmoke(undefined);
    expect(report.status).toBe('NOT_READY');
    expect(report.checks).toEqual([]);
  });

  it('refuses admin or any role other than talo_app, and any database other than the test database', () => {
    expect(checkSmokeUrl('postgresql://admin:x@127.0.0.1:5433/talo_mos_v4_test')).toMatchObject({ ok: false });
    expect(checkSmokeUrl('postgresql://talo_app:x@127.0.0.1:5433/talo_mos_v4_dev')).toMatchObject({ ok: false });
    expect(checkSmokeUrl('postgresql://talo_app:x@127.0.0.1:5433/talo_mos_v4_test')).toMatchObject({ ok: true, target: 'talo_app@127.0.0.1:5433/talo_mos_v4_test' });
  });

  it('never exposes the password in the reported target', () => {
    const check = checkSmokeUrl('postgresql://admin:Sup3rSecret@127.0.0.1:5433/talo_mos_v4_test');
    expect(JSON.stringify(check)).not.toContain('Sup3rSecret');
  });

  it('reports FAIL (not NOT_READY) for a wrongly configured role, without connecting', async () => {
    const report = await runDbSmoke('postgresql://admin:x@127.0.0.1:5433/talo_mos_v4_test');
    expect(report.status).toBe('FAIL');
    expect(report.checks).toEqual([]);
  });

  it('reports NOT_READY when the server is unreachable', async () => {
    const report = await runDbSmoke('postgresql://talo_app:x@127.0.0.1:1/talo_mos_v4_test');
    expect(report.status).toBe('NOT_READY');
  });

  it('classifies PostgreSQL error codes', () => {
    expect(isNotReadyError({ cause: { originalCode: '3D000' } })).toBe(true);
    expect(isNotReadyError({ meta: { driverAdapterError: { cause: { kind: 'DatabaseNotReachable' } } } })).toBe(true);
    expect(isNotReadyError({ meta: { driverAdapterError: { cause: { kind: 'AuthenticationFailed' } } } })).toBe(true);
    expect(isNotReadyError({ meta: { driverAdapterError: { cause: { kind: 'postgres', code: '42501' } } } })).toBe(false);
    expect(isNotReadyError({ meta: { code: '28P01' } })).toBe(true);
    expect(isPermissionDenied({ cause: { originalCode: '42501' } })).toBe(true);
    expect(isPermissionDenied(new Error('permission denied for table iam_roles'))).toBe(true);
    expect(isPermissionDenied(new Error('relation does not exist'))).toBe(false);
  });
});
