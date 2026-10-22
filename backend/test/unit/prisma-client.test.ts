import { describe, expect, expectTypeOf, it } from 'vitest';
import { AppError } from '../../src/core/errors/AppError.js';
import type { Prisma } from '../../src/infrastructure/prisma/generated/client.js';
import { createPrismaClient, disconnectPrismaClient, getPrismaClient } from '../../src/infrastructure/prisma/client.js';

describe('Prisma client initialisation', () => {
  it('creates a client without connecting (unreachable URL does not fail until a query runs)', async () => {
    const client = createPrismaClient('postgresql://nobody:nothing@127.0.0.1:1/none');
    expect(client).toBeDefined();
    await client.$disconnect();
  });

  it('refuses to provide a client when DATABASE_URL is not configured', () => {
    expect(() => getPrismaClient(undefined)).toThrow(AppError);
  });

  it('reuses one client and can be disconnected safely more than once', async () => {
    const url = 'postgresql://nobody:nothing@127.0.0.1:1/none';
    expect(getPrismaClient(url)).toBe(getPrismaClient(url));
    await disconnectPrismaClient();
    await disconnectPrismaClient();
  });
});

// Mapping decision F1.3 / O2: a membership owns a LIST of accounts (current + historical disabled ones).
// These assertions are checked by `tsc` (npm run typecheck); vitest only executes them as no-ops.
describe('IAM v0.3 mapping cardinality', () => {
  it('maps Membership → Account as 1:N', () => {
    type MembershipWithAccounts = Prisma.iam_membershipsGetPayload<{ include: { iam_user_accounts: true } }>;
    type AccountWithMembership = Prisma.iam_user_accountsGetPayload<{ include: { iam_memberships: true } }>;
    expectTypeOf<MembershipWithAccounts['iam_user_accounts']>().toBeArray();
    expectTypeOf<AccountWithMembership['iam_memberships']>().not.toBeArray();
    // IAM Phase C PC-01 (C-13): an account PENDING_MEMBERSHIP has no membership yet — the relation is optional.
    expectTypeOf<AccountWithMembership['iam_memberships']>().toBeNullable();
  });

  it('keeps Account → Credential as 1:1 (uq_iam_credential_account is a plain unique index)', () => {
    type AccountWithCredential = Prisma.iam_user_accountsGetPayload<{ include: { iam_credentials: true } }>;
    expectTypeOf<AccountWithCredential['iam_credentials']>().not.toBeArray();
  });
});
