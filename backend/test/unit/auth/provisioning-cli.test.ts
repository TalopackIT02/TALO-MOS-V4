import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Provisioning CLI guards that act BEFORE any database connection (dummy URL to a closed port, no real secret).

const cli = resolve(import.meta.dirname, '../../../src/modules/auth/provisioning/cli.ts');
const FAKE_SECRET = 'not-a-real-secret-7f3a';
const run = (args: string[], url: string | undefined) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['PROVISIONER_DATABASE_URL'];
  if (url !== undefined) env['PROVISIONER_DATABASE_URL'] = url;
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};

describe('provisioning CLI guards (no database)', { timeout: 60_000 }, () => {
  it('requires PROVISIONER_DATABASE_URL, the talo_provisioner role and an interactive terminal — and never echoes the URL', () => {
    const missing = run(['--reissue', '--username', 'x'], undefined);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('PROVISIONER_DATABASE_URL is not set');

    const wrongRole = run(['--reissue', '--username', 'x'], `postgresql://talo_app:${FAKE_SECRET}@127.0.0.1:1/talo_mos_v4_test`);
    expect(wrongRole.status).toBe(1);
    expect(wrongRole.stderr).toContain('must use role talo_provisioner');

    const nonTty = run(['--employee-code', 'X', '--full-name', 'X', '--username', 'x', '--joined-at', '2026-10-01'],
      `postgresql://talo_provisioner:${FAKE_SECRET}@127.0.0.1:1/talo_mos_v4_test`);
    expect(nonTty.status).toBe(1);
    expect(nonTty.stderr).toContain('refusing to print a temporary password to a non-interactive output');

    const output = [missing, wrongRole, nonTty].map((r) => `${r.stdout}${r.stderr}`).join('');
    expect(output.includes(FAKE_SECRET)).toBe(false);
    expect(output.includes('postgresql://')).toBe(false);
  });
});
