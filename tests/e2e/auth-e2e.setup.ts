import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Creates this run's E2E accounts (test database, talo_test_harness) and returns the teardown that deletes them.
// Credentials reach the test workers only through this process's environment. Cleanup receives the exact UUIDs, the
// run window and the X-Request-Ids of unknown-username attempts recorded by the specs (audit ownership factors).

const backendDir = resolve(__dirname, '../../backend');
export const UNKNOWN_IDS_FILE = resolve(__dirname, '../test-results/auth-e2e/unknown-request-ids.txt');

function fixtures(command: 'create' | 'cleanup', runId: string, env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('npx', ['tsx', 'test/support/e2eFixtures.ts', command, runId], {
    cwd: backendDir, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, ...env },
  }).trim();
}

export default function globalSetup(): () => void {
  const runId = process.env['AUTH_E2E_RUN'];
  if (!runId) throw new Error('AUTH_E2E_RUN not set');
  rmSync(UNKNOWN_IDS_FILE, { force: true });
  const created = fixtures('create', runId);
  process.env['AUTH_E2E_FIXTURES'] = created;
  const { memberships, accounts, startedAt }: { memberships: string[]; accounts: string[]; startedAt: string } = JSON.parse(created);
  return () => {
    const unknownRequestIds = existsSync(UNKNOWN_IDS_FILE)
      ? readFileSync(UNKNOWN_IDS_FILE, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line !== '') : [];
    const result = fixtures('cleanup', runId, { AUTH_E2E_CLEANUP: JSON.stringify({ memberships, accounts, startedAt, unknownRequestIds }) });
    rmSync(UNKNOWN_IDS_FILE, { force: true });
    process.stdout.write(`[auth-e2e] cleanup ${result}\n`);
    const pwnedDir = process.env['AUTH_E2E_PWNED_DIR'];
    if (pwnedDir) {
      execFileSync('npx', ['tsx', 'test/support/pwnedFixtureCli.ts', 'remove', pwnedDir], { cwd: backendDir, shell: process.platform === 'win32', stdio: 'inherit' });
      process.stdout.write(`[auth-e2e] blocklist fixture removed: ${existsSync(pwnedDir) ? 'NO' : 'yes'}\n`);
    }
  };
}
