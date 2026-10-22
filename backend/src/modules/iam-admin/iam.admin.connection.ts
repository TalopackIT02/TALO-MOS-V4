import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import type { PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import { sqlstateOf } from '../auth/sqlstate.js';
import { prismaFoundationDb } from '../foundation/foundation.repository.js';
import type { FoundationDb } from '../foundation/foundation.repository.js';

// IAM-NEXT B1 — the IAM Management router writes IAM through its OWN database role (talo_iam_admin, owner-approved
// design): talo_app (Auth, Foundation, Module Host, SYSTEM_TEST) never writes IAM. The dedicated connection is used only
// after an identity check at start-up: the role is not the API role, is not superuser / CREATEROLE / CREATEDB /
// BYPASSRLS, and is connected to the API database. Otherwise (or with no IAM_ADMIN_DATABASE_URL) the router keeps the
// API role: reads work, every IAM write is refused by PostgreSQL (503 IAM_DB_PRIVILEGE_MISSING) — fail closed.

export const IAM_ADMIN_IDENTITY_SQL = `
  SELECT current_user::text AS usr, current_database()::text AS db,
         r.rolsuper AS super, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb, r.rolbypassrls AS bypassrls
    FROM pg_roles AS r WHERE r.rolname = current_user`;

const identityRow = z.object({ usr: z.string(), db: z.string(), super: z.boolean(), createrole: z.boolean(), createdb: z.boolean(), bypassrls: z.boolean() });

// Problems of the dedicated connection's identity (empty = acceptable). Never contains secrets.
export function identityProblems(rows: unknown[], expected: { database: string; apiRole: string }): string[] {
  const [first] = rows;
  const parsed = identityRow.safeParse(first);
  if (!parsed.success || rows.length !== 1) return ['identity unreadable'];
  const r = parsed.data;
  const problems: string[] = [];
  if (r.usr === expected.apiRole) problems.push('same role as the API connection');
  if (r.db !== expected.database) problems.push('another database');
  if (r.super || r.createrole || r.createdb || r.bypassrls) problems.push('role has elevated attributes');
  return problems;
}

export type Query = (sql: string) => Promise<unknown[]>;

// Checks the dedicated connection against the API connection; [] = acceptable. A query failure propagates (fail closed).
export async function probeIamAdmin(api: Query, iam: Query): Promise<string[]> {
  const expected = z.object({ usr: z.string(), db: z.string() }).parse((await api('SELECT current_user::text AS usr, current_database()::text AS db'))[0]);
  return identityProblems(await iam(IAM_ADMIN_IDENTITY_SQL), { database: expected.db, apiRole: expected.usr });
}

export interface IamAdminConnection {
  readonly db: FoundationDb;
  readonly dedicated: boolean;
  close(): Promise<void>;
}

export interface IamAdminConnectionOptions {
  readonly iamUrl: string | undefined;
  readonly apiClient: PrismaClient;
  readonly createClient: (url: string) => PrismaClient;
  readonly logger: Logger;
}

export async function connectIamAdmin(options: IamAdminConnectionOptions): Promise<IamAdminConnection> {
  const fallback: IamAdminConnection = { db: prismaFoundationDb(options.apiClient), dedicated: false, close: async () => undefined };
  if (options.iamUrl === undefined) {
    options.logger.info('IAM Management: no dedicated database role configured (IAM writes are refused)');
    return fallback;
  }
  const client = options.createClient(options.iamUrl);
  try {
    const problems = await probeIamAdmin((sql) => options.apiClient.$queryRawUnsafe<unknown[]>(sql), (sql) => client.$queryRawUnsafe<unknown[]>(sql));
    if (problems.length > 0) {
      options.logger.error('IAM Management: dedicated database role refused (IAM writes are refused)', { problems: problems.join(', ') });
      await client.$disconnect();
      return fallback;
    }
  } catch (error) {
    options.logger.error('IAM Management: dedicated database role unavailable (IAM writes are refused)', {
      errorName: error instanceof Error ? error.name : typeof error, sqlstate: sqlstateOf(error),
    });
    await client.$disconnect().catch(() => undefined);
    return fallback;
  }
  options.logger.info('IAM Management: dedicated database role connected');
  return { db: prismaFoundationDb(client), dedicated: true, close: () => client.$disconnect() };
}
