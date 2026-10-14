import { PasswordHasher } from '../../src/modules/auth/passwordHasher.js';
import { AuthFixtures, FIXTURE_PREFIX } from './authFixtures.js';

// CLI for the browser E2E suite (tests/playwright.auth.config.ts). Test database only, role talo_test_harness.
//   tsx test/support/e2eFixtures.ts create  <runId>  → JSON on stdout: account credentials (one-time, in memory of the
//                                                      caller only) + the UUIDs and run window needed for cleanup
//   tsx test/support/e2eFixtures.ts cleanup <runId>  → reads AUTH_E2E_CLEANUP (JSON: memberships, accounts, startedAt,
//                                                      unknownRequestIds) and deletes exactly those rows
// Nothing is written to disk.

interface CleanupInput {
  memberships: string[];
  accounts: string[];
  startedAt: string;
  unknownRequestIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseCleanup(raw: string | undefined): CleanupInput {
  const value: unknown = JSON.parse(raw ?? 'null');
  if (typeof value !== 'object' || value === null) throw new Error('AUTH_E2E_CLEANUP missing');
  const list = (key: string): string[] => {
    const v: unknown = Reflect.get(value, key);
    if (!Array.isArray(v) || !v.every((x): x is string => typeof x === 'string' && UUID.test(x))) throw new Error(`AUTH_E2E_CLEANUP.${key} invalid`);
    return v;
  };
  const startedAt: unknown = Reflect.get(value, 'startedAt');
  if (typeof startedAt !== 'string' || startedAt === '') throw new Error('AUTH_E2E_CLEANUP.startedAt invalid');
  return { memberships: list('memberships'), accounts: list('accounts'), startedAt, unknownRequestIds: list('unknownRequestIds') };
}

async function main(): Promise<void> {
  const [command, runId] = process.argv.slice(2);
  if ((command !== 'create' && command !== 'cleanup') || !runId || !runId.startsWith(FIXTURE_PREFIX)) {
    throw new Error('usage: e2eFixtures.ts create|cleanup AUTHT-<run>');
  }
  const hasher = new PasswordHasher();
  await hasher.init();
  const harness = await AuthFixtures.connect();
  const fx = new AuthFixtures(harness, hasher, runId);
  try {
    if (command === 'create') {
      await fx.assertNoLeftovers();
      const provisioned = await fx.create({ accountStatus: 'PROVISIONED' });
      const active = await fx.create();
      process.stdout.write(`${JSON.stringify({
        runId: fx.runId, userAgent: fx.userAgent, startedAt: fx.startedAt,
        memberships: fx.memberships, accounts: fx.accounts,
        provisioned: { username: provisioned.username, password: provisioned.password, fullName: provisioned.fullName },
        active: { username: active.username, password: active.password, fullName: active.fullName },
      })}\n`);
    } else {
      const input = parseCleanup(process.env['AUTH_E2E_CLEANUP']);
      fx.memberships.push(...input.memberships);
      fx.accounts.push(...input.accounts);
      fx.startedAt = input.startedAt;
      for (const id of input.unknownRequestIds) fx.registerUnknownAttempt(id);
      const deleted = await fx.cleanup();
      const remaining = await fx.remaining();
      process.stdout.write(`${JSON.stringify({ runId, deleted, remaining })}\n`);
      if (remaining !== 0) process.exitCode = 1;
    }
  } finally {
    await harness.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'fixture error'}\n`);
  process.exit(1);
});
