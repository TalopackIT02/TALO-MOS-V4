import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REGRESSION_FORMAT, regressionResultsDir, regressionResultsFile, regressionRunSchema } from '../../src/modules/system-test/system-test.results.js';
import type { RegressionRun, RegressionSuite } from '../../src/modules/system-test/system-test.results.js';
import { checkSmokeUrl } from '../smoke/dbSmoke.js';
import { SUITES, redact, testCounts } from './regression.support.js';
import type { SuiteDef } from './regression.support.js';

// MOD-TEST-01 — local Full Regression runner for the SYSTEM_TEST module (CLI only; the API never starts it).
//   npx tsx test/system-test/regression.cli.ts [--only KEY,KEY]      (from backend/)
// Rules: TEST database on localhost only (DATABASE_URL of ../.env must be talo_app@talo_mos_v4_test on 127.0.0.1 /
// localhost; NODE_ENV production refused); fixed suite list of regression.support.ts (no command, path or SQL from any input — --only
// selects keys of this list); one run at a time (exclusive lock file); per-suite timeout; exit code and a redacted
// summary (vitest summary lines only, URLs / credentials masked) written to the fixed results file read by
// GET /api/system-test/results. The suites keep their own fixture rules (C2: Foundation rows append-only; IAM fixtures
// removed by UUID with ownership proof).

const SUITE_TIMEOUT_MS = 20 * 60_000;
const BACKEND = resolve(import.meta.dirname, '../..');
const REPO = resolve(BACKEND, '..');
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-pid, 'SIGKILL');
}

function runSuite(suite: SuiteDef): Promise<RegressionSuite> {
  const started = Date.now();
  const command = `${Object.entries(suite.env ?? {}).map(([k, v]) => `${k}=${v} `).join('')}${suite.command} ${suite.args.join(' ')}`;
  return new Promise((done) => {
    let output = '';
    let timedOut = false;
    const child = spawn(suite.command, [...suite.args], {
      cwd: suite.cwd === 'backend' ? BACKEND : join(REPO, 'frontend'),
      env: { ...process.env, ...suite.env },
      shell: process.platform === 'win32', // npm / npx are .cmd shims on Windows; arguments are fixed constants
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 4_000_000) output = output.slice(-2_000_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, SUITE_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      const summary = redact(output);
      const status = timedOut ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL';
      done({ key: suite.key, label: suite.label, command, status, exitCode: timedOut ? null : code, durationMs: Date.now() - started, tests: testCounts(summary), summary });
    });
  });
}

function targetGuard(): RegressionRun['target'] {
  process.loadEnvFile(join(REPO, '.env'));
  if ((process.env['NODE_ENV'] ?? '').toLowerCase() === 'production') throw new Error('refused: NODE_ENV=production');
  const url = process.env['DATABASE_URL'];
  const check = checkSmokeUrl(url);
  if (!check.ok) throw new Error(`refused: DATABASE_URL must target talo_app@talo_mos_v4_test (${check.reason ?? ''})`);
  const host = new URL(url ?? '').hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error('refused: the TEST database must be on localhost');
  return { database: 'talo_mos_v4_test', host, nodeEnv: 'test' };
}

function selected(argv: readonly string[]): readonly SuiteDef[] {
  const i = argv.indexOf('--only');
  if (i < 0) return SUITES;
  const keys = (argv[i + 1] ?? '').split(',').filter((k) => k !== '');
  const unknown = keys.filter((k) => !SUITES.some((s) => s.key === k));
  if (keys.length === 0 || unknown.length > 0) throw new Error(`refused: --only takes keys of the fixed list (${SUITES.map((s) => s.key).join(', ')})`);
  return SUITES.filter((s) => keys.includes(s.key));
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Exclusive lock: a second runner refuses while the first is alive; a lock left by a dead process is replaced.
function acquireLock(file: string): () => void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => unlinkSync(file);
    } catch (error) {
      if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'EEXIST') throw error;
      const owner = Number(readFileSync(file, 'utf8'));
      if (Number.isInteger(owner) && owner > 0 && processAlive(owner)) throw new Error(`refused: another Full Regression run is in progress (pid ${owner})`);
      unlinkSync(file);
    }
  }
  throw new Error('refused: lock could not be acquired');
}

async function main(): Promise<number> {
  const suites = selected(process.argv.slice(2));
  const target = targetGuard();
  mkdirSync(regressionResultsDir(), { recursive: true });
  const release = acquireLock(join(regressionResultsDir(), 'regression.lock'));
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
  const startedAt = new Date().toISOString();
  const results: RegressionSuite[] = [];
  const write = (status: RegressionRun['status']) => {
    const run = regressionRunSchema.parse({ format: REGRESSION_FORMAT, runId, startedAt, finishedAt: new Date().toISOString(), target, status, suites: results });
    const file = regressionResultsFile();
    writeFileSync(`${file}.tmp`, `${JSON.stringify(run, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
    writeFileSync(join(regressionResultsDir(), `regression-${runId}.json`), `${JSON.stringify(run, null, 2)}\n`);
    return run;
  };
  try {
    for (const suite of suites) {
      process.stdout.write(`[system-test] ${suite.key} …\n`);
      const r = await runSuite(suite);
      results.push(r);
      process.stdout.write(`[system-test] ${suite.key} ${r.status} exit=${String(r.exitCode)} ${Math.round(r.durationMs / 1000)}s ${r.tests ? JSON.stringify(r.tests) : ''}\n`);
      write('ABORTED'); // partial progress is visible; replaced by the final status below
    }
    const run = write(results.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL');
    process.stdout.write(`[system-test] run ${runId} ${run.status} → ${regressionResultsFile()}\n`);
    return run.status === 'PASS' ? 0 : 1;
  } finally {
    release();
  }
}

main().then((code) => process.exit(code), (error: unknown) => {
  process.stderr.write(`[system-test] ${error instanceof Error ? error.message : 'runner failed'}\n`);
  process.exit(2);
});
