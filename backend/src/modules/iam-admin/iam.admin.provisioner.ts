import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import type { PrismaClient } from '../../infrastructure/prisma/generated/client.js';
import { sqlstateOf } from '../auth/sqlstate.js';
import { prismaExecutor } from '../auth/provisioning/prismaExecutor.js';
import type { SqlExecutor } from '../auth/provisioning/provisionAccount.js';

// IAM Phase B — temporary credentials from the AppShell (account creation, re-issue). The existing P-4e services
// (provisionAccount, reissueTemporaryPassword) run unchanged on the existing role talo_provisioner; IAM Management only
// calls them. Two conditions, both deployment decisions:
//   1. IAM_UI_TEMPORARY_CREDENTIALS=enabled — the owner's approval of the P-4e change "the temporary password is shown
//      once in the administration UI" (before: only on an interactive terminal). Default: disabled.
//   2. PROVISIONER_DATABASE_URL — a connection whose identity is checked at start-up: current_user = talo_provisioner,
//      no elevated attribute, same database as the API.
// Otherwise the routes answer 503 CREDENTIAL_UI_DISABLED / CREDENTIAL_UI_UNAVAILABLE and nothing is attempted.

export type ProvisionerState = 'DISABLED' | 'UNAVAILABLE' | 'READY';

export interface ProvisionerConnection {
  readonly state: ProvisionerState;
  readonly executor: SqlExecutor | null;
  close(): Promise<void>;
}

export const PROVISIONER_IDENTITY_SQL = `
  SELECT current_user::text AS usr, current_database()::text AS db,
         r.rolsuper AS super, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb, r.rolbypassrls AS bypassrls
    FROM pg_roles AS r WHERE r.rolname = current_user`;

const identityRow = z.object({ usr: z.string(), db: z.string(), super: z.boolean(), createrole: z.boolean(), createdb: z.boolean(), bypassrls: z.boolean() });

// Problems of the provisioner connection's identity (empty = acceptable). Never contains secrets.
export function provisionerProblems(rows: unknown[], database: string): string[] {
  const [first] = rows;
  const parsed = identityRow.safeParse(first);
  if (!parsed.success || rows.length !== 1) return ['identity unreadable'];
  const r = parsed.data;
  const problems: string[] = [];
  if (r.usr !== 'talo_provisioner') problems.push('role is not talo_provisioner');
  if (r.db !== database) problems.push('another database');
  if (r.super || r.createrole || r.createdb || r.bypassrls) problems.push('role has elevated attributes');
  return problems;
}

export interface ProvisionerOptions {
  readonly enabled: boolean;
  readonly url: string | undefined;
  readonly apiClient: PrismaClient;
  readonly createClient: (url: string) => PrismaClient;
  readonly logger: Logger;
}

const NONE = async () => undefined;

export async function connectProvisioner(options: ProvisionerOptions): Promise<ProvisionerConnection> {
  if (!options.enabled) {
    options.logger.info('IAM Management: temporary credentials in the UI are disabled (P-4e: CLI only)');
    return { state: 'DISABLED', executor: null, close: NONE };
  }
  if (options.url === undefined) {
    options.logger.warn('IAM Management: temporary credentials enabled but PROVISIONER_DATABASE_URL is not set (refused)');
    return { state: 'UNAVAILABLE', executor: null, close: NONE };
  }
  const client = options.createClient(options.url);
  try {
    const [api] = await options.apiClient.$queryRawUnsafe<unknown[]>('SELECT current_database()::text AS db');
    const database = z.object({ db: z.string() }).parse(api).db;
    const problems = provisionerProblems(await client.$queryRawUnsafe<unknown[]>(PROVISIONER_IDENTITY_SQL), database);
    if (problems.length > 0) {
      options.logger.error('IAM Management: provisioner connection refused', { problems: problems.join(', ') });
      await client.$disconnect();
      return { state: 'UNAVAILABLE', executor: null, close: NONE };
    }
  } catch (error) {
    options.logger.error('IAM Management: provisioner connection unavailable', {
      errorName: error instanceof Error ? error.name : typeof error, sqlstate: sqlstateOf(error),
    });
    await client.$disconnect().catch(() => undefined);
    return { state: 'UNAVAILABLE', executor: null, close: NONE };
  }
  options.logger.info('IAM Management: provisioner connection ready (temporary credentials in the UI enabled)');
  return { state: 'READY', executor: prismaExecutor(client), close: () => client.$disconnect() };
}
