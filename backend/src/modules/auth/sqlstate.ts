// Extracts a PostgreSQL SQLSTATE from an error thrown through Prisma + @prisma/adapter-pg (the code sits on nested
// `cause` / `meta` objects depending on the layer). Only the five-character code is returned — never messages, SQL
// text or driver details, which must not reach logs or clients.

const SQLSTATE = /^[0-9A-Z]{5}$/;
const CODE_KEYS = ['code', 'originalCode', 'sqlState', 'sqlstate'];

export const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(['40P01', '40001']);

export function sqlstateOf(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): string | undefined => {
    if (typeof value !== 'object' || value === null || depth > 6 || seen.has(value)) return undefined;
    seen.add(value);
    for (const key of CODE_KEYS) {
      const code: unknown = Reflect.get(value, key);
      if (typeof code === 'string' && SQLSTATE.test(code) && !code.startsWith('P')) return code;
    }
    for (const key of ['cause', 'meta', 'driverAdapterError', 'error']) {
      const found = visit(Reflect.get(value, key), depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(error, 0);
}

export function isRetryable(error: unknown): boolean {
  const code = sqlstateOf(error);
  return code !== undefined && RETRYABLE_SQLSTATES.has(code);
}
