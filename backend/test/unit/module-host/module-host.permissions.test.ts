import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/core/logging/logger.js';
import { canonicalModulePermission, createHostCapabilities, HOST_SQL } from '../../../src/module-host/capabilities.js';
import type { HostCapabilities, HostPermission } from '../../../src/module-host/contract.js';
import { isAdministrator } from '../../../src/installed-modules/SYSTEM_CONTROLLER_CENTER/backend/administrator-gate.js';
import { createModule } from '../../../src/installed-modules/SYSTEM_CONTROLLER_CENTER/backend/index.js';
import { SystemAuditService } from '../../../src/installed-modules/SYSTEM_CONTROLLER_CENTER/backend/system-audit.service.js';
import type { AccessFacts } from '../../../src/modules/foundation/foundation.permissions.js';
import type { AuditRecord, FoundationDb } from '../../../src/modules/foundation/foundation.repository.js';

const MODULE_KEY = 'SYSTEM_CONTROLLER_CENTER';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const MANAGER_ID = '00000000-0000-4000-8000-000000000002';
const STALE_AUDIT_PERMISSION: HostPermission = {
  permissionCode: 'system_controller_center.audit.read',
  moduleCode: MODULE_KEY,
  resourceCode: 'AUDIT_LOG',
  operation: 'READ',
};

function harness(enabled = true) {
  let directDeny = false;
  const requested: HostPermission[] = [];
  const audits: AuditRecord[] = [];
  const access = {
    loadAccessFacts: async (accountId: string, permission: HostPermission): Promise<AccessFacts> => {
      requested.push(permission);
      return {
        permissions: permission.permissionCode === 'system_controller_center.audit_log.read'
          ? [{ permissionId: '00000000-0000-4000-8000-000000000010', minimumAssuranceLevel: 1 }]
          : [],
        account: { accountStatus: 'ACTIVE', notDisabled: true },
        grants: directDeny && accountId === ADMIN_ID
          ? [{ source: 'DIRECT' as const, effect: 'DENY', roleActive: true, notRevoked: true, started: true, notExpired: true }]
          : [],
        systemAdminActive: accountId === ADMIN_ID,
      };
    },
    insertAudit: async (record: AuditRecord) => { audits.push(record); },
  };
  const db: FoundationDb = {
    query: async (sql) => sql === HOST_SQL.lifecycle ? [{ is_enabled: enabled, active_versions: 1 }] : [],
    execute: async () => 0,
    transaction: async (task) => task({
      execute: async () => 0,
      query: async (sql, params) => {
        if (sql === HOST_SQL.readOnlyState) return [{ read_only: 'on' }];
        if (sql.includes("r.role_code='TALO_SYSTEM_ADMIN'")) return [{ allowed: params[0] === ADMIN_ID }];
        return [];
      },
    }),
  };
  const host = createHostCapabilities(MODULE_KEY, {
    db,
    access,
    authService: { describeSession: async () => { throw new Error('unexpected session lookup'); } },
    navigation: { menu: async () => [] },
    logger: createLogger({ level: 'error' }),
    secureCookie: false,
  });
  const actor = (userAccountId: string) => ({ userAccountId, assuranceLevel: 1, requestId: `REQ-${userAccountId.slice(-1)}` });
  return { host, actor, requested, audits, deny: () => { directDeny = true; } };
}

function httpApp(h: ReturnType<typeof harness>, userAccountId: string) {
  const host: HostCapabilities = {
    ...h.host,
    session: (handler) => async (req, res) => {
      try {
        await handler(req, res, h.actor(userAccountId));
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'status' in error && 'code' in error && error instanceof Error) {
          res.status(Number(error.status)).json({ error: { code: String(error.code), message: error.message } });
          return;
        }
        throw error;
      }
    },
  };
  const app = express();
  app.use('/api', createModule(host).router);
  return app;
}

describe('module Host permission binding', () => {
  it('normalizes the immutable SCC audit binding and lets an active SYSTEM_ADMIN inherit it', async () => {
    const h = harness();
    await expect(h.host.evaluate(h.actor(ADMIN_ID), STALE_AUDIT_PERMISSION)).resolves.toEqual({ allowed: true });
    await expect(h.host.authorize(h.actor(ADMIN_ID), STALE_AUDIT_PERMISSION, 'SYSTEM_CONTROLLER_CENTER.AUDIT_LOG.READ', 'SYSTEM_AUDIT_API'))
      .resolves.toBeUndefined();
    expect(h.requested).toHaveLength(2);
    expect(h.requested.every((p) => p.permissionCode === 'system_controller_center.audit_log.read')).toBe(true);
    expect(h.audits).toEqual([]);
  });

  it('lets the valid Administrator read SCC audit logs, while the Administrator gate rejects Manager', async () => {
    const h = harness();
    await expect(isAdministrator(h.host, h.actor(ADMIN_ID))).resolves.toBe(true);
    await expect(isAdministrator(h.host, h.actor(MANAGER_ID))).resolves.toBe(false);
    await expect(new SystemAuditService(h.host).list(h.actor(ADMIN_ID), {})).resolves.toMatchObject({
      scope: 'RECORDED_AUDIT_ONLY',
      complete: true,
      sources: { FOUNDATION: { state: 'AVAILABLE' }, IAM: { state: 'AVAILABLE' } },
      events: [],
    });
  });

  it('keeps Manager denied and keeps Direct DENY stronger than inherited administration', async () => {
    const h = harness();
    await expect(h.host.evaluate(h.actor(MANAGER_ID), STALE_AUDIT_PERMISSION))
      .resolves.toEqual({ allowed: false, reason: 'NO_VALID_ALLOW' });
    await expect(h.host.authorize(h.actor(MANAGER_ID), STALE_AUDIT_PERMISSION, 'SYSTEM_CONTROLLER_CENTER.AUDIT_LOG.READ', 'SYSTEM_AUDIT_API'))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(h.audits.at(-1)?.metadata.reason).toBe('NO_VALID_ALLOW');

    h.deny();
    await expect(h.host.evaluate(h.actor(ADMIN_ID), STALE_AUDIT_PERMISSION))
      .resolves.toEqual({ allowed: false, reason: 'DIRECT_DENY' });
    await expect(h.host.authorize(h.actor(ADMIN_ID), STALE_AUDIT_PERMISSION, 'SYSTEM_CONTROLLER_CENTER.AUDIT_LOG.READ', 'SYSTEM_AUDIT_API'))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(h.audits.at(-1)?.metadata.reason).toBe('DIRECT_DENY');
  });

  it('limits the compatibility alias to the exact immutable SCC AUDIT_LOG.READ binding', () => {
    const foreign: HostPermission = { permissionCode: 'iam.audit.read', moduleCode: 'IAM', resourceCode: 'AUDIT', operation: 'READ' };
    expect(canonicalModulePermission(MODULE_KEY, foreign)).toBe(foreign);

    const unrelatedScc: HostPermission = {
      permissionCode: 'system_controller_center.diagnostic.read',
      moduleCode: MODULE_KEY,
      resourceCode: 'DIAGNOSTICS',
      operation: 'READ',
    };
    expect(canonicalModulePermission(MODULE_KEY, unrelatedScc)).toBe(unrelatedScc);

    const systemTestAudit: HostPermission = {
      permissionCode: 'system_test.audit.read',
      moduleCode: 'SYSTEM_TEST',
      resourceCode: 'AUDIT_LOG',
      operation: 'READ',
    };
    expect(canonicalModulePermission('SYSTEM_TEST', systemTestAudit)).toBe(systemTestAudit);

    const wrongTriple: HostPermission = { ...STALE_AUDIT_PERMISSION, resourceCode: 'AUDIT' };
    expect(canonicalModulePermission(MODULE_KEY, wrongTriple)).toBe(wrongTriple);
  });

  it('keeps the SCC lifecycle gate fail closed when the module is disabled', async () => {
    const h = harness(false);
    await expect(new SystemAuditService(h.host).list(h.actor(ADMIN_ID), {}))
      .rejects.toMatchObject({ status: 503, code: 'SERVICE_BUSY' });
  });

  it('enforces the complete Audit Logs HTTP chain', async () => {
    const allowed = harness();
    await request(httpApp(allowed, ADMIN_ID)).get('/api/system-controller-center/audit/logs')
      .expect(200).expect((res) => expect(res.body.logs).toMatchObject({ complete: true, events: [] }));

    await request(httpApp(harness(), MANAGER_ID)).get('/api/system-controller-center/audit/logs')
      .expect(403).expect((res) => expect(res.body.error.code).toBe('ADMIN_ROLE_REQUIRED'));

    const denied = harness();
    denied.deny();
    await request(httpApp(denied, ADMIN_ID)).get('/api/system-controller-center/audit/logs')
      .expect(403).expect((res) => expect(res.body.error.code).toBe('FORBIDDEN'));

    await request(httpApp(harness(false), ADMIN_ID)).get('/api/system-controller-center/audit/logs')
      .expect(503).expect((res) => expect(res.body.error.code).toBe('SERVICE_BUSY'));
  });
});
