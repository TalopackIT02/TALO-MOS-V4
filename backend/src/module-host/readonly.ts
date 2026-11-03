import { z } from 'zod';
import type { Logger } from '../core/logging/logger.js';
import { serviceBusy } from '../modules/foundation/foundation.errors.js';
import type { FoundationDb } from '../modules/foundation/foundation.repository.js';
import type { HostQuery } from './contract.js';

// MODULE_HOST_READONLY_SECURITY_FIX (OD-G3-01). Root cause of the escape found in Gate 3: the module's SQL text ran
// unchanged on the API role's connection (talo_app, which holds write grants) inside `SET TRANSACTION READ ONLY` only;
//   (1) a call without bind parameters used the simple-query protocol → several statements per call ("SELECT 1; COMMIT; INSERT …");
//   (2) transaction control (COMMIT) was accepted → the next statements ran outside the read-only transaction as talo_app.
// Protection now has two independent layers:
//   DATABASE  the executor connects as talo_module_reader: LOGIN, SELECT on the approved objects only, EXECUTE on the
//             approved reader functions only, member of no role (cannot SET ROLE / set_config('role') to a writer). Even
//             a statement that escaped every Host check has no privilege to write. Checked on every call (current_user
//             AND session_user = reader, transaction READ ONLY) before and after the module code.
//   HOST      the module's text is embedded as a sub-query with one Host bind parameter:
//               SELECT * FROM (<module sql>) AS host_readonly_query WHERE $n::boolean
//             → always the extended protocol (one prepared statement: a second statement is a protocol error), and the
//             PostgreSQL parser accepts only a query there (no COMMIT / SET / CALL / DO, no data-modifying WITH).
//             The transaction is ALWAYS rolled back (nothing is committed by a read; session-level set_config() calls are
//             undone) and session advisory locks are released before the connection returns to the pool.
// Not a protection by itself: a keyword filter or BEGIN READ ONLY — kept only as the inner, third layer.

export const READONLY_STATEMENT_TIMEOUT_MS = 5_000;

export const READONLY_SQL = {
  readOnly: 'SET TRANSACTION READ ONLY',
  timeout: `SET LOCAL statement_timeout = ${READONLY_STATEMENT_TIMEOUT_MS}`,
  state: `SELECT current_setting('transaction_read_only') AS read_only, current_user::text AS current_role, session_user::text AS session_role`,
  unlock: 'SELECT pg_advisory_unlock_all() IS NULL AS released',
  savepoint: 'SAVEPOINT host_readonly_module',
  rollbackTo: 'ROLLBACK TO SAVEPOINT host_readonly_module',
} as const;

// One module statement → one Host statement with a Host-owned bind parameter after the module's own parameters.
export function wrapReadQuery(sql: string, paramCount: number): string {
  return `SELECT * FROM (\n${sql}\n) AS host_readonly_query WHERE $${paramCount + 1}::boolean`;
}
export const wrapParams = (params: readonly unknown[]): unknown[] => [...params, true];

const stateRow = z.object({ read_only: z.string(), current_role: z.string(), session_role: z.string() });
const LEGACY_STATE_SQL = `SELECT current_setting('transaction_read_only') AS read_only`;
const legacyRow = z.object({ read_only: z.string() });

class Rollback extends Error {
  constructor() {
    super('host readOnly: rollback after read');
    this.name = 'HostReadOnlyRollback';
  }
}

export interface ReadOnlyDeps {
  // Executor of the reader role. null = not configured → fail closed (503). undefined = in-process test seam only
  // (legacy executor of the caller's db, no role assertion) — the server always passes a value.
  readonly readerDb: FoundationDb | null | undefined;
  readonly fallbackDb: FoundationDb;
  readonly readerRole: string;
  readonly logger: Logger;
  readonly moduleKey: string;
}

export function createReadOnlyCapability(deps: ReadOnlyDeps) {
  const legacy = <R>(fn: (db: HostQuery) => Promise<R>) => deps.fallbackDb.transaction(async (tx) => {
    await tx.execute(READONLY_SQL.readOnly, []);
    await tx.execute(READONLY_SQL.timeout, []);
    // Exactly the pre-fix behaviour (statement and check unchanged).
    const [state] = await tx.query(LEGACY_STATE_SQL, []);
    if (legacyRow.parse(state).read_only !== 'on') throw new Error('transaction is not READ ONLY');
    return fn({ query: (sql, params) => tx.query(sql, params) });
  });

  return async function readOnly<R>(fn: (db: HostQuery) => Promise<R>): Promise<R> {
    if (deps.readerDb === undefined) return legacy(fn);
    const db = deps.readerDb;
    if (db === null) {
      deps.logger.error('module readOnly refused: MODULE_READER_DATABASE_URL not configured', { moduleKey: deps.moduleKey });
      throw serviceBusy();
    }
    const assertState = async (tx: { query(sql: string, params: readonly unknown[]): Promise<unknown[]> }, when: string) => {
      const s = stateRow.parse((await tx.query(READONLY_SQL.state, []))[0]);
      if (s.read_only !== 'on' || s.current_role !== deps.readerRole || s.session_role !== deps.readerRole) {
        deps.logger.error('module readOnly refused: executor state', { moduleKey: deps.moduleKey, when, readOnly: s.read_only, roleOk: s.current_role === deps.readerRole });
        throw serviceBusy();
      }
    };
    let result: R | undefined;
    let done = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(READONLY_SQL.readOnly, []);
        await tx.execute(READONLY_SQL.timeout, []);
        await assertState(tx, 'before');
        // The module runs inside a savepoint so that, even when it fails, the transaction can still release session
        // advisory locks (not transactional) before the connection returns to the pool.
        await tx.execute(READONLY_SQL.savepoint, []);
        try {
          result = await fn({ query: (sql, params) => tx.query(wrapReadQuery(sql, params.length), wrapParams(params)) });
        } catch (error) {
          await tx.execute(READONLY_SQL.rollbackTo, []);
          await tx.query(READONLY_SQL.unlock, []);
          throw error;
        }
        await assertState(tx, 'after');
        await tx.query(READONLY_SQL.unlock, []);
        done = true;
        throw new Rollback();
      });
    } catch (error) {
      if (error instanceof Rollback && done) return result as R;
      throw error;
    }
    throw new Error('host readOnly: transaction ended without rollback');
  };
}
