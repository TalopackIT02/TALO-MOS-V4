import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { readPackage } from '../../../src/modules/foundation/foundation.module-scan.files.js';
import type { PackageFacts } from '../../../src/modules/foundation/foundation.module-scan.files.js';
import { moduleScanRouter } from '../../../src/modules/foundation/foundation.module-scan.routes.js';
import { MODULE_SCAN_SQL, ModuleScanService, SNAPSHOT_TTL_MS, SqlModuleScanRegistry } from '../../../src/modules/foundation/foundation.module-scan.service.js';
import { RESERVED_PREFIXES, RESERVED_ROUTES } from '../../../src/modules/foundation/foundation.module-scan.types.js';
import type { ModuleScanRegistry, RegisteredVersion, RegistryFacts, ScanReport, ScannedModule } from '../../../src/modules/foundation/foundation.module-scan.types.js';
import { compareSemver } from '../../../src/modules/foundation/foundation.module-scan.validation.js';
import { FOUNDATION_SQL, SqlFoundationRepository } from '../../../src/modules/foundation/foundation.repository.js';
import { hashPackage, walkPackage } from '../../../scripts/module-package.mjs';
import { ACCOUNT_A, FakeAuth, FakeDb, PERM_CREATE_ID, PERM_READ_ID, TEST_ORIGIN, VALID_ROLE, defaultIam, pgError, token } from './fakes.js';
import { validMic } from './mic.fixture.js';

// FMI-01 — Manual Module Scan (unit / API level): real router, service, AccessGuard and evaluator over FakeDb (IAM facts,
// B08), a fake Registry and a temporary modules/ folder per test. No real database, no real repository modules/.

const TOKEN = token('moduleScanSessionToken');
const MA = { action: 3, outcome: 6 } as const;
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'fmi01-'));
  roots.push(root);
  const modules = join(root, 'modules');
  mkdirSync(modules);
  return modules;
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
const slug = (key: string) => `/${key.toLowerCase().replace(/_/g, '-')}`;

interface PackageOptions {
  readonly key?: string;
  readonly version?: string;
  readonly manifest?: Record<string, unknown> | null; // overrides; null = no module.json
  readonly mic?: unknown; // undefined = valid MIC JSON; null = none; string = raw text
  readonly routes?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
}
function writePackage(modules: string, folder: string, o: PackageOptions = {}): string {
  const dir = join(modules, folder);
  const key = o.key ?? folder;
  const version = o.version ?? '1.0.0';
  write(join(dir, 'backend', 'index.ts'), 'export const HOST_PROTOCOL = "TALO-MODULE-HOST-1";\n');
  write(join(dir, 'frontend', 'Screen.tsx'), 'export const screens = {};\n');
  write(join(dir, 'mic', 'pkg.mic.ts'), 'export const mic = {};\n');
  if (o.manifest !== null) {
    write(join(dir, 'module.json'), JSON.stringify({
      packageFormat: 'TALO-MODULE-PACKAGE-1', moduleKey: key, name: `Package ${key}`, packageVersion: version, contractVersion: 'MIC-1.0',
      hostProtocol: 'TALO-MODULE-HOST-1', backendEntry: 'backend/index.ts', frontendEntry: 'frontend/Screen.tsx', micEntry: 'mic/pkg.mic.ts',
      frontend: { screens: [{ screenKey: 'pkg.main', name: 'Pkg', description: 'Màn hình', tabs: (o.routes ?? [slug(key)]).map((path, i) => ({ label: `Tab ${i}`, path })) }] },
      requiredCapabilities: ['session', 'authorize'], ...(o.manifest ?? {}),
    }, null, 2));
  }
  if (o.mic !== null) write(join(dir, 'mic', 'module.mic.json'), typeof o.mic === 'string' ? o.mic : JSON.stringify(o.mic ?? validMic(key, version)));
  for (const [rel, text] of Object.entries(o.files ?? {})) write(join(dir, ...rel.split('/')), text);
  return dir;
}

const EMPTY: RegistryFacts = { moduleKeys: new Set(), versions: [] };
const registryOf = (versions: readonly RegisteredVersion[], extraKeys: readonly string[] = []): ModuleScanRegistry => ({
  read: async () => ({ moduleKeys: new Set([...versions.map((v) => v.moduleKey), ...extraKeys]), versions }),
});

function build(modules: string, o: { registry?: ModuleScanRegistry; grants?: readonly string[]; now?: () => number; readPackage?: (r: string, f: string, u: boolean) => PackageFacts } = {}) {
  const iam = defaultIam();
  iam.grants = (o.grants ?? [PERM_READ_ID, PERM_CREATE_ID]).map((permissionId) => ({ accountId: ACCOUNT_A, permissionId, row: VALID_ROLE }));
  const db = new FakeDb(iam);
  const auth = new FakeAuth();
  auth.authenticated(TOKEN, ACCOUNT_A);
  const logs: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  const service = new ModuleScanService({
    access: new SqlFoundationRepository(db), registry: o.registry ?? { read: async () => EMPTY }, logger, modulesRoot: modules,
    ...(o.now ? { now: o.now } : {}), ...(o.readPackage ? { readPackage: o.readPackage } : {}),
  });
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [moduleScanRouter({ authService: auth, service, secureCookie: false })] });
  return { app, db, logs, service };
}
const post = (app: ReturnType<typeof build>['app'], body: unknown = {}, cookie = `talo_sid=${TOKEN}`) =>
  request(app).post('/api/foundation/module-packages/scan').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify(body));
const getScan = (app: ReturnType<typeof build>['app'], id: string) => request(app).get(`/api/foundation/module-packages/scans/${id}`).set('Cookie', `talo_sid=${TOKEN}`);
async function scan(modules: string, o: Parameters<typeof build>[1] = {}): Promise<ScanReport> {
  const res = await post(build(modules, o).app);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body;
}
const one = (r: ScanReport, folder: string): ScannedModule => {
  const m = r.modules.find((x) => x.folder === folder);
  if (!m) throw new Error(`folder ${folder} not in report`);
  return m;
};
const check = (m: ScannedModule, id: string) => m.checks.find((c) => c.id === id);
const codes = (m: ScannedModule) => m.issues.map((i) => i.code);

describe('FMI-01 scan — package rules (MS-01 … MS-20)', () => {
  it('T02 a valid new package: NEW_MODULE, every static check PASS, MIC-10 only declared (WARN), eligible for Preflight, real SHA-256', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'CUSTOMER_MANAGEMENT', { version: '0.1.0' });
    const r = await scan(modules);
    expect(Object.keys(r).sort()).toEqual(['durationMs', 'modules', 'registryAvailable', 'scanId', 'scannedAt', 'status', 'summary']);
    expect(r.status).toBe('COMPLETED');
    expect(new Date(r.scannedAt).toISOString()).toBe(r.scannedAt);
    expect(r.summary).toEqual({ total: 1, passed: 0, warnings: 1, failed: 0, unavailable: 0 });
    const m = one(r, 'CUSTOMER_MANAGEMENT');
    expect(m).toMatchObject({ moduleKey: 'CUSTOMER_MANAGEMENT', packageVersion: '0.1.0', classification: 'NEW_MODULE', foundationVersionStatus: null, micFormat: 'JSON', eligibleForPreflight: true, scanStatus: 'WARN' });
    expect(m.checks.map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `MS-${String(i + 1).padStart(2, '0')}`));
    expect(m.checks.filter((c) => c.status !== 'PASS').map((c) => [c.id, c.status, c.code])).toEqual([['MS-19', 'WARN', 'TEST_EVIDENCE_UNVERIFIED']]);
    expect(m.packageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.packageHash).not.toBe('0'.repeat(64));
    expect(JSON.stringify(r)).not.toContain(modules); // no absolute path
  });

  it('T03 / T16 a folder without module.json is listed with MODULE_MANIFEST_MISSING; other folders are still evaluated; root files are not packages', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'GOOD_ONE');
    writePackage(modules, 'NO_MANIFEST', { manifest: null });
    writePackage(modules, 'bad name');
    writeFileSync(join(modules, 'SOME.zip'), 'zip');
    const r = await scan(modules);
    expect(r.modules.map((m) => m.folder)).toEqual(['GOOD_ONE', 'NO_MANIFEST', 'bad name']);
    expect(one(r, 'GOOD_ONE').scanStatus).toBe('WARN');
    expect(one(r, 'NO_MANIFEST')).toMatchObject({ classification: 'INVALID_PACKAGE', scanStatus: 'FAIL', eligibleForPreflight: false, moduleKey: null });
    expect(codes(one(r, 'NO_MANIFEST'))).toContain('MODULE_MANIFEST_MISSING');
    expect(check(one(r, 'bad name'), 'MS-01')).toMatchObject({ status: 'FAIL', code: 'MODULE_FOLDER_INVALID' });
    expect(r.summary).toEqual({ total: 3, passed: 0, warnings: 1, failed: 2, unavailable: 0 });
  });

  it('T04 / T05 wrong packageFormat and a key different from the folder: FAIL with expected / actual, not eligible', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'FORMAT_BAD', { manifest: { packageFormat: 'OTHER-1' } });
    writePackage(modules, 'KEY_FOLDER', { key: 'OTHER_KEY' });
    const r = await scan(modules);
    const f = one(r, 'FORMAT_BAD');
    expect(f).toMatchObject({ scanStatus: 'FAIL', eligibleForPreflight: false });
    expect(f.issues.find((i) => i.code === 'PACKAGE_FORMAT_UNSUPPORTED')).toMatchObject({ field: 'packageFormat', expected: 'TALO-MODULE-PACKAGE-1', actual: 'OTHER-1', path: 'FORMAT_BAD/module.json' });
    const k = one(r, 'KEY_FOLDER');
    expect(k.issues.find((i) => i.code === 'MODULE_KEY_MISMATCH')).toMatchObject({ expected: 'KEY_FOLDER', actual: 'OTHER_KEY' });
    expect(k.eligibleForPreflight).toBe(false);
  });

  it('MS-06 / MS-07 / MS-08 / MS-09 / MS-11: SemVer, Host protocol, capability, missing entry, screen syntax, duplicate route in one package', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'BAD_VERSION', { manifest: { packageVersion: '1.0' } });
    writePackage(modules, 'BAD_HOST', { manifest: { hostProtocol: 'TALO-MODULE-HOST-2' } });
    writePackage(modules, 'BAD_CAP', { manifest: { requiredCapabilities: ['session', 'shell'] } });
    writePackage(modules, 'NO_ENTRY', { manifest: { backendEntry: 'backend/missing.ts' } });
    writePackage(modules, 'BAD_ROUTE', { routes: ['/Bad_Route'] });
    writePackage(modules, 'DUP_ROUTE', { routes: ['/dup-route', '/dup-route'] });
    const r = await scan(modules);
    expect(codes(one(r, 'BAD_VERSION'))).toContain('MODULE_VERSION_INVALID');
    expect(check(one(r, 'BAD_HOST'), 'MS-07')).toMatchObject({ status: 'FAIL', code: 'HOST_PROTOCOL_UNSUPPORTED' });
    expect(check(one(r, 'BAD_CAP'), 'MS-08')).toMatchObject({ status: 'FAIL', code: 'CAPABILITY_UNSUPPORTED' });
    expect(check(one(r, 'NO_ENTRY'), 'MS-09')).toMatchObject({ status: 'FAIL', code: 'MODULE_ENTRY_MISSING' });
    expect(check(one(r, 'BAD_ROUTE'), 'MS-11')).toMatchObject({ status: 'FAIL', code: 'MODULE_SCREEN_INVALID' });
    expect(check(one(r, 'DUP_ROUTE'), 'MS-11')).toMatchObject({ status: 'FAIL', code: 'MODULE_ROUTE_CONFLICT' });
  });

  it('T06 MIC JSON missing / invalid / wrong schema → FAIL; a legacy TypeScript MIC of a REGISTERED module → WARN (never imported), of a new module → FAIL', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'NO_MIC', { mic: null, manifest: { micEntry: 'mic/absent.mic.ts' } });
    writePackage(modules, 'BAD_JSON', { mic: '{ not json' });
    writePackage(modules, 'BAD_SCHEMA', { mic: { ...validMic('BAD_SCHEMA'), mic02Functions: 'x' } });
    writePackage(modules, 'LEGACY_OLD', { mic: null, version: '2.0.0' });
    writePackage(modules, 'LEGACY_NEW', { mic: null });
    const r = await scan(modules, { registry: registryOf([{ moduleKey: 'LEGACY_OLD', moduleVersion: '1.0.0', status: 'ACTIVE', activeRoutes: ['/legacy-old'] }]) });
    expect(one(r, 'NO_MIC')).toMatchObject({ micFormat: 'MISSING', scanStatus: 'FAIL' });
    expect(codes(one(r, 'NO_MIC'))).toContain('MIC_FILE_MISSING');
    expect(one(r, 'BAD_JSON')).toMatchObject({ micFormat: 'INVALID', scanStatus: 'FAIL' });
    expect(codes(one(r, 'BAD_JSON'))).toContain('MIC_JSON_INVALID');
    expect(one(r, 'BAD_SCHEMA').issues.find((i) => i.code === 'MIC_SCHEMA_INVALID')).toMatchObject({ field: 'mic02Functions', path: 'BAD_SCHEMA/mic/module.mic.json' });
    const legacy = one(r, 'LEGACY_OLD');
    expect(legacy).toMatchObject({ micFormat: 'LEGACY_TS', scanStatus: 'WARN', eligibleForPreflight: false, classification: 'UPGRADE_CANDIDATE' });
    expect(check(legacy, 'MS-12')).toMatchObject({ status: 'WARN', code: 'LEGACY_MIC_FORMAT' });
    expect(one(r, 'LEGACY_NEW')).toMatchObject({ micFormat: 'LEGACY_TS', scanStatus: 'FAIL' });
    expect(check(one(r, 'LEGACY_NEW'), 'MS-12')?.code).toBe('MIC_FILE_MISSING');
  });

  it('T07 / T08 MIC-01 version ≠ packageVersion and a MIC-07 K05 mismatch: FAIL with the exact field', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'ID_BAD', { version: '1.0.0', mic: validMic('ID_BAD', '1.0.1') });
    const k05 = validMic('K05_BAD');
    writePackage(modules, 'K05_BAD', { mic: { ...k05, mic07IamMapping: k05.mic07IamMapping.map((x, i) => (i === 0 ? { ...x, resourceCode: 'OTHER' } : x)) } });
    const r = await scan(modules);
    expect(one(r, 'ID_BAD').issues.find((i) => i.code === 'MIC_IDENTITY_MISMATCH')).toMatchObject({ field: 'mic01Identity.moduleVersion', expected: '1.0.0', actual: '1.0.1' });
    expect(one(r, 'K05_BAD').issues.find((i) => i.code === 'MIC_MAPPING_INVALID')).toMatchObject({ field: 'mic07IamMapping', actual: 'IAM_MAPPING_K05_MISMATCH' });
    expect(one(r, 'K05_BAD').scanStatus).toBe('FAIL');
  });

  it('T09 MIC-10 NOT_TESTED → WARN TEST_EVIDENCE_PENDING; declared PASS → WARN TEST_EVIDENCE_UNVERIFIED; never more than a preview', async () => {
    const modules = tmpRoot();
    const pending = validMic('PENDING_MOD');
    writePackage(modules, 'PENDING_MOD', { mic: { ...pending, mic10Manifest: { ...pending.mic10Manifest, testEvidence: [{ name: 'x', result: 'NOT_TESTED', reference: 'y' }] } } });
    writePackage(modules, 'DECLARED_MOD');
    const r = await scan(modules);
    expect(check(one(r, 'PENDING_MOD'), 'MS-19')).toMatchObject({ status: 'WARN', code: 'TEST_EVIDENCE_PENDING' });
    expect(check(one(r, 'DECLARED_MOD'), 'MS-19')).toMatchObject({ status: 'WARN', code: 'TEST_EVIDENCE_UNVERIFIED' });
    for (const m of r.modules) expect(m.scanStatus).not.toBe('PASS');
    expect(JSON.stringify(r)).not.toMatch(/READY|ACTIVATE/);
  });

  it('T10 / T11 routes: two packages on one route, an AppShell admin route, a route of ANOTHER active module → FAIL; an upgrade keeping its own route → no conflict', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'ROUTE_A', { routes: ['/shared'] });
    writePackage(modules, 'ROUTE_B', { routes: ['/shared'] });
    writePackage(modules, 'ADMIN_CLASH', { routes: ['/iam/roles'] });
    writePackage(modules, 'TAKES_OTHER', { routes: ['/system-test'] });
    const st = validMic('SYS_UP', '1.2.0');
    writePackage(modules, 'SYS_UP', { version: '1.2.0', routes: ['/sys-up'], mic: { ...st, mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.0', changes: ['Nâng cấp'] } } });
    const r = await scan(modules, { registry: registryOf([
      { moduleKey: 'SYSTEM_X', moduleVersion: '1.0.0', status: 'ACTIVE', activeRoutes: ['/system-test'] },
      { moduleKey: 'SYS_UP', moduleVersion: '1.0.0', status: 'ACTIVE', activeRoutes: ['/sys-up'] },
    ]) });
    for (const f of ['ROUTE_A', 'ROUTE_B', 'ADMIN_CLASH', 'TAKES_OTHER']) expect([f, check(one(r, f), 'MS-16')?.code]).toEqual([f, 'MODULE_ROUTE_CONFLICT']);
    expect(one(r, 'ROUTE_A').issues.find((i) => i.code === 'MODULE_ROUTE_CONFLICT')?.message).toContain('ROUTE_B');
    const up = one(r, 'SYS_UP');
    expect(up).toMatchObject({ classification: 'UPGRADE_CANDIDATE', eligibleForPreflight: true });
    expect(check(up, 'MS-16')?.status).toBe('PASS');
    expect(check(up, 'MS-18')).toMatchObject({ status: 'PASS', code: 'MIC_COMPATIBILITY_VALID' });
  });

  // FMI-02/03 CL-03 / CL-05: a fixture claiming a product route is flagged (FAIL while enabled, WARN with its key once
  // disabled — never silently ignored); a fixture in its own namespace does not touch the product module.
  it('CL-03 / CL-05: route held by an ENABLED fixture → FAIL; by a DISABLED fixture → WARN naming it; a namespaced fixture → no conflict', async () => {
    const modules = tmpRoot();
    const mic = validMic('SYS_UP', '1.2.0');
    writePackage(modules, 'SYS_UP', { version: '1.2.0', routes: ['/sys-up'], mic: { ...mic, mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.0', changes: ['Nâng cấp'] } } });
    const own = { moduleKey: 'SYS_UP', moduleVersion: '1.0.0', status: 'ACTIVE' as const, activeRoutes: ['/sys-up'] };
    const holder = { moduleKey: 'FBET_ST_RUN1', moduleVersion: '1.1.1', status: 'ACTIVE' as const, activeRoutes: ['/sys-up'] };
    const enabled = one(await scan(modules, { registry: registryOf([own, { ...holder, moduleEnabled: true }]) }), 'SYS_UP');
    expect(check(enabled, 'MS-16')).toMatchObject({ status: 'FAIL', code: 'MODULE_ROUTE_CONFLICT' });
    expect(enabled.eligibleForPreflight).toBe(false);
    const unknown = one(await scan(modules, { registry: registryOf([own, holder]) }), 'SYS_UP');
    expect(check(unknown, 'MS-16')?.status).toBe('FAIL'); // enabled state unknown → fail closed
    const disabled = one(await scan(modules, { registry: registryOf([own, { ...holder, moduleEnabled: false }]) }), 'SYS_UP');
    expect(check(disabled, 'MS-16')).toMatchObject({ status: 'WARN', code: 'ROUTE_RESERVED_BY_DISABLED_MODULE' });
    expect(disabled.issues.find((i) => i.code === 'ROUTE_RESERVED_BY_DISABLED_MODULE')?.message).toContain('FBET_ST_RUN1');
    expect(disabled.eligibleForPreflight).toBe(true);
    const isolated = one(await scan(modules, { registry: registryOf([own, { ...holder, activeRoutes: ['/fbet-st-run1/sys-up'], moduleEnabled: true }]) }), 'SYS_UP');
    expect(check(isolated, 'MS-16')?.status).toBe('PASS');
  });

  it('MS-18 MIC-09: CHANGE from a version that does not exist / INITIAL_REGISTRATION while versions exist → FAIL (MIC is not corrected)', async () => {
    const modules = tmpRoot();
    const a = validMic('COMPAT_A', '1.1.0');
    writePackage(modules, 'COMPAT_A', { version: '1.1.0', mic: { ...a, mic09Compatibility: { kind: 'CHANGE', fromVersion: '0.9.0', changes: ['x'] } } });
    writePackage(modules, 'COMPAT_B', { version: '1.1.0', mic: validMic('COMPAT_B', '1.1.0') });
    const r = await scan(modules, { registry: registryOf([
      { moduleKey: 'COMPAT_A', moduleVersion: '1.0.0', status: 'APPROVED', activeRoutes: null },
      { moduleKey: 'COMPAT_B', moduleVersion: '1.0.0', status: 'ACTIVE', activeRoutes: [] },
    ]) });
    expect(one(r, 'COMPAT_A').issues.find((i) => i.code === 'MIC_COMPATIBILITY_INVALID')).toMatchObject({ field: 'mic09Compatibility', actual: 'CHANGE from 0.9.0' });
    expect(check(one(r, 'COMPAT_B'), 'MS-18')).toMatchObject({ status: 'FAIL', code: 'MIC_COMPATIBILITY_INVALID' });
  });

  it('T12 Registry unavailable: REGISTRY_UNKNOWN, MS-17 / MS-18 UNAVAILABLE, never NEW_MODULE, not eligible', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'NEW_ONE');
    const r = await scan(modules, { registry: { read: async () => { throw pgError('57014'); } } });
    expect(r.registryAvailable).toBe(false);
    const m = one(r, 'NEW_ONE');
    expect(m).toMatchObject({ classification: 'REGISTRY_UNKNOWN', scanStatus: 'UNAVAILABLE', eligibleForPreflight: false });
    expect(check(m, 'MS-17')).toMatchObject({ status: 'UNAVAILABLE', code: 'REGISTRY_UNAVAILABLE' });
    expect(check(m, 'MS-18')?.status).toBe('UNAVAILABLE');
    expect(r.summary.unavailable).toBe(1);
  });

  it('T13 an existing APPROVED / ACTIVE version is locked (not eligible, integrity unverified); OLDER_PACKAGE; SemVer is numeric (1.10.0 > 1.9.0)', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'LOCKED_MOD', { version: '1.0.0' });
    writePackage(modules, 'OLD_MOD', { version: '1.9.0' });
    writePackage(modules, 'DRAFT_MOD', { version: '2.0.0', mic: { ...validMic('DRAFT_MOD', '2.0.0'), mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.0', changes: ['x'] } } });
    const r = await scan(modules, { registry: registryOf([
      { moduleKey: 'LOCKED_MOD', moduleVersion: '1.0.0', status: 'ACTIVE', activeRoutes: ['/locked-mod'] },
      { moduleKey: 'OLD_MOD', moduleVersion: '1.10.0', status: 'APPROVED', activeRoutes: null },
      { moduleKey: 'DRAFT_MOD', moduleVersion: '1.0.0', status: 'ACTIVE', activeRoutes: ['/draft-mod'] },
      { moduleKey: 'DRAFT_MOD', moduleVersion: '2.0.0', status: 'DRAFT', activeRoutes: null },
    ]) });
    const locked = one(r, 'LOCKED_MOD');
    expect(locked).toMatchObject({ classification: 'EXISTING_VERSION', foundationVersionStatus: 'ACTIVE', eligibleForPreflight: false, scanStatus: 'WARN' });
    expect(codes(locked)).toEqual(expect.arrayContaining(['VERSION_ALREADY_LOCKED', 'INTEGRITY_UNVERIFIED']));
    expect(one(r, 'OLD_MOD')).toMatchObject({ classification: 'OLDER_PACKAGE', eligibleForPreflight: false });
    expect(one(r, 'DRAFT_MOD')).toMatchObject({ classification: 'EXISTING_VERSION', foundationVersionStatus: 'DRAFT', eligibleForPreflight: true });
    expect([compareSemver('1.10.0', '1.9.0'), compareSemver('1.9.0', '1.10.0'), compareSemver('2.0.0', '2.0.0')]).toEqual([1, -1, 0]);
  });

  it('a module registered in B01 without any version is not NEW_MODULE', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'EMPTY_REG');
    const r = await scan(modules, { registry: registryOf([], ['EMPTY_REG']) });
    expect(one(r, 'EMPTY_REG').classification).toBe('UPGRADE_CANDIDATE');
  });
});

describe('FMI-01 scan — filesystem safety, limits and hash', () => {
  it('T17 junction to an outside folder, junction / .env inside a package: never followed or read; issues PATH_UNSAFE / SENSITIVE_FILE', async () => {
    const modules = tmpRoot();
    const outside = mkdtempSync(join(tmpdir(), 'fmi01-outside-'));
    roots.push(outside);
    writePackage(outside, 'EXTERNAL_PKG');
    symlinkSync(join(outside, 'EXTERNAL_PKG'), join(modules, 'EXTERNAL_PKG'), 'junction');
    writePackage(modules, 'INNER_LINK');
    symlinkSync(join(outside, 'EXTERNAL_PKG'), join(modules, 'INNER_LINK', 'backend', 'linked'), 'junction');
    writePackage(modules, 'HAS_SECRET', { files: { '.env': 'DATABASE_URL=postgres://u:secret-value@h/db', 'config/server.key': 'KEY' } });
    const r = await scan(modules);
    const ext = one(r, 'EXTERNAL_PKG');
    expect(ext).toMatchObject({ scanStatus: 'FAIL', moduleKey: null, packageHash: null, fileCount: 0 });
    expect(check(ext, 'MS-01')?.code).toBe('PATH_UNSAFE');
    expect(one(r, 'INNER_LINK').issues.find((i) => i.code === 'PATH_UNSAFE')?.path).toBe('INNER_LINK/backend/linked');
    expect(one(r, 'INNER_LINK').packageHash).toBeNull();
    const secret = one(r, 'HAS_SECRET');
    expect(secret.issues.filter((i) => i.code === 'SENSITIVE_FILE').map((i) => i.path).sort()).toEqual(['HAS_SECRET/.env', 'HAS_SECRET/config/server.key']);
    expect(secret.eligibleForPreflight).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/secret-value|DATABASE_URL/);
  });

  it('limits: more than 1500 files in a package → SCAN_LIMIT_EXCEEDED (no hash); more than 250 folders → 413', async () => {
    const modules = tmpRoot();
    const files: Record<string, string> = {};
    for (let i = 0; i < 1500; i += 1) files[`data/f${i}.txt`] = 'x';
    writePackage(modules, 'TOO_MANY', { files });
    const r = await scan(modules);
    expect(check(one(r, 'TOO_MANY'), 'MS-20')).toMatchObject({ status: 'FAIL', code: 'SCAN_LIMIT_EXCEEDED' });
    expect(one(r, 'TOO_MANY').packageHash).toBeNull();
    const many = tmpRoot();
    for (let i = 0; i < 251; i += 1) mkdirSync(join(many, `PKG_${i}`));
    const res = await post(build(many).app);
    expect([res.status, res.body.error.code]).toEqual([413, 'SCAN_LIMIT_EXCEEDED']);
  });

  it('T18 hash: deterministic whatever the creation order, CRLF = LF, changes with content; a change during the read gives no hash (PACKAGE_CHANGED_DURING_SCAN)', async () => {
    const a = tmpRoot();
    const b = tmpRoot();
    writePackage(a, 'HASHED', { files: { 'z.txt': 'z', 'a.txt': 'line1\nline2\n' } });
    writePackage(b, 'HASHED', { files: { 'a.txt': 'line1\r\nline2\r\n', 'z.txt': 'z' } });
    const ha = hashPackage(join(a, 'HASHED'), walkPackage(join(a, 'HASHED')));
    const hb = hashPackage(join(b, 'HASHED'), walkPackage(join(b, 'HASHED')));
    expect(ha.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hb.hash).toBe(ha.hash);
    const app = build(a).app;
    const first = (await post(app)).body as ScanReport;
    writeFileSync(join(a, 'HASHED', 'a.txt'), 'changed');
    const second = (await post(app)).body as ScanReport;
    expect(one(second, 'HASHED').packageHash).not.toBe(one(first, 'HASHED').packageHash);
    expect((await getScan(app, first.scanId)).body).toEqual(first); // the old snapshot is not updated
    // A file modified between the listing and the hash.
    const dir = join(a, 'HASHED');
    const walk = walkPackage(dir);
    writeFileSync(join(dir, 'z.txt'), 'zz-modified');
    expect(hashPackage(dir, walk)).toEqual({ hash: null, changed: true });
    const raced = await scan(a, { readPackage: (root, folder, unsafe) => ({ ...readPackage(root, folder, unsafe), hash: null, changed: true }) });
    expect(check(one(raced, 'HASHED'), 'MS-20')).toMatchObject({ status: 'FAIL', code: 'PACKAGE_CHANGED_DURING_SCAN' });
    expect(one(raced, 'HASHED')).toMatchObject({ packageHash: null, eligibleForPreflight: false });
  });

  it('the reserved AppShell routes are exactly the admin / auth screens of the frontend', () => {
    const screens = readFileSync(join(import.meta.dirname, '../../../../frontend/src/routes/shellScreens.ts'), 'utf8');
    const paths = [...screens.matchAll(/path: '([^']+)'/g)].map((x) => x[1] ?? '');
    for (const p of paths) expect(RESERVED_ROUTES).toContain(p);
    const app = readFileSync(join(import.meta.dirname, '../../../../frontend/src/routes/navigation.ts'), 'utf8');
    for (const p of ['/login', '/first-change']) expect(app).toContain(`'${p}'`);
    expect(RESERVED_PREFIXES).toEqual(['/iam/accounts/']);
  });

  it('the scanner source never imports, executes or syncs package code', () => {
    for (const f of ['files', 'validation', 'service', 'routes', 'types']) {
      const src = readFileSync(join(import.meta.dirname, `../../../src/modules/foundation/foundation.module-scan.${f}.ts`), 'utf8');
      expect([f, /child_process|\bspawn\(|\bexec\(|\beval\(|new Function|\bimport\(|require\(|syncModules|from 'node:vm'|(^|[^.])\btsx\b/.test(src)]).toEqual([f, false]);
    }
  });
});

describe('FMI-01 scan — API, IAM, lock, snapshots, no write', () => {
  it('T14 401 without a session; 403 + one B08 DENIED with READ only or CREATE only; 503 when IAM cannot be evaluated', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'ANY_MOD');
    const full = build(modules);
    const anon = await post(full.app, {}, '');
    expect(anon.status).toBe(401);
    for (const grants of [[PERM_READ_ID], [PERM_CREATE_ID], []]) {
      const t = build(modules, { grants });
      const res = await post(t.app);
      expect([grants.length, res.status, res.body.error.code]).toEqual([grants.length, 403, 'FORBIDDEN']);
      const denied = t.db.state.audits.filter((a) => a[MA.outcome] === 'DENIED');
      expect(denied.map((a) => a[MA.action])).toEqual(['MODULE_PACKAGE.SCAN']);
      expect(t.db.state.audits.filter((a) => a[MA.outcome] !== 'DENIED')).toEqual([]);
    }
    const readOnly = build(modules, { grants: [PERM_READ_ID] });
    expect((await getScan(readOnly.app, '00000000-0000-4000-8000-000000000001')).status).toBe(403);
    const broken = build(modules);
    broken.db.failOn.set(FOUNDATION_SQL.permissionDefinitions, pgError('08006'));
    expect((await post(broken.app)).status).toBe(503);
  });

  it('body must be exactly {} (no path / moduleKey / force / null / array); scanId must be a UUID; unknown or expired snapshot → 404', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'ANY_MOD');
    let now = 1_000_000;
    const t = build(modules, { now: () => now });
    for (const body of [{ path: 'C:\\' }, { moduleKey: 'X' }, { force: true }, { execute: true }, { register: true }, []]) {
      const res = await post(t.app, body);
      expect([JSON.stringify(body), res.status, res.body.error.code]).toEqual([JSON.stringify(body), 400, 'VALIDATION_ERROR']);
    }
    expect((await request(t.app).post('/api/foundation/module-packages/scan').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send('null')).status).toBe(400);
    expect((await post(t.app, { pad: 'x'.repeat(20_000) })).status).toBe(413); // over the JSON body limit
    expect((await getScan(t.app, 'not-a-uuid')).status).toBe(400);
    expect((await getScan(t.app, '00000000-0000-4000-8000-000000000001')).body.error.code).toBe('SCAN_NOT_FOUND');
    const ok = (await post(t.app)).body as ScanReport;
    expect((await getScan(t.app, ok.scanId)).status).toBe(200);
    now += SNAPSHOT_TTL_MS + 1;
    const expired = await getScan(t.app, ok.scanId);
    expect([expired.status, expired.body.error.code]).toEqual([404, 'SCAN_NOT_FOUND']);
  });

  it('only 10 snapshots are kept (oldest dropped)', async () => {
    const modules = tmpRoot();
    const t = build(modules);
    const ids: string[] = [];
    for (let i = 0; i < 11; i += 1) ids.push(((await post(t.app)).body as ScanReport).scanId);
    expect((await getScan(t.app, ids[0] ?? '')).status).toBe(404);
    expect((await getScan(t.app, ids[10] ?? '')).status).toBe(200);
  });

  it('T15 two scans at once: the second is 409 SCAN_IN_PROGRESS; the lock is released after success and after an error', async () => {
    const modules = tmpRoot();
    writePackage(modules, 'ANY_MOD');
    let release: () => void = () => {};
    let calls = 0;
    const registry: ModuleScanRegistry = {
      read: () => {
        calls += 1;
        if (calls === 1) return new Promise((r) => { release = () => r(EMPTY); });
        if (calls === 3) return Promise.reject(new Error('boom'));
        return Promise.resolve(EMPTY);
      },
    };
    const t = build(modules, { registry });
    const first = post(t.app).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    const second = await post(t.app);
    expect([second.status, second.body.error.code]).toEqual([409, 'SCAN_IN_PROGRESS']);
    release();
    expect((await first).status).toBe(200);
    expect((await post(t.app)).status).toBe(200); // registry error is per-folder UNAVAILABLE, lock released
    expect((await post(t.app)).status).toBe(200);
    const gone = build(join(modules, 'does-not-exist'));
    expect((await post(gone.app)).body.error.code).toBe('SCAN_ROOT_UNAVAILABLE');
    expect((await post(gone.app)).status).toBe(503); // not stuck in 409
  });

  it('T19 an authorised scan writes nothing: only SELECTs (IAM facts, Registry), no B08 row, package files untouched', async () => {
    const modules = tmpRoot();
    const dir = writePackage(modules, 'NO_WRITE');
    const before = walkPackage(dir).files.map((f) => `${f.path}:${f.key}`);
    const sqlSeen: string[] = [];
    const registry = new SqlModuleScanRegistry({ query: async (sql: string) => { sqlSeen.push(sql); return [{ module_key: 'OTHER', module_version: '1.0.0', status: 'ACTIVE', navigation: [{ routePath: '/other' }] }]; } });
    const t = build(modules, { registry });
    const stateBefore = JSON.stringify(t.db.state);
    const res = await post(t.app);
    expect(res.status).toBe(200);
    expect(JSON.stringify(t.db.state)).toBe(stateBefore);
    expect(t.db.statements.every((s) => /^\s*SELECT\b/i.test(s.sql))).toBe(true);
    expect(t.db.statements.some((s) => s.sql === FOUNDATION_SQL.insertAudit)).toBe(false);
    expect(sqlSeen).toEqual([MODULE_SCAN_SQL.registry]);
    expect(MODULE_SCAN_SQL.registry.trim()).toMatch(/^SELECT\b/);
    expect(MODULE_SCAN_SQL.registry).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT)\b/i);
    expect(walkPackage(dir).files.map((f) => `${f.path}:${f.key}`)).toEqual(before);
    expect(statSync(join(dir, 'module.json')).isFile()).toBe(true);
    const log = t.logs.find((l) => l.includes('module package scan completed')) ?? '';
    expect(log).toContain('"total":1');
    expect(log).not.toContain(modules);
  });

  it('T01 nothing scans without the POST: building the service / app reads no folder and no Registry', async () => {
    const modules = tmpRoot();
    let reads = 0;
    const t = build(modules, { registry: { read: async () => { reads += 1; return EMPTY; } }, readPackage: (r, f, u) => { reads += 1; return readPackage(r, f, u); } });
    expect((await request(t.app).get('/api/foundation/module-packages/scans/00000000-0000-4000-8000-000000000001').set('Cookie', `talo_sid=${TOKEN}`)).status).toBe(404);
    expect(reads).toBe(0);
  });
});
