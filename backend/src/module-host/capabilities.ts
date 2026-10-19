import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Logger } from '../core/logging/logger.js';
import type { AuthService } from '../modules/auth/auth.service.js';
import { sqlstateOf } from '../modules/auth/sqlstate.js';
import { AccessGuard } from '../modules/foundation/foundation.access.js';
import { sessionHandler } from '../modules/foundation/foundation.http.js';
import { canonicalDigest } from '../modules/foundation/foundation.json.js';
import { micSchema } from '../modules/foundation/foundation.mic.js';
import type { MenuNode } from '../modules/foundation/foundation.navigation.js';
import type { NavigationService } from '../modules/foundation/foundation.navigation.service.js';
import { evaluateAccess } from '../modules/foundation/foundation.permissions.js';
import type { FoundationDb, FoundationRepository } from '../modules/foundation/foundation.repository.js';
import { HOST_PROTOCOL } from './contract.js';
import type { HostCapabilities } from './contract.js';

// MOD-TEST-02 — the capabilities Foundation / Auth give to a module package (protocol TALO-MODULE-HOST-1). Each one is a
// thin adapter over the existing, unchanged implementation: sessionHandler (AuthService), AccessGuard + evaluateAccess
// (IAM, DENIED audit), the B01 / B02 lifecycle state, a READ ONLY database executor as the API role, the IAM-filtered
// navigation menu, the MIC-1.0 validator + RFC 8785 digest, SQLSTATE extraction and the local regression results file.
// Nothing here grants a permission, activates a module or widens a database privilege.

export const STATEMENT_TIMEOUT_MS = 5_000;

export const HOST_SQL = {
  readOnly: 'SET TRANSACTION READ ONLY',
  timeout: `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
  readOnlyState: `SELECT current_setting('transaction_read_only') AS read_only`,
  // Lifecycle gate of a module API request: module row + number of ACTIVE versions.
  lifecycle: `
    SELECT m.is_enabled, (SELECT count(*)::int FROM foundation.fnd_module_versions AS v WHERE v.module_id = m.module_id AND v.status = 'ACTIVE') AS active_versions
      FROM foundation.fnd_modules AS m
     WHERE m.module_key = $1`,
} as const;

// Fixed, Host-owned location of a module's latest local regression results (never a path from a request).
export function regressionResultsFile(moduleKey: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(moduleKey)) throw new Error('invalid module key');
  return join(tmpdir(), 'talo-mos-v4-modules', moduleKey, 'regression-latest.json');
}

export interface HostDeps {
  readonly db: FoundationDb;
  readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly navigation: Pick<NavigationService, 'menu'>;
  readonly logger: Logger;
  readonly secureCookie: boolean;
  // Test seam: results file of the module (default regressionResultsFile(moduleKey)).
  readonly resultsFile?: string;
}

const readOnlyRow = z.object({ read_only: z.string() });
const lifecycleRow = z.object({ is_enabled: z.boolean(), active_versions: z.number().int() });

function routesOf(nodes: readonly MenuNode[]): string[] {
  return nodes.flatMap((n) => [...(n.routePath === null ? [] : [n.routePath]), ...routesOf(n.children)]);
}

export function createHostCapabilities(moduleKey: string, deps: HostDeps): HostCapabilities {
  const guard = new AccessGuard({ repository: deps.access, logger: deps.logger });
  const handle = sessionHandler({ authService: deps.authService, secureCookie: deps.secureCookie });
  const resultsFile = deps.resultsFile ?? regressionResultsFile(moduleKey);
  return {
    protocol: HOST_PROTOCOL,
    moduleKey,
    logger: deps.logger,
    session: (handler) => handle(handler),
    authorize: (actor, permission, actionCode, deniedTargetType) => guard.authorize(actor, permission, actionCode, deniedTargetType),
    evaluate: async (actor, permission) => evaluateAccess(await deps.access.loadAccessFacts(actor.userAccountId, permission), actor.assuranceLevel),
    lifecycle: async (key) => {
      const [row] = await deps.db.query(HOST_SQL.lifecycle, [key]);
      if (row === undefined) return null;
      const r = lifecycleRow.parse(row);
      return { isEnabled: r.is_enabled, activeVersions: r.active_versions };
    },
    // READ ONLY + statement timeout, verified inside the same transaction before `fn` runs.
    readOnly: (fn) => deps.db.transaction(async (tx) => {
      await tx.execute(HOST_SQL.readOnly, []);
      await tx.execute(HOST_SQL.timeout, []);
      const [state] = await tx.query(HOST_SQL.readOnlyState, []);
      if (readOnlyRow.parse(state).read_only !== 'on') throw new Error('transaction is not READ ONLY');
      return fn({ query: (sql, params) => tx.query(sql, params) });
    }),
    menuRoutes: async (actor) => routesOf(await deps.navigation.menu(actor)),
    inspectManifest: (manifest, manifestHash) => {
      let intact = false;
      try {
        intact = manifest !== null && manifestHash !== null && canonicalDigest(manifest).sha256 === manifestHash;
      } catch {
        intact = false;
      }
      return { intact, micValid: micSchema.safeParse(manifest).success };
    },
    sqlstate: sqlstateOf,
    regressionResults: async () => {
      try {
        return await readFile(resultsFile, 'utf8');
      } catch (error) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') return null;
        throw error;
      }
    },
  };
}
