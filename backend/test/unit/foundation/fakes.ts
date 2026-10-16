import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express } from 'express';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import type { ClientInfo } from '../../../src/modules/auth/audit.js';
import { AuthError } from '../../../src/modules/auth/auth.service.js';
import type { SessionBody } from '../../../src/modules/auth/auth.service.js';
import { FOUNDATION_SQL, SqlFoundationRepository } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';
import { foundationRouter } from '../../../src/modules/foundation/foundation.routes.js';
import { FoundationService } from '../../../src/modules/foundation/foundation.service.js';
import { healthRouter } from '../../../src/modules/health/health.routes.js';

// In-memory doubles for FBE-01A (no PostgreSQL). FakeDb answers the exact FOUNDATION_SQL statements and implements a
// transaction mock: writes inside transaction() go to a staged copy that becomes visible only on commit.

export const TEST_ORIGIN = 'http://127.0.0.1:5173';

export const PERM_READ_ID = '10000000-0000-4000-8000-000000000001';
export const PERM_CREATE_ID = '10000000-0000-4000-8000-000000000002';
export const ACCOUNT_A = '20000000-0000-4000-8000-00000000000a';

export function token(seed: string): string {
  return seed.padEnd(43, '0').slice(0, 43);
}

export interface PermissionFixture {
  permission_id: string; permission_code: string; module_code: string; resource_code: string; operation: string; minimum_assurance_level: number;
}

export interface GrantRow {
  source: 'ROLE' | 'DIRECT'; effect: string; role_active: boolean; not_revoked: boolean; started: boolean; not_expired: boolean;
}

export interface IamFixture {
  permissions: PermissionFixture[];
  accounts: Map<string, { account_status: string; not_disabled: boolean }>;
  grants: { accountId: string; permissionId: string; row: GrantRow }[];
}

export const VALID_ROLE: GrantRow = { source: 'ROLE', effect: 'ALLOW', role_active: true, not_revoked: true, started: true, not_expired: true };
export const VALID_DIRECT_ALLOW: GrantRow = { source: 'DIRECT', effect: 'ALLOW', role_active: true, not_revoked: true, started: true, not_expired: true };
export const VALID_DIRECT_DENY: GrantRow = { source: 'DIRECT', effect: 'DENY', role_active: true, not_revoked: true, started: true, not_expired: true };

export function defaultIam(): IamFixture {
  return {
    permissions: [
      { permission_id: PERM_READ_ID, permission_code: 'foundation.module_registry.read', module_code: 'FOUNDATION', resource_code: 'MODULE_REGISTRY', operation: 'READ', minimum_assurance_level: 1 },
      { permission_id: PERM_CREATE_ID, permission_code: 'foundation.module_registry.create', module_code: 'FOUNDATION', resource_code: 'MODULE_REGISTRY', operation: 'CREATE', minimum_assurance_level: 1 },
    ],
    accounts: new Map([[ACCOUNT_A, { account_status: 'ACTIVE', not_disabled: true }]]),
    grants: [],
  };
}

export interface ModuleRow {
  module_id: string; module_key: string; module_name: string; description: string | null; module_type: string; is_enabled: boolean;
  created_at: string; updated_at: string; created_by_account_id: string | null;
}

export interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly inTransaction: boolean;
}

interface State {
  modules: ModuleRow[];
  events: (readonly unknown[])[];
  audits: (readonly unknown[])[];
}

export function pgError(code: string): Error {
  return Object.assign(new Error(`simulated SQLSTATE ${code}`), { code });
}

const text = (value: unknown): string => String(value);
const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export class FakeDb implements FoundationDb {
  readonly iam: IamFixture;
  state: State = { modules: [], events: [], audits: [] };
  readonly statements: Statement[] = [];
  readonly txLog: ('BEGIN' | 'COMMIT' | 'ROLLBACK')[] = [];
  readonly failOn = new Map<string, Error>();
  private clock = 0;

  constructor(iam: IamFixture = defaultIam()) {
    this.iam = iam;
  }

  query(sql: string, params: readonly unknown[]): Promise<unknown[]> {
    return this.run(sql, params, this.state, false);
  }

  async execute(sql: string, params: readonly unknown[]): Promise<number> {
    return (await this.run(sql, params, this.state, false)).length;
  }

  async transaction<R>(fn: (tx: SqlExecutor) => Promise<R>): Promise<R> {
    this.txLog.push('BEGIN');
    const staged: State = { modules: [...this.state.modules], events: [...this.state.events], audits: [...this.state.audits] };
    const tx: SqlExecutor = {
      query: (sql, params) => this.run(sql, params, staged, true),
      execute: async (sql, params) => (await this.run(sql, params, staged, true)).length,
    };
    try {
      const result = await fn(tx);
      this.state = staged;
      this.txLog.push('COMMIT');
      return result;
    } catch (error) {
      this.txLog.push('ROLLBACK');
      throw error;
    }
  }

  private async run(sql: string, params: readonly unknown[], state: State, inTransaction: boolean): Promise<unknown[]> {
    this.statements.push({ sql, params: [...params], inTransaction });
    const failure = this.failOn.get(sql);
    if (failure) throw failure;
    switch (sql) {
      case FOUNDATION_SQL.permissionDefinitions:
        return this.iam.permissions
          .filter((p) => p.permission_code === params[0] && p.module_code === params[1] && p.resource_code === params[2] && p.operation === params[3])
          .map((p) => ({ permission_id: p.permission_id, minimum_assurance_level: p.minimum_assurance_level }));
      case FOUNDATION_SQL.accountFacts: {
        const account = this.iam.accounts.get(text(params[0]));
        return account ? [{ ...account }] : [];
      }
      case FOUNDATION_SQL.grantFacts:
        return this.iam.grants.filter((g) => g.accountId === params[0] && g.permissionId === params[1]).map((g) => ({ ...g.row }));
      case FOUNDATION_SQL.listModules:
        return [...state.modules].sort((a, b) => (a.module_key < b.module_key ? -1 : a.module_key > b.module_key ? 1 : 0)).map((m) => ({ ...m }));
      case FOUNDATION_SQL.insertModule: {
        if (state.modules.some((m) => m.module_key === params[0])) throw pgError('23505');
        const at = new Date(Date.UTC(2026, 9, 16, 12, 0, 0, this.clock++)).toISOString().replace('Z', '000Z');
        const row: ModuleRow = {
          module_id: randomUUID(), module_key: text(params[0]), module_name: text(params[1]), description: nullableText(params[2]),
          module_type: text(params[3]), is_enabled: false, created_at: at, updated_at: at, created_by_account_id: nullableText(params[4]),
        };
        state.modules.push(row);
        return [{ ...row }];
      }
      case FOUNDATION_SQL.insertModuleEvent:
        state.events.push([...params]);
        return [];
      case FOUNDATION_SQL.insertAudit:
        state.audits.push([...params]);
        return [];
      default:
        throw new Error('FakeDb: unexpected SQL');
    }
  }
}

export class FakeAuth {
  readonly sessions = new Map<string, SessionBody>();
  calls = 0;

  async describeSession(token: string | undefined, _client: ClientInfo): Promise<SessionBody> {
    this.calls += 1;
    const session = token === undefined ? undefined : this.sessions.get(token);
    if (!session) throw new AuthError(401, 'SESSION_INVALID', { clearCookie: true });
    return session;
  }

  authenticated(tokenValue: string, userAccountId: string): void {
    this.sessions.set(tokenValue, {
      status: 'AUTHENTICATED', account: { userAccountId, username: 'nv0001', fullName: 'Nguyễn Văn An' }, assuranceLevel: 1,
      expiresAt: '2026-10-16T20:00:00.000Z', idleExpiresAt: '2026-10-16T13:00:00.000Z', serverTime: '2026-10-16T12:00:00.000Z',
    });
  }

  activation(tokenValue: string): void {
    this.sessions.set(tokenValue, { status: 'PASSWORD_CHANGE_REQUIRED', account: { username: 'nv0002' }, expiresAt: '2026-10-16T12:15:00.000Z', serverTime: '2026-10-16T12:00:00.000Z' });
  }
}

export interface Harness {
  app: Express;
  db: FakeDb;
  auth: FakeAuth;
  logs: string[];
}

export function buildHarness(options: { iam?: IamFixture; extraRouters?: express.Router[] } = {}): Harness {
  const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN });
  const logs: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  const db = new FakeDb(options.iam);
  const auth = new FakeAuth();
  // The real SQL repository and service over the fake executor (no Prisma client involved).
  const service = new FoundationService({ repository: new SqlFoundationRepository(db), logger });
  const router = foundationRouter({ authService: auth, service, secureCookie: false });
  const app = createApp({ config, logger, apiRouters: [healthRouter(), router, ...(options.extraRouters ?? [])] });
  return { app, db, auth, logs };
}
