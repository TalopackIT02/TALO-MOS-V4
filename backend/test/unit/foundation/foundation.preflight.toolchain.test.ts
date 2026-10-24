import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { concludeRun, newRun, runPreflight } from '../../../src/modules/foundation/foundation.preflight.js';
import type { PreflightRun } from '../../../src/modules/foundation/foundation.preflight.js';
import { copyPackage, writeDeployments } from '../../../scripts/modules-sync.mjs';
import { hashPackage, walkPackage } from '../../../scripts/module-package.mjs';
import { validMic } from './mic.fixture.js';

// FMI-02 PF-03 / PF-04 / PF-05 / PF-06 — the preflight engine with the REAL toolchain (tsc of a staged Host backend and
// frontend, Vitest with the Host-owned configuration, the fixed host-smoke harness in a child process). Synthetic
// packages in a temporary modules/ folder; an EMPTY temporary deployment lock (the staging holds only the candidate);
// staging under a temporary store (backend side) and frontend/var/installer (removed by the engine). No database.

const BACKEND = join(import.meta.dirname, '..', '..', '..');
const roots: string[] = [];
const logs = new Map<string, string>();
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const write = (file: string, text: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

const BACKEND_ENTRY = (route: string, extra = '') => `import express from 'express';
import type { Request, RequestHandler, Response, Router } from 'express';
export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';
export const REQUIRED_CAPABILITIES: readonly string[] = ['session'];
interface Host { session(handler: (req: Request, res: Response, actor: unknown) => Promise<void>): RequestHandler }
export function createModule(host: Host): { router: Router } {
  const router = express.Router();
  router.get('${route}/orders', host.session(async (_req, res) => { res.status(200).json({ orders: [] }); }));
  router.post('${route}/orders', host.session(async (_req, res) => { res.status(201).json({}); }));
  ${extra}
  return { router };
}
`;
const FRONTEND_ENTRY = `function Main() { return <p>demo</p>; }
export const screens = { 'pkg.main': Main };
`;

function makePackage(modules: string, key: string, o: { backend?: string; micApi?: { method: string; path: string }[]; dbTest?: boolean } = {}) {
  const dir = join(modules, key);
  const route = `/${key.toLowerCase().replace(/_/g, '-')}`;
  const mic = validMic(key, '1.0.0');
  write(join(dir, 'module.json'), JSON.stringify({
    packageFormat: 'TALO-MODULE-PACKAGE-1', moduleKey: key, name: `Package ${key}`, packageVersion: '1.0.0', contractVersion: 'MIC-1.0', hostProtocol: 'TALO-MODULE-HOST-1',
    backendEntry: 'backend/index.ts', frontendEntry: 'frontend/Screen.tsx', micEntry: 'mic/pkg.mic.ts',
    frontend: { screens: [{ screenKey: 'pkg.main', name: 'Pkg', description: 'Màn hình', tabs: [{ label: 'Tab', path: route }] }] }, requiredCapabilities: ['session'],
  }));
  write(join(dir, 'backend', 'index.ts'), o.backend ?? BACKEND_ENTRY(route));
  write(join(dir, 'frontend', 'Screen.tsx'), FRONTEND_ENTRY);
  write(join(dir, 'mic', 'pkg.mic.ts'), 'export const mic = {};\n');
  write(join(dir, 'mic', 'module.mic.json'), JSON.stringify({
    ...mic,
    mic04Navigation: [{ menuLabel: 'Nhóm' }, { menuLabel: 'Đơn hàng', routePath: route, screenKey: 'pkg.main', functionKey: 'ORDER' }],
    mic05Api: (o.micApi ?? [{ method: 'GET', path: `/api${route}/orders` }, { method: 'POST', path: `/api${route}/orders` }]).map((a, i) => ({ ...a, functionKey: 'ORDER', actionKey: i === 0 ? 'READ' : 'CREATE', errors: [] })),
    mic06DataResources: [mic.mic06DataResources[0]],
  }));
  write(join(dir, 'tests', 'pkg.test.ts'), `import { describe, expect, it } from 'vitest';
import { HOST_PROTOCOL } from '../backend/index.js';
describe('package', () => { it('speaks the Host protocol', () => { expect(HOST_PROTOCOL).toBe('TALO-MODULE-HOST-1'); }); });
`);
  if (o.dbTest) write(join(dir, 'tests', 'pkg.db.test.ts'), 'export {};\n');
  return dir;
}

async function preflight(key: string, o: Parameters<typeof makePackage>[2] = {}): Promise<PreflightRun> {
  const base = mkdtempSync(join(BACKEND, 'var', 'installer', 'test-'));
  roots.push(base);
  const modules = join(base, 'modules');
  const source = makePackage(modules, key, o);
  const hash = hashPackage(source, walkPackage(source)).hash ?? '';
  const snapshot = join(base, 'candidate', 'package', key);
  copyPackage(source, snapshot, hash);
  const lockFile = join(base, 'module-deployments.json');
  writeDeployments(lockFile, []);
  const run = newRun({ runId: '00000000-0000-4000-8000-0000000000aa', candidateId: '00000000-0000-4000-8000-0000000000bb', moduleKey: key, packageVersion: '1.0.0', packageHash: hash,
    environment: { label: 'TEST', database: 'talo_mos_v4_test', nodeEnv: 'test' }, startedBy: 'test', startedAt: new Date().toISOString() });
  await runPreflight(run, { candidateId: run.candidateId, moduleKey: key, folder: key, sourceHash: hash, snapshotDir: snapshot }, {
    paths: { backendDir: BACKEND, frontendDir: join(BACKEND, '..', 'frontend'), modulesRoot: modules, releasesDir: join(base, 'releases'), lockFile },
    registry: { read: async () => ({ moduleKeys: new Set(), versions: [] }) },
    db: { query: async () => { throw new Error('no table expected'); } },
    stagingRoot: join(base, 'staging'),
    writeLog: (id, content) => { logs.set(`${key}/${id}`, content); return `logs/${id}.log`; },
  });
  return concludeRun(run);
}
const status = (run: PreflightRun) => Object.fromEntries(run.checks.map((c) => [c.key, c.status]));

describe('FMI-02 preflight with the real toolchain', { timeout: 300_000 }, () => {
  it('PF-01 / PF-03 / PF-05 / PF-09: a valid package → every check PASS with real tsc / Vitest / Host harness → READY', async () => {
    const run = await preflight('FBET_PF_OK');
    expect(run.checks.filter((c) => c.status !== 'PASS').map((c) => `${c.key}:${c.status} ${c.status === 'FAIL' ? (logs.get(`FBET_PF_OK/${c.id}`) ?? '').slice(0, 600) : ''}`.trim())).toEqual(['DATABASE_TESTS:NOT_APPLICABLE', 'AUTHENTICATED_IAM_SMOKE:NOT_TESTED']);
    expect(run.result).toBe('READY');
    expect(run.checks.find((c) => c.key === 'BACKEND_TYPECHECK')?.exitCode).toBe(0);
    expect(run.checks.find((c) => c.key === 'PACKAGE_TESTS')?.detail).toContain('1 passed');
    expect(run.checks.find((c) => c.key === 'RUNTIME_SMOKE')?.detail).toBe('2/2 endpoint trả 401 đúng envelope khi không có phiên.');
    for (const c of run.checks.filter((x) => x.reference !== null)) expect(c.logHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PF-03 / PF-04 / PF-06: a type error, an API declared in MIC-05 but not mounted, a route mounted but not declared, a DB test → FAIL / NOT_TESTED → NEEDS_FIX', async () => {
    const route = '/fbet-pf-bad';
    const run = await preflight('FBET_PF_BAD', {
      backend: BACKEND_ENTRY(route, `router.get('${route}/secret', (_req, res) => { res.status(200).json({ leaked: true }); });\n  const n: number = 'not a number';\n  void n;`),
      micApi: [{ method: 'GET', path: `/api${route}/orders` }, { method: 'POST', path: `/api${route}/orders` }, { method: 'GET', path: `/api${route}/missing` }],
      dbTest: true,
    });
    expect(status(run)).toMatchObject({ PACKAGE_INTEGRITY: 'PASS', STATIC_SCAN: 'PASS', BACKEND_TYPECHECK: 'FAIL', FRONTEND_TYPECHECK: 'PASS', PACKAGE_TESTS: 'PASS',
      HOST_HANDSHAKE: 'FAIL', RUNTIME_SMOKE: 'FAIL', DATABASE_TESTS: 'NOT_TESTED', INSTALLED_RUNTIME: 'PASS' });
    expect(run.result).toBe('NEEDS_FIX');
    const p4 = run.checks.find((c) => c.key === 'HOST_HANDSHAKE');
    expect(p4?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'mic05Api', expected: 'GET /fbet-pf-bad/missing', actual: '(không có)' }),
      expect.objectContaining({ field: 'mic05Api', expected: '(khai báo)', actual: 'GET /fbet-pf-bad/secret' }),
    ]));
    // the missing endpoint answers 404 (not mounted) — reported with the endpoint, never PASS
    expect(run.checks.find((c) => c.key === 'RUNTIME_SMOKE')?.issues).toEqual([expect.objectContaining({ field: 'GET /api/fbet-pf-bad/missing', actual: '404 (không phải envelope)' })]);
    // the compiler error itself is an issue (file:line:col of the staged package + TS code), not only a log hash
    expect(run.checks.find((c) => c.key === 'BACKEND_TYPECHECK')?.issues).toEqual([expect.objectContaining({ path: expect.stringMatching(/^FBET_PF_BAD\/backend\/index\.ts:\d+:\d+$/), message: expect.stringContaining('TS2322') })]);
    expect(run.checks.find((c) => c.key === 'DATABASE_TESTS')?.limitations.join(' ')).toContain('database staging cô lập');
  });
});
