import type { Prisma, PrismaClient } from '../../../infrastructure/prisma/generated/client.js';
import type { SqlExecutor } from './provisionAccount.js';

// SqlExecutor over Prisma (raw SQL, READ COMMITTED). The connection's role decides the privileges.
export function prismaExecutor(db: PrismaClient | Prisma.TransactionClient): SqlExecutor {
  return {
    query: (sql, params) => db.$queryRawUnsafe<Record<string, string | null>[]>(sql, ...params),
    transaction: (work) => {
      if (!('$transaction' in db)) throw new Error('nested transaction');
      return db.$transaction((tx) => work(prismaExecutor(tx)), { isolationLevel: 'ReadCommitted' });
    },
  };
}
