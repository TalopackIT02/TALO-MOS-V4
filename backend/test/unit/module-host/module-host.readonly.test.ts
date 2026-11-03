import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/core/logging/logger.js';
import { READONLY_SQL, createReadOnlyCapability, wrapReadQuery } from '../../../src/module-host/readonly.js';
import { FoundationError } from '../../../src/modules/foundation/foundation.errors.js';
import type { FoundationDb, SqlExecutor } from '../../../src/modules/foundation/foundation.repository.js';

// MODULE_HOST_READONLY_SECURITY_FIX — unit level (database double). PostgreSQL proofs: test/integration/readonly-fix.

const logger = createLogger({ level: 'error' });
const READER = 'talo_module_reader';

function fake(state: { role?: string; readOnly?: string; roleAfter?: string } = {}) {
  const log: { sql: string; params: readonly unknown[] }[] = [];
  const outcome = { committed: 0, rolledBack: 0 };
  let calls = 0;
  const tx: SqlExecutor = {
    query: async (sql, params) => {
      log.push({ sql, params });
      if (sql.includes(`current_setting('transaction_read_only')`) && sql !== READONLY_SQL.state) return [{ read_only: state.readOnly ?? 'on' }];
      if (sql === READONLY_SQL.state) {
        calls += 1;
        const role = calls > 1 && state.roleAfter ? state.roleAfter : (state.role ?? READER);
        return [{ read_only: state.readOnly ?? 'on', current_role: role, session_role: role }];
      }
      return [{ x: 1 }];
    },
    execute: async (sql, params) => { log.push({ sql, params }); return 0; },
  };
  const db: FoundationDb = {
    ...tx,
    transaction: async (fn) => {
      try { const r = await fn(tx); outcome.committed += 1; return r; } catch (e) { outcome.rolledBack += 1; throw e; }
    },
  };
  return { db, log, outcome };
}

const cap = (readerDb: FoundationDb | null | undefined, fallback?: FoundationDb) =>
  createReadOnlyCapability({ readerDb, fallbackDb: fallback ?? fake().db, readerRole: READER, logger, moduleKey: 'DEMO' });

describe('readOnly security fix', () => {
  it('embeds the module statement as ONE sub-query with a Host bind parameter (extended protocol, parser accepts a query only)', async () => {
    const f = fake();
    const rows = await cap(f.db)((q) => q.query('SELECT a FROM t WHERE b = $1 ORDER BY a', ['x']));
    expect(rows).toEqual([{ x: 1 }]);
    const sent = f.log.find((l) => l.sql.includes('host_readonly_query'));
    expect(sent).toEqual({ sql: 'SELECT * FROM (\nSELECT a FROM t WHERE b = $1 ORDER BY a\n) AS host_readonly_query WHERE $2::boolean', params: ['x', true] });
    expect(wrapReadQuery('COMMIT', 0)).toBe('SELECT * FROM (\nCOMMIT\n) AS host_readonly_query WHERE $1::boolean');
  });
  it('always rolls back (never commits a read), result still returned; locks released inside the transaction', async () => {
    const f = fake();
    await cap(f.db)((q) => q.query('SELECT 1', []));
    expect(f.outcome).toEqual({ committed: 0, rolledBack: 1 });
    expect(f.log.map((l) => l.sql).slice(0, 4)).toEqual([READONLY_SQL.readOnly, READONLY_SQL.timeout, READONLY_SQL.state, READONLY_SQL.savepoint]);
    expect(f.log.map((l) => l.sql).slice(-2)).toEqual([READONLY_SQL.state, READONLY_SQL.unlock]);
  });
  it('module failure: rollback to the savepoint, locks released, original error re-thrown', async () => {
    const f = fake();
    const boom = new Error('module');
    await expect(cap(f.db)(async () => { throw boom; })).rejects.toBe(boom);
    expect(f.log.map((l) => l.sql).slice(-2)).toEqual([READONLY_SQL.rollbackTo, READONLY_SQL.unlock]);
  });
  it('fail closed: reader not configured, wrong role (e.g. talo_app), not READ ONLY, role changed during the call', async () => {
    let ran = 0;
    const run = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof FoundationError ? e.code : 'OTHER'; } };
    expect(await run(cap(null)(async () => { ran += 1; }))).toBe('SERVICE_BUSY');
    expect(await run(cap(fake({ role: 'talo_app' }).db)(async () => { ran += 1; }))).toBe('SERVICE_BUSY');
    expect(await run(cap(fake({ readOnly: 'off' }).db)(async () => { ran += 1; }))).toBe('SERVICE_BUSY');
    expect(ran).toBe(0);
    expect(await run(cap(fake({ roleAfter: 'talo_app' }).db)(async () => { ran += 1; }))).toBe('SERVICE_BUSY');
    expect(ran).toBe(1);
  });
  it('test seam only (readerDb undefined): legacy executor, statement unchanged — the server never uses it', async () => {
    const legacy = fake({ role: 'talo_app' });
    await cap(undefined, legacy.db)((q) => q.query('SELECT 1', []));
    expect(legacy.log.some((l) => l.sql === 'SELECT 1')).toBe(true);
  });
});
