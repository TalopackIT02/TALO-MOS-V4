import { createPrismaClient } from '../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../src/infrastructure/prisma/generated/client.js';

// AUTH-DB-F2 runtime connection smoke test (read-only).
// Verifies that the backend can reach talo_mos_v4_test as the least-privilege role talo_app.
// It never creates databases, roles, grants or data: a missing database/role yields NOT_READY.

export const EXPECTED_ROLE = 'talo_app';
export const EXPECTED_DATABASE = 'talo_mos_v4_test';

export type SmokeStatus = 'PASS' | 'NOT_READY' | 'FAIL';
export interface SmokeCheck {
  readonly status: 'PASS' | 'FAIL' | 'INFO';
  readonly name: string;
  readonly detail?: string;
}
export interface SmokeReport {
  readonly status: SmokeStatus;
  readonly target: string;
  readonly checks: readonly SmokeCheck[];
  readonly reason?: string;
}

// FBE-01B B-3a: the five IAM authorisation tables are readable (SELECT only) for the Foundation effective-permission check.
const APPROVED_READ_TABLES = [
  'iam_memberships', 'iam_user_accounts', 'iam_credentials', 'iam_sessions',
  'iam_permissions', 'iam_roles', 'iam_role_permissions', 'iam_user_roles', 'iam_user_permissions',
] as const;
const DENIED_READ_TABLES = ['iam_audit_logs', 'iam_account_verifications'];
const ALL_IAM_TABLES = [...APPROVED_READ_TABLES, ...DENIED_READ_TABLES];

// Connection-level failures that mean "environment not prepared yet" rather than "privileges wrong".
// Prisma 7 driver-adapter errors carry a `kind` (meta.driverAdapterError.cause.kind); raw PostgreSQL SQLSTATEs
// are kept as a fallback.
const NOT_READY_MARKERS = [
  'DatabaseNotReachable', 'DatabaseDoesNotExist', 'AuthenticationFailed', 'DatabaseAccessDenied',
  'TableDoesNotExist', // IAM baseline not applied to the test database yet
  'SocketTimeout', 'TooManyConnections',
  '3D000', // database does not exist
  '28P01', // password authentication failed (also reported for a non-existent role)
  '28000', // invalid authorization / no pg_hba entry
  '42P01', // undefined table
];

function errorText(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4 || value === null || value === undefined || seen.has(value)) return;
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
      return;
    }
    if (typeof value !== 'object') return;
    seen.add(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === 'stack') continue;
      walk(Reflect.get(value, key), depth + 1);
    }
  };
  walk(error, 0);
  return parts.join(' | ');
}

export function isNotReadyError(error: unknown): boolean {
  const text = errorText(error);
  return NOT_READY_MARKERS.some((marker) => text.includes(marker));
}

export function isPermissionDenied(error: unknown): boolean {
  const text = errorText(error);
  return text.includes('42501') || /permission denied/i.test(text);
}

export interface UrlCheck {
  readonly ok: boolean;
  readonly target: string;
  readonly reason?: string;
}

// Validates the connection string without ever returning the password.
export function checkSmokeUrl(databaseUrl: string | undefined): UrlCheck {
  if (!databaseUrl) return { ok: false, target: '(not configured)', reason: 'DATABASE_URL is not set' };
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return { ok: false, target: '(invalid)', reason: 'DATABASE_URL is not a valid URL' };
  }
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const target = `${user || '(no user)'}@${url.hostname}:${url.port || '5432'}/${database}`;
  if (!/^postgres(ql)?:$/.test(url.protocol)) return { ok: false, target, reason: 'DATABASE_URL must use postgresql://' };
  if (user !== EXPECTED_ROLE) return { ok: false, target, reason: `smoke test must run as ${EXPECTED_ROLE}, not "${user}"` };
  if (database !== EXPECTED_DATABASE) return { ok: false, target, reason: `smoke test must target ${EXPECTED_DATABASE}` };
  return { ok: true, target };
}

async function readOnly<T>(client: PrismaClient, query: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return query(tx);
  });
}

export async function runDbSmoke(databaseUrl: string | undefined): Promise<SmokeReport> {
  const urlCheck = checkSmokeUrl(databaseUrl);
  if (!urlCheck.ok) {
    const status: SmokeStatus = databaseUrl ? 'FAIL' : 'NOT_READY';
    return { status, target: urlCheck.target, checks: [], reason: urlCheck.reason ?? 'invalid configuration' };
  }

  const client = createPrismaClient(databaseUrl ?? '');
  const checks: SmokeCheck[] = [];
  const record = (ok: boolean, name: string, detail?: string) => checks.push({ status: ok ? 'PASS' : 'FAIL', name, ...(detail ? { detail } : {}) });

  try {
    // 1-2. Connect as talo_app and run SELECT 1.
    try {
      const rows = await client.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;
      record(rows[0]?.ok === 1, 'connect as talo_app and SELECT 1');
    } catch (error) {
      if (isNotReadyError(error)) {
        return { status: 'NOT_READY', target: urlCheck.target, checks, reason: 'database or role not available (create them with the approved foundation-f1 scripts)' };
      }
      throw error;
    }

    // Identity and role attributes (does not depend on admin in any way).
    const [identity] = await readOnly(client, (tx) => tx.$queryRaw<{
      usr: string; sess: string; db: string; elevated: boolean; memberships: number;
    }[]>`SELECT current_user AS usr, session_user AS sess, current_database() AS db,
            (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication FROM pg_roles WHERE rolname = current_user) AS elevated,
            (SELECT count(*)::int FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS memberships`);
    record(identity?.usr === EXPECTED_ROLE && identity.sess === EXPECTED_ROLE, 'identity is talo_app (current_user and session_user)');
    record(identity?.db === EXPECTED_DATABASE, 'connected to talo_mos_v4_test');
    record(identity?.elevated === false, 'no superuser/createdb/createrole/bypassrls/replication attribute');
    record(identity?.memberships === 0, 'not a member of any other role');

    // 3 + 6. Approved reads, through the Prisma Client models (read-only transaction).
    const counts = await readOnly(client, async (tx) => ({
      iam_memberships: await tx.iam_memberships.count(),
      iam_user_accounts: await tx.iam_user_accounts.count(),
      iam_credentials: await tx.iam_credentials.count(),
      iam_sessions: await tx.iam_sessions.count(),
      iam_permissions: await tx.iam_permissions.count(),
      iam_roles: await tx.iam_roles.count(),
      iam_role_permissions: await tx.iam_role_permissions.count(),
      iam_user_roles: await tx.iam_user_roles.count(),
      iam_user_permissions: await tx.iam_user_permissions.count(),
    }));
    for (const table of APPROVED_READ_TABLES) record(Number.isInteger(counts[table]), `Prisma read allowed: ${table}`, `${counts[table]} rows`);

    // 4. Tables that are not granted must refuse reads (each probe in its own read-only transaction).
    for (const table of DENIED_READ_TABLES) {
      try {
        await readOnly(client, (tx) => tx.$queryRawUnsafe(`SELECT 1 FROM iam.${table} LIMIT 1`));
        record(false, `read denied: ${table}`, 'read was ALLOWED');
      } catch (error) {
        record(isPermissionDenied(error), `read denied: ${table}`, isPermissionDenied(error) ? undefined : 'unexpected error type');
      }
    }

    // 5. No DDL / DELETE / TRUNCATE / TEMP — checked through privilege functions, without attempting mutations.
    const [privileges] = await readOnly(client, (tx) => tx.$queryRawUnsafe<{ delete_or_truncate: number; create_schema: boolean; temp: boolean; audit_insert: boolean; audit_select: boolean }[]>(
      `SELECT
         (SELECT count(*)::int FROM unnest($1::text[]) AS t(name)
           WHERE has_table_privilege('iam.' || t.name, 'DELETE') OR has_table_privilege('iam.' || t.name, 'TRUNCATE')) AS delete_or_truncate,
         (has_schema_privilege('iam', 'CREATE') OR has_schema_privilege('public', 'CREATE')) AS create_schema,
         has_database_privilege(current_database(), 'TEMP') AS temp,
         has_table_privilege('iam.iam_audit_logs', 'INSERT') AS audit_insert,
         has_table_privilege('iam.iam_audit_logs', 'SELECT') AS audit_select`,
      ALL_IAM_TABLES,
    ));
    record(privileges?.delete_or_truncate === 0, 'no DELETE/TRUNCATE on any IAM table');
    record(privileges?.create_schema === false, 'no CREATE (DDL) on schemas iam/public');
    record(privileges?.temp === false, 'no TEMP on the test database');
    record(privileges?.audit_insert === true && privileges.audit_select === false, 'audit log is insert-only');

    // Informational: other databases reachable through PostgreSQL PUBLIC defaults (finding F2-05).
    const others = await readOnly(client, (tx) => tx.$queryRaw<{ datname: string; can_connect: boolean; can_temp: boolean }[]>`
      SELECT datname, has_database_privilege(datname, 'CONNECT') AS can_connect, has_database_privilege(datname, 'TEMP') AS can_temp
      FROM pg_database WHERE datallowconn AND datname <> current_database() ORDER BY datname`);
    for (const db of others) {
      checks.push({ status: 'INFO', name: `other database ${db.datname}`, detail: `CONNECT=${db.can_connect} TEMP=${db.can_temp}` });
    }
  } catch (error) {
    record(false, 'unexpected error', error instanceof Error ? error.name : 'unknown');
  } finally {
    // 8. Close connections.
    await client.$disconnect();
  }

  const failed = checks.some((check) => check.status === 'FAIL');
  return { status: failed ? 'FAIL' : 'PASS', target: urlCheck.target, checks };
}
