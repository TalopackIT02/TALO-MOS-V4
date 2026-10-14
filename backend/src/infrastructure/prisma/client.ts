import { PrismaPg } from '@prisma/adapter-pg';
import { AppError } from '../../core/errors/AppError.js';
import { PrismaClient } from './generated/client.js';

// Prisma Client over the pg driver adapter. Nothing connects at import time: the client is created on
// first use and the adapter opens pool connections only when a query runs.
// F1 has no module that queries the database; this is the single place later modules obtain the client from.

let client: PrismaClient | undefined;

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export function getPrismaClient(databaseUrl: string | undefined): PrismaClient {
  if (databaseUrl === undefined) {
    throw new AppError(503, 'DATABASE_NOT_CONFIGURED', 'Dịch vụ dữ liệu chưa sẵn sàng.');
  }
  client ??= createPrismaClient(databaseUrl);
  return client;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (client === undefined) return;
  const current = client;
  client = undefined;
  await current.$disconnect();
}
