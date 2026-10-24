import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import express from 'express';
import type { Router } from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { moduleInstallerRouter } from '../../../src/modules/foundation/foundation.installer.routes.js';
import { ModuleInstallerService } from '../../../src/modules/foundation/foundation.installer.service.js';
import type { IamCatalog, IamPermissionRow, InstallerRuntime } from '../../../src/modules/foundation/foundation.installer.service.js';
import { InstallerStore } from '../../../src/modules/foundation/foundation.installer.store.js';
import { moduleScanRouter } from '../../../src/modules/foundation/foundation.module-scan.routes.js';
import { ModuleScanService } from '../../../src/modules/foundation/foundation.module-scan.service.js';
import type { RegisteredVersion } from '../../../src/modules/foundation/foundation.module-scan.types.js';
import { readLayout, revisionOf } from '../../../src/modules/foundation/foundation.navigation.builder.js';
import type { Draft } from '../../../src/modules/foundation/foundation.navigation.builder.js';
import type { NavigationItem } from '../../../src/modules/foundation/foundation.navigation.js';
import { sanitizeLog } from '../../../src/modules/foundation/foundation.preflight.js';
import type { Exec } from '../../../src/modules/foundation/foundation.preflight.js';
import { SqlFoundationRepository } from '../../../src/modules/foundation/foundation.repository.js';
import type { FoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { parseDeployments, releaseDir, syncModules, writeDeployments } from '../../../scripts/modules-sync.mjs';
import { hashPackage, walkPackage } from '../../../scripts/module-package.mjs';
import {
  ACCOUNT_A, FakeAuth, FakeDb, PERM_ACTIVATE_ID, PERM_APPROVE_ID, PERM_CREATE_ID, PERM_ENABLE_ID, PERM_NAV_ID, PERM_READ_ID, PERM_RETIRE_ID, PERM_VCREATE_ID,
  PERM_VSUBMIT_ID, PERM_VUPDATE_ID, TEST_ORIGIN, VALID_ROLE, defaultIam, token,
} from './fakes.js';
import { validMic } from './mic.fixture.js';

// FMI-02 / FMI-03 — Candidate Workspace, Preflight orchestration and Installer state machine (unit / API level): the real
// routers, ModuleInstallerService, ModuleScanService, AccessGuard + evaluator + B08 DENIED audit over FakeDb; the
// lifecycle / navigation services and the toolchain are fakes that record every call (the real toolchain is exercised
// by foundation.preflight.toolchain.test.ts, the real Foundation services by the DB test). Every folder is temporary:
// modules/, the release store, the deployment lock, the frontend registry and the installer store.

const TOKEN = token('installerSessionToken');
const PERM_IAM_ID = '10000000-0000-4000-8000-0000000000f1';
const ALL = [PERM_READ_ID, PERM_CREATE_ID, PERM_VCREATE_ID, PERM_VUPDATE_ID, PERM_VSUBMIT_ID, PERM_APPROVE_ID, PERM_ACTIVATE_ID, PERM_ENABLE_ID, PERM_NAV_ID, PERM_IAM_ID];
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const write = (file: string, text: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const slug = (key: string) => `/${key.toLowerCase().replace(/_/g, '-')}`;

function micOf(key: string, version: string) {
  const mic = validMic(key, version);
  const s = slug(key);
  return {
    ...mic,
    mic04Navigation: [{ menuLabel: 'Nhóm' }, { menuLabel: 'Đơn hàng', routePath: s, screenKey: 'pkg.main', functionKey: 'ORDER' }],
    mic05Api: [
      { method: 'GET', path: `/api${s}/orders`, functionKey: 'ORDER', actionKey: 'READ', errors: [] },
      { method: 'POST', path: `/api${s}/orders`, functionKey: 'ORDER', actionKey: 'CREATE', errors: ['VALIDATION_ERROR'] },
    ],
    mic06DataResources: [mic.mic06DataResources[0]],
  };
}
function writePackage(modules: string, key: string, version = '1.0.0', mic: unknown = micOf(key, version)): string {
  const dir = join(modules, key);
  write(join(dir, 'backend', 'index.ts'), 'export const HOST_PROTOCOL = "TALO-MODULE-HOST-1";\n');
  write(join(dir, 'frontend', 'Screen.tsx'), 'export const screens = {};\n');
  write(join(dir, 'mic', 'pkg.mic.ts'), 'export const mic = {};\n');
  write(join(dir, 'tests', 'pkg.test.ts'), 'export {};\n');
  write(join(dir, 'module.json'), JSON.stringify({
    packageFormat: 'TALO-MODULE-PACKAGE-1', moduleKey: key, name: `Package ${key}`, packageVersion: version, contractVersion: 'MIC-1.0', hostProtocol: 'TALO-MODULE-HOST-1',
    backendEntry: 'backend/index.ts', frontendEntry: 'frontend/Screen.tsx', micEntry: 'mic/pkg.mic.ts',
    frontend: { screens: [{ screenKey: 'pkg.main', name: 'Pkg', description: 'Màn hình', tabs: [{ label: 'Tab', path: slug(key) }] }] }, requiredCapabilities: ['session'],
  }));
  write(join(dir, 'mic', 'module.mic.json'), JSON.stringify(mic));
  return dir;
}

// The installer's own read queries (B01 / B02 / B03 / B09) over an in-memory model kept by the fake services.
interface Model {
  modules: { moduleId: string; moduleKey: string; enabled: boolean }[];
  versions: { versionId: string; moduleId: string; moduleVersion: string; status: string; mic: unknown; activatedAt?: string | null }[];
  functions: { functionId: string; moduleId: string; functionKey: string }[];
  nav: NavigationItem[];
  iam: IamPermissionRow[];
  assignments: number;
  calls: string[];
}
const navItem = (navigationId: string, parentId: string | null, moduleId: string | null, functionId: string | null, menuTitle: string, isVisible = true, sortOrder = 0): NavigationItem =>
  ({ navigationId, parentId, moduleId, functionId, menuTitle, sortOrder, isVisible, createdAt: '2026-10-23T00:00:00.000Z' });
class ModelDb implements Pick<FoundationDb, 'query'> {
  constructor(private readonly m: Model) {}
  async query(sql: string, params: readonly unknown[]): Promise<unknown[]> {
    const m = this.m;
    if (sql.includes('LEFT JOIN foundation.fnd_module_versions AS v')) {
      const mod = m.modules.find((x) => x.moduleKey === params[0]);
      if (!mod) return [];
      const vs = m.versions.filter((v) => v.moduleId === mod.moduleId);
      return vs.length === 0 ? [{ module_id: mod.moduleId, is_enabled: mod.enabled, version_id: null, module_version: null, status: null }]
        : vs.map((v) => ({ module_id: mod.moduleId, is_enabled: mod.enabled, version_id: v.versionId, module_version: v.moduleVersion, status: v.status }));
    }
    if (sql.includes('SELECT v.manifest_json, v.status FROM foundation.fnd_module_versions')) {
      const v = m.versions.find((x) => x.versionId === params[0]);
      return v ? [{ manifest_json: v.mic, status: v.status }] : [];
    }
    if (sql.includes('SELECT function_id::text AS function_id, function_key FROM foundation.fnd_functions')) {
      return m.functions.filter((f) => f.moduleId === params[0]).map((f) => ({ function_id: f.functionId, function_key: f.functionKey }));
    }
    throw new Error(`ModelDb: unexpected SQL ${sql.slice(0, 60)}`);
  }
}

function build(o: { grants?: readonly string[]; registered?: RegisteredVersion[]; database?: string; now?: () => number; activateFails?: boolean; execDelayMs?: number; iamWritable?: boolean; draftMic?: unknown; moduleAllowed?: boolean; activeMic?: (key: string, version: string) => unknown } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'fmi0203-'));
  roots.push(base);
  const modules = join(base, 'modules');
  const releases = join(base, 'module-releases');
  const lockFile = join(base, 'module-deployments.json');
  const frontendDir = join(base, 'frontend');
  mkdirSync(modules, { recursive: true });
  write(join(frontendDir, 'src', 'main.tsx'), 'export {};\n');
  write(join(frontendDir, 'tsconfig.app.json'), '{}\n');
  writeDeployments(lockFile, []);
  const iam = defaultIam();
  iam.permissions.push({ permission_id: PERM_IAM_ID, permission_code: 'iam.permissions.manage', module_code: 'IAM', resource_code: 'PERMISSIONS', operation: 'MANAGE', minimum_assurance_level: 1 });
  iam.grants = (o.grants ?? ALL).map((permissionId) => ({ accountId: ACCOUNT_A, permissionId, row: VALID_ROLE }));
  const fakeDb = new FakeDb(iam);
  const access = new SqlFoundationRepository(fakeDb);
  const auth = new FakeAuth();
  auth.authenticated(TOKEN, ACCOUNT_A);
  const logs: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (line) => logs.push(line) });
  const model: Model = { modules: [], versions: [], functions: [], nav: [], iam: [], assignments: 0, calls: [] };
  const registered = o.registered ?? [];
  for (const r of registered) {
    let mod = model.modules.find((x) => x.moduleKey === r.moduleKey);
    if (!mod) { mod = { moduleId: randomUUID(), moduleKey: r.moduleKey, enabled: r.moduleEnabled !== false }; model.modules.push(mod); }
    model.versions.push({ versionId: randomUUID(), moduleId: mod.moduleId, moduleVersion: r.moduleVersion, status: r.status, mic: r.status === 'DRAFT' ? o.draftMic ?? null : r.status === 'ACTIVE' && o.activeMic ? o.activeMic(r.moduleKey, r.moduleVersion) : null,
      activatedAt: r.status === 'ACTIVE' ? '2026-10-20T00:00:00.000000Z' : null });
  }
  const registry = { read: async () => ({ moduleKeys: new Set(model.modules.map((x) => x.moduleKey)), versions: model.versions.map((v) => {
    const mod = model.modules.find((x) => x.moduleId === v.moduleId);
    const routes = v.status === 'ACTIVE' && v.mic ? ((v.mic as { mic04Navigation: { routePath?: string }[] }).mic04Navigation.flatMap((n) => (n.routePath ? [n.routePath] : []))) : v.status === 'ACTIVE' ? [] : null;
    return { moduleKey: mod?.moduleKey ?? '', moduleVersion: v.moduleVersion, status: v.status as RegisteredVersion['status'], activeRoutes: routes, moduleEnabled: mod?.enabled ?? true };
  }) }) };
  const id = (x: unknown) => String(x);
  const fakeFail = new Map<string, string>();
  const fakes = {
    modules: { registerModule: async (_a: unknown, body: unknown) => {
      const b = body as { moduleKey: string };
      model.calls.push(`REGISTER ${b.moduleKey}`);
      const mod = { moduleId: randomUUID(), moduleKey: b.moduleKey, enabled: false };
      model.modules.push(mod);
      return { moduleId: mod.moduleId } as never;
    } },
    versions: { createVersion: async (_a: unknown, moduleId: unknown, body: unknown) => {
      const v = { versionId: randomUUID(), moduleId: id(moduleId), moduleVersion: (body as { moduleVersion: string }).moduleVersion, status: 'DRAFT', mic: null };
      model.calls.push(`CREATE_VERSION ${v.moduleVersion}`);
      model.versions.push(v);
      return { versionId: v.versionId } as never;
    } },
    manifests: {
      updateManifest: async (_a: unknown, _m: unknown, versionId: unknown, body: unknown, raw: string | undefined) => {
        const v = model.versions.find((x) => x.versionId === id(versionId));
        if (!v || v.status !== 'DRAFT' || raw === undefined || JSON.stringify(JSON.parse(raw)) !== JSON.stringify(body)) throw Object.assign(new Error('x'), { code: 'VERSION_STATE_CONFLICT' });
        v.mic = (body as { manifest: unknown }).manifest;
        model.calls.push('PUT_MIC');
        return {} as never;
      },
      submit: async (_a: unknown, moduleId: unknown, versionId: unknown) => {
        const v = model.versions.find((x) => x.versionId === id(versionId));
        if (!v) throw new Error('no version');
        v.status = 'IN_REVIEW';
        for (const f of (v.mic as { mic02Functions: { functionKey: string }[] }).mic02Functions) {
          if (!model.functions.some((x) => x.moduleId === id(moduleId) && x.functionKey === f.functionKey)) model.functions.push({ functionId: randomUUID(), moduleId: id(moduleId), functionKey: f.functionKey });
        }
        model.calls.push('SUBMIT');
        return {} as never;
      },
    },
    lifecycle: {
      approve: async (_a: unknown, _m: unknown, versionId: unknown) => { const v = model.versions.find((x) => x.versionId === id(versionId)); if (v) v.status = 'APPROVED'; model.calls.push('APPROVE'); return {} as never; },
      // As the Lifecycle Service: the current ACTIVE of the module is RETIRED in the same step; activated_at returned.
      activate: async (_a: unknown, _m: unknown, versionId: unknown) => {
        if (o.activateFails || fakeFail.has('activate')) throw Object.assign(new Error('blocked'), { code: 'ACTIVATION_BLOCKED' });
        const v = model.versions.find((x) => x.versionId === id(versionId));
        const old = model.versions.find((x) => x.moduleId === v?.moduleId && x.status === 'ACTIVE' && x !== v);
        if (old) old.status = 'RETIRED';
        if (v) { v.status = 'ACTIVE'; v.activatedAt ??= `2026-10-24T00:00:00.${String(model.calls.length).padStart(6, '0')}Z`; }
        model.calls.push('ACTIVATE');
        return { version: { versionId: v?.versionId, activatedAt: v?.activatedAt ?? null }, retired: old ? { versionId: old.versionId } : null } as never;
      },
      // As the Lifecycle repository: proof re-checked (failed ACTIVE with the journalled activated_at, restore RETIRED).
      recoverUpgrade: async (_a: unknown, input: { failedVersionId: string; restoreVersionId: string; failedActivatedAt: string; installId: string }) => {
        if (fakeFail.has('recoverUpgrade')) throw Object.assign(new Error('connection lost'), { code: fakeFail.get('recoverUpgrade') });
        const failed = model.versions.find((x) => x.versionId === input.failedVersionId);
        const restore = model.versions.find((x) => x.versionId === input.restoreVersionId);
        if (failed?.status !== 'ACTIVE' || failed.activatedAt !== input.failedActivatedAt || restore?.status !== 'RETIRED') throw Object.assign(new Error('proof'), { code: 'RECOVERY_PROOF_MISMATCH' });
        failed.status = 'RETIRED';
        restore.status = 'ACTIVE';
        model.calls.push(`ROLLBACK ${failed.moduleVersion}→${restore.moduleVersion} ${input.installId.slice(0, 8)}`);
        return { version: { versionId: restore.versionId }, retired: { versionId: failed.versionId } } as never;
      },
      enable: async (_a: unknown, moduleId: unknown) => { const m = model.modules.find((x) => x.moduleId === id(moduleId)); if (m) m.enabled = true; model.calls.push('ENABLE'); return {} as never; },
      disable: async (_a: unknown, moduleId: unknown) => { const m = model.modules.find((x) => x.moduleId === id(moduleId)); if (m) m.enabled = false; model.calls.push('DISABLE'); return {} as never; },
    },
    // The Navigation Builder service contract: the stored layout (real readLayout) and one apply of a whole draft with
    // the revision check — every inserted row is placed under its draft parent (AREA → MENU → FUNCTION, nothing else).
    navigation: {
      layout: async () => readLayout(model.nav),
      apply: async (_a: unknown, body: unknown) => {
        const d = body as Draft;
        if (fakeFail.has('nav')) throw Object.assign(new Error('nav'), { code: fakeFail.get('nav') });
        if (d.revision !== revisionOf(model.nav)) throw Object.assign(new Error('conflict'), { code: 'NAVIGATION_CONFLICT' });
        const put = (idv: string | null, parent: string | null, functionId: string | null, title: string, visible: boolean, moduleId: string | null) => {
          if (idv !== null) {
            const i = model.nav.findIndex((x) => x.navigationId === idv);
            const cur = model.nav[i];
            if (cur) model.nav[i] = { ...cur, menuTitle: title, isVisible: visible };
            return idv;
          }
          const n = navItem(randomUUID(), parent, moduleId, functionId, title, visible, model.nav.length);
          model.nav.push(n);
          model.calls.push(`NAV ${functionId ? 'LINK' : parent ? 'MENU' : 'AREA'}`);
          return n.navigationId;
        };
        for (const a of d.areas) {
          const aid = put(a.id, null, null, a.title, a.visible, null);
          for (const m of a.menus) {
            const mid = put(m.id, aid, null, m.title, m.visible, null);
            for (const l of m.items) put(l.id, mid, l.functionId, l.title, l.visible, model.functions.find((f) => f.functionId === l.functionId)?.moduleId ?? null);
          }
        }
        model.calls.push('NAV APPLY');
        return readLayout(model.nav) as never;
      },
    },
  };
  const iamCatalog: IamCatalog = {
    permission: { permissionCode: 'iam.permissions.manage', moduleCode: 'IAM', resourceCode: 'PERMISSIONS', operation: 'MANAGE' },
    existing: async (moduleCode) => model.iam.filter((p) => p.moduleCode === moduleCode),
    writable: async () => o.iamWritable !== false,
    assignments: async () => model.assignments,
    create: async (_a, row) => {
      if (fakeFail.has('iam')) throw Object.assign(new Error('iam'), { code: fakeFail.get('iam') });
      if (model.iam.some((p) => p.moduleCode === row.moduleCode && p.resourceCode === row.resourceCode && p.operation === row.operation)) throw Object.assign(new Error('dup'), { code: 'PERMISSION_TRIPLE_EXISTS' });
      model.iam.push({ permissionCode: row.permissionCode, moduleCode: row.moduleCode, resourceCode: row.resourceCode, operation: row.operation, minimumAssuranceLevel: row.minimumAssuranceLevel });
      model.calls.push(`IAM ${row.permissionCode}`);
    },
  };
  const execCalls: string[][] = [];
  const exec: Exec = async (args) => {
    execCalls.push([...args]);
    if (o.execDelayMs) await new Promise((r) => setTimeout(r, o.execDelayMs));
    const tool = args[0] ?? '';
    if (tool.endsWith('tsc')) return { exitCode: 0, output: '', timedOut: false, durationMs: 5 };
    if (tool.endsWith('vitest.mjs')) return { exitCode: 0, output: ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n', timedOut: false, durationMs: 5 };
    const dir = args[2] ?? '';
    const mic = JSON.parse(readFileSync(join(dir, 'mic', 'module.mic.json'), 'utf8')) as { mic05Api: { method: string; path: string }[] };
    const declared = mic.mic05Api.map((a) => `${a.method} ${a.path.replace(/^\/api/, '')}`);
    return { exitCode: 0, timedOut: false, durationMs: 5, output: `${JSON.stringify({ moduleKey: 'X', handshake: [], routes: { mounted: declared, declared, missing: [], undeclared: [] },
      smoke: mic.mic05Api.map((a) => ({ method: a.method, path: a.path, status: 401, code: 'SESSION_INVALID' })) })}\n` };
  };
  const runtime: { modules: { moduleKey: string; packageVersion: string; packageHash: string | null }[]; routers: Map<string, Router> } = { modules: [], routers: new Map() };
  const store = new InstallerStore(join(base, 'var', 'installer'));
  const scans = new ModuleScanService({ access, registry, logger, modulesRoot: modules });
  const paths = { backendDir: join(import.meta.dirname, '..', '..', '..'), frontendDir, modulesRoot: modules, releasesDir: releases, lockFile };
  const service = new ModuleInstallerService({
    access, db: new ModelDb(model), registry, scans, modules: fakes.modules, versions: fakes.versions, manifests: fakes.manifests, lifecycle: fakes.lifecycle,
    navigation: fakes.navigation, iam: iamCatalog, runtime: runtime as InstallerRuntime, paths, store, environment: { label: 'TEST', database: o.database ?? 'talo_mos_v4_test', nodeEnv: 'test' },
    allowedDatabase: 'talo_mos_v4_test', logger, exec, ...(o.now ? { now: o.now } : {}),
  });
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [
    moduleScanRouter({ authService: auth, service: scans, secureCookie: false }), moduleInstallerRouter({ authService: auth, service, secureCookie: false }),
  ] });
  const cookie = `talo_sid=${TOKEN}`;
  const post = (url: string, body: unknown = {}, c = cookie) => request(app).post(`/api${url}`).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', c).send(JSON.stringify(body));
  const get = (url: string, c = cookie) => request(app).get(`/api${url}`).set('Cookie', c);
  // The operator's restart: the Host build (real sync from the release store) + the module router of the new process.
  const restart = () => {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    syncModules({ target: 'frontend', releasesDir: releases, deployments: lock, outDir: join(frontendDir, 'src', 'installed-modules'), log: () => undefined });
    runtime.modules = [...parseDeployments(lock).entries()].map(([moduleKey, v]) => ({ moduleKey, packageVersion: v.packageVersion, packageHash: v.packageHash }));
    for (const r of runtime.modules) runtime.routers.set(r.moduleKey, sessionRouter(r.moduleKey, () => o.moduleAllowed === true));
  };
  return { base, modules, releases, lockFile, frontendDir, model, fakeDb, logs, service, store, app, post, get, runtime, restart, execCalls, fakeFail, auth, paths, registry, scans, access, fakes, iamCatalog, logger };
}

// A module router as the Host mounts it: every route behind the session — no session → 401 envelope; the operator's
// session (the installer's own cookie) → 403 FORBIDDEN unless the module permission is assigned (allowed()) → 200 data.
function sessionRouter(key: string, allowed: () => boolean = () => false): Router {
  const router = express.Router();
  const handle = (status: number, body: unknown) => (req: express.Request, res: express.Response) => {
    if (!String(req.headers.cookie ?? '').includes(TOKEN)) { res.status(401).json({ error: { code: 'SESSION_INVALID', message: 'x', requestId: 'r' } }); return; }
    if (!allowed()) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'x', requestId: 'r' } }); return; }
    res.status(status).json(body);
  };
  router.get(`${slug(key)}/orders`, handle(200, { orders: [] }));
  router.post(`${slug(key)}/orders`, handle(201, { order: {} }));
  return router;
}

type H = ReturnType<typeof build>;
async function candidateOf(h: H, key: string): Promise<{ candidateId: string; status: string; sourceHash: string }> {
  const scan = await h.post('/foundation/module-packages/scan');
  expect(scan.status).toBe(200);
  const res = await h.post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey: key });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.candidate;
}
async function ready(h: H, key: string) {
  const c = await candidateOf(h, key);
  const start = await h.post(`/foundation/module-candidates/${c.candidateId}/preflight`);
  expect(start.status).toBe(202);
  await h.service.whenIdle();
  const run = await h.get(`/foundation/module-candidates/${c.candidateId}/preflight/${start.body.runId}`);
  return { c, runId: String(start.body.runId), run: run.body.run };
}

describe('FMI-02 Candidate Workspace + Preflight orchestration', () => {
  it('PF-09 / PF-08: a valid package → candidate (snapshot, no B01/B02) → preflight READY; evidence is the run, never the package MIC-10 declaration', async () => {
    const h = build();
    writePackage(h.modules, 'FBET_INST_A');
    const { c, run, runId } = await ready(h, 'FBET_INST_A');
    expect(h.model.calls).toEqual([]); // nothing registered before READY
    expect(run.checks.filter((x: { status: string }) => x.status !== 'PASS').map((x: { key: string; status: string }) => `${x.key}:${x.status}`)).toEqual(['DATABASE_TESTS:NOT_APPLICABLE', 'AUTHENTICATED_IAM_SMOKE:NOT_TESTED']);
    expect(run).toMatchObject({ status: 'COMPLETED', result: 'READY', suiteVersion: 'FMI-02-PREFLIGHT-1', environment: { database: 'talo_mos_v4_test' } });
    expect(run.checks.filter((x: { required: boolean }) => !x.required).map((x: { key: string }) => x.key)).toEqual(['AUTHENTICATED_IAM_SMOKE']); // optional: never makes READY
    expect(run.reportHash).toMatch(/^[0-9a-f]{64}$/);
    const cand = (await h.get(`/foundation/module-candidates/${c.candidateId}`)).body.candidate;
    expect(cand).toMatchObject({ status: 'READY', readyRunId: runId, readyReportHash: run.reportHash });
    // the package MIC-10 says PASS 'CI run 1': it is only a scan warning, the READY comes from the run's own checks
    expect(run.checks.find((x: { key: string }) => x.key === 'STATIC_SCAN').limitations.join(' ')).toContain('TEST_EVIDENCE_UNVERIFIED');
    // the report file on disk is the hashed one
    const json = readFileSync(join(h.store.runDir(c.candidateId, runId), 'report.json'), 'utf8');
    expect(createHash('sha256').update(json, 'utf8').digest('hex')).toBe(run.reportHash);
  });

  it('PF-10: TXT / JSON reports — attachment, UTF-8, module, hash, run, every check, timestamps, limitations; no absolute path, no secret', async () => {
    const h = build();
    writePackage(h.modules, 'FBET_INST_R');
    const { c, runId } = await ready(h, 'FBET_INST_R');
    const txt = await h.get(`/foundation/module-candidates/${c.candidateId}/preflight/${runId}/report.txt`);
    expect(txt.status).toBe(200);
    expect(txt.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(txt.headers['content-disposition']).toMatch(/^attachment; filename="preflight-FBET_INST_R-1\.0\.0-[0-9a-f]{8}\.txt"$/);
    for (const s of ['FBET_INST_R 1.0.0', c.sourceHash, runId, 'talo_mos_v4_test', 'Kết luận        : READY', 'Giới hạn chung', ...['P0', 'P1', 'P2a', 'P2b', 'P3', 'P4', 'P5a', 'P5b', 'P6', 'P7', 'P8'].map((p) => `] ${p} `)]) expect(txt.text).toContain(s);
    expect(txt.text).not.toContain(h.base);
    const json = await h.get(`/foundation/module-candidates/${c.candidateId}/preflight/${runId}/report.json`);
    expect(json.headers['content-type']).toBe('application/json; charset=utf-8');
    const report = JSON.parse(json.text);
    expect(report.evidence).toHaveLength(11);
    expect(report.evidence[0]).toMatchObject({ testId: 'FMI-02-PREFLIGHT-1/P0', result: 'PASS', packageHash: c.sourceHash, runId, candidateId: c.candidateId });
  });

  it('PF-07: the package changes after the scan → the run fails P0 PACKAGE_CHANGED, candidate INVALIDATED, no toolchain run, no old evidence reused', async () => {
    const h = build();
    const dir = writePackage(h.modules, 'FBET_INST_C');
    const c = await candidateOf(h, 'FBET_INST_C');
    writeFileSync(join(dir, 'backend', 'index.ts'), 'export const HOST_PROTOCOL = "TALO-MODULE-HOST-1"; // changed\n');
    const start = await h.post(`/foundation/module-candidates/${c.candidateId}/preflight`);
    await h.service.whenIdle();
    const run = (await h.get(`/foundation/module-candidates/${c.candidateId}/preflight/${start.body.runId}`)).body.run;
    expect(run.result).toBe('INVALIDATED');
    expect(run.checks[0]).toMatchObject({ key: 'PACKAGE_INTEGRITY', status: 'FAIL' });
    expect(run.checks.slice(1).every((x: { status: string }) => x.status === 'NOT_TESTED')).toBe(true);
    expect(h.execCalls).toEqual([]);
    expect((await h.get(`/foundation/module-candidates/${c.candidateId}`)).body.candidate.status).toBe('INVALIDATED');
    expect((await h.post(`/foundation/module-candidates/${c.candidateId}/preflight`)).status).toBe(409);
    // after a new scan the changed package is a NEW candidate (old one stays INVALIDATED)
    const again = await candidateOf(h, 'FBET_INST_C');
    expect(again.candidateId).not.toBe(c.candidateId);
  });

  it('PF-07 after READY: the folder changes → prepare is BLOCKED (PACKAGE_CHANGED) and the candidate loses READY', async () => {
    const h = build();
    const dir = writePackage(h.modules, 'FBET_INST_D');
    const { c } = await ready(h, 'FBET_INST_D');
    writeFileSync(join(dir, 'frontend', 'Screen.tsx'), 'export const screens = { changed: 1 };\n');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan.state).toBe('BLOCKED');
    expect(plan.blockers.map((b: { code: string }) => b.code)).toEqual(expect.arrayContaining(['PACKAGE_CHANGED']));
    expect((await h.get(`/foundation/module-candidates/${c.candidateId}`)).body.candidate.status).toBe('INVALIDATED');
  });

  it('PF-02: wrong MIC-07 (K05) → the scan is not eligible → candidate refused 409 (nothing stored)', async () => {
    const h = build();
    const mic = micOf('FBET_INST_K', '1.0.0');
    writePackage(h.modules, 'FBET_INST_K', '1.0.0', { ...mic, mic07IamMapping: mic.mic07IamMapping.map((m) => ({ ...m, resourceCode: 'WRONG' })) });
    const scan = await h.post('/foundation/module-packages/scan');
    const res = await h.post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey: 'FBET_INST_K' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANDIDATE_NOT_ELIGIBLE');
    expect(h.store.listCandidates()).toEqual([]);
  });

  it('SEC-07: one preflight at a time (bounded worker) → a second start is 409 PREFLIGHT_IN_PROGRESS', async () => {
    const h = build({ execDelayMs: 300 });
    writePackage(h.modules, 'FBET_INST_E');
    writePackage(h.modules, 'FBET_INST_F');
    const a = await candidateOf(h, 'FBET_INST_E');
    const scan = await h.post('/foundation/module-packages/scan');
    const b = (await h.post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey: 'FBET_INST_F' })).body.candidate;
    const first = await h.post(`/foundation/module-candidates/${a.candidateId}/preflight`);
    const second = await h.post(`/foundation/module-candidates/${b.candidateId}/preflight`);
    expect([first.status, second.status]).toEqual([202, 409]);
    expect(second.body.error.code).toBe('PREFLIGHT_IN_PROGRESS');
    await h.service.whenIdle();
  });
});

describe('FMI-02/03 security (SEC-01 … SEC-06)', () => {
  it('SEC-01 / SEC-02: no session → 401; a session without permission → 403 + B08 DENIED, nothing stored or executed', async () => {
    const h = build({ grants: [] });
    writePackage(h.modules, 'FBET_INST_S');
    expect((await h.post('/foundation/module-candidates', { scanId: randomUUID(), moduleKey: 'FBET_INST_S' }, 'talo_sid=none')).status).toBe(401);
    const res = await h.post('/foundation/module-candidates', { scanId: randomUUID(), moduleKey: 'FBET_INST_S' });
    expect(res.status).toBe(403);
    expect(h.fakeDb.state.audits.some((a) => a.includes('MODULE_CANDIDATE.CREATE') && a.includes('DENIED'))).toBe(true);
    for (const url of ['/foundation/runtime-release', `/foundation/module-candidates/${randomUUID()}`]) expect((await h.get(url)).status).toBe(403);
    expect(h.store.listCandidates()).toEqual([]);
    expect(h.execCalls).toEqual([]);
  });

  it('SEC-03: client values are ids / fixed values only — unknown fields (path, command, sql, evidence) → 400; invalid ids → 404; nothing executed', async () => {
    const h = build();
    writePackage(h.modules, 'FBET_INST_V');
    const scan = await h.post('/foundation/module-packages/scan');
    for (const extra of [{ path: '../../etc' }, { command: 'npm i' }, { sql: 'DELETE FROM x' }]) {
      const r = await h.post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey: 'FBET_INST_V', ...extra });
      expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
    expect((await h.post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey: '../FBET' })).status).toBe(400);
    const c = (await h.post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey: 'FBET_INST_V' })).body.candidate;
    expect((await h.post(`/foundation/module-candidates/${c.candidateId}/preflight`, { tests: 'all' })).status).toBe(400);
    expect((await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: randomUUID(), acknowledge: true, mic10: 'PASS' })).status).toBe(400);
    expect((await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: randomUUID(), acknowledge: false })).status).toBe(400);
    for (const bad of ['..%2F..%2Fetc', 'abc', '00000000-0000-0000-0000-000000000000']) expect((await h.get(`/foundation/module-candidates/${bad}`)).status).toBe(404);
    expect((await h.get('/foundation/module-installations/abc')).status).toBe(404);
    expect(h.execCalls).toEqual([]);
  });

  it('SEC-05: logs are sanitised — repository paths, connection strings, cookies, passwords and tokens are masked', () => {
    const text = sanitizeLog('at D:\\repo\\backend\\x.ts and D:/repo/frontend/y.ts postgresql://talo_app:secret@127.0.0.1:5433/talo_mos_v4_test Cookie: talo_sid=abcdef password=hunter2 token: xyz', ['D:\\repo']);
    expect(text).toBe('at <repo>\\backend\\x.ts and <repo>/frontend/y.ts postgresql://*** Cookie: *** password=*** token: ***');
  });

  it('SEC-06: a runtime database other than talo_mos_v4_test → prepare BLOCKED (WRONG_DB_TARGET), commit refused, nothing written', async () => {
    const h = build({ database: 'talo_mos_v4_dev' });
    writePackage(h.modules, 'FBET_INST_W');
    const { c } = await ready(h, 'FBET_INST_W');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan.blockers.map((b: { code: string }) => b.code)).toContain('WRONG_DB_TARGET');
    const res = await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true });
    expect([res.status, res.body.error.code]).toEqual([409, 'PLAN_BLOCKED']);
    expect(h.model.calls).toEqual([]);
    expect(parseDeployments(JSON.parse(readFileSync(h.lockFile, 'utf8'))).size).toBe(0);
  });
});

describe('FMI-03 installer (IN-01 … IN-12, SEC-07)', { timeout: 20_000 }, () => {
  it('IN-04 / IN-08 / IN-12: NEW_MODULE — prepare (dry run) → commit → AWAITING_RESTART (not ACTIVE) → restart → continue → INSTALLED_ACTIVE', async () => {
    const h = build({ moduleAllowed: true });
    writePackage(h.modules, 'FBET_INST_N');
    const { c, runId, run } = await ready(h, 'FBET_INST_N');
    const prep = await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`);
    expect(prep.status).toBe(200);
    const plan = prep.body.installation;
    expect(plan).toMatchObject({ state: 'PREPARED', dryRun: true, classification: 'NEW_MODULE', blockers: [] });
    expect(plan.warnings.join(' ')).toContain('DEPLOY_RESTART_REQUIRED');
    expect(h.model.calls).toEqual([]); // prepare writes nothing
    const commit = await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true });
    expect(commit.status).toBe(200);
    const done = commit.body.installation;
    expect(done.state).toBe('AWAITING_RESTART');
    expect(h.model.calls).toEqual(['REGISTER FBET_INST_N', 'CREATE_VERSION 1.0.0', 'PUT_MIC', 'SUBMIT', 'APPROVE']); // no ACTIVATE before the restart
    // immutable release + lock
    const rel = releaseDir(h.releases, 'FBET_INST_N', '1.0.0');
    expect(hashPackage(rel, walkPackage(rel)).hash).toBe(c.sourceHash);
    expect(parseDeployments(JSON.parse(readFileSync(h.lockFile, 'utf8'))).get('FBET_INST_N')).toEqual({ packageVersion: '1.0.0', packageHash: c.sourceHash });
    // PF-08: the stored MIC-10 evidence is the server's run + report hash
    const stored = h.model.versions[0]?.mic as { mic10Manifest: { testEvidence: unknown[] } };
    expect(stored.mic10Manifest.testEvidence).toEqual([{ name: `FMI-02 preflight ${runId} (talo_mos_v4_test)`, result: 'PASS', reference: `fmi02:${runId}:${run.reportHash}` }]);
    // IN-08: the running Host does not run the release yet → no ACTIVATE, state unchanged
    const early = await h.post(`/foundation/module-installations/${done.installId}/continue`);
    expect([early.status, early.body.error.code]).toEqual([409, 'RESTART_PENDING']);
    expect((await h.get(`/foundation/module-installations/${done.installId}`)).body.installation.state).toBe('AWAITING_RESTART');
    h.restart();
    h.model.assignments = 2; // policy applied in IAM (role assignment) — the installer never assigns
    const rt = (await h.get('/foundation/runtime-release')).body.runtime;
    expect(rt).toMatchObject({ matches: true, supervisor: 'NONE' });
    const fin = await h.post(`/foundation/module-installations/${done.installId}/continue`);
    expect(fin.status).toBe(200);
    expect(fin.body.installation.state).toBe('INSTALLED_ACTIVE');
    expect(fin.body.installation.postcheck.map((p: { key: string; status: string }) => `${p.key}:${p.status}`)).toEqual(['B02_ACTIVE:PASS', 'RUNTIME_RELEASE:PASS', 'IAM_CATALOG:PASS', 'IAM_POLICY:PASS', 'NAVIGATION:PASS', 'API_SMOKE:PASS', 'ACCESS_VERIFIED:PASS']);
    expect(h.model.calls.slice(5)).toEqual(['ACTIVATE', 'ENABLE', 'IAM fbet_inst_n.order.read', 'IAM fbet_inst_n.order.create', 'IAM fbet_inst_n.report.read', 'NAV AREA', 'NAV MENU', 'NAV LINK', 'NAV APPLY']);
    const report = await h.get(`/foundation/module-installations/${done.installId}/report.txt`);
    expect(report.text).toContain('Trạng thái   : INSTALLED_ACTIVE');
    expect(report.text).not.toContain(h.base);
    // IN-11: a finished installation cannot be replayed
    expect((await h.post(`/foundation/module-installations/${done.installId}/continue`)).status).toBe(409);
    // a second plan for the same (now deployed) version is blocked: the version is locked (REV01-D1: the installed
    // release + lock now form a recovery point, so the upgrade gate itself no longer applies)
    const again = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(again.state).toBe('BLOCKED');
    expect(again.blockers.map((b: { code: string }) => b.code)).toContain('VERSION_LOCKED');
    expect(again.blockers.map((b: { code: string }) => b.code)).not.toContain('UPGRADE_RECOVERY_UNAVAILABLE');
  });

  it('IN-09 / IN-11 / IN-07: postcheck FAIL after ACTIVATE → RECOVERY_REQUIRED + module DISABLED; retry after the fix → INSTALLED_ACTIVE, no duplicate permission / menu / version', async () => {
    const h = build({ moduleAllowed: true });
    writePackage(h.modules, 'FBET_INST_P');
    const { c } = await ready(h, 'FBET_INST_P');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    const done = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    h.restart();
    h.model.assignments = 1;
    h.runtime.routers.delete('FBET_INST_P'); // the new process did not mount the module router
    const failed = (await h.post(`/foundation/module-installations/${done.installId}/continue`)).body.installation;
    expect(failed.state).toBe('RECOVERY_REQUIRED');
    expect(failed.postcheck.find((p: { key: string }) => p.key === 'API_SMOKE').status).toBe('FAIL');
    expect(failed.recovery.join(' ')).toContain('DISABLE');
    expect(h.model.modules.find((m) => m.moduleKey === 'FBET_INST_P')?.enabled).toBe(false);
    h.runtime.routers.set('FBET_INST_P', sessionRouter('FBET_INST_P', () => true));
    const fixed = (await h.post(`/foundation/module-installations/${done.installId}/continue`)).body.installation;
    expect(fixed.state).toBe('INSTALLED_ACTIVE');
    expect(h.model.iam).toHaveLength(3);
    expect(h.model.nav).toHaveLength(3); // AREA → MENU → FUNCTION, once
    expect(h.model.versions).toHaveLength(1);
    expect(h.model.calls.filter((x) => x === 'ACTIVATE')).toHaveLength(1);
  });

  it('IN-09: a failing ACTIVATE (gate) → RECOVERY_REQUIRED, nothing marked active, no IAM / menu', async () => {
    const h = build({ activateFails: true });
    writePackage(h.modules, 'FBET_INST_G');
    const { c } = await ready(h, 'FBET_INST_G');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    const done = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    h.restart();
    const r = (await h.post(`/foundation/module-installations/${done.installId}/continue`)).body.installation;
    expect(r.state).toBe('RECOVERY_REQUIRED');
    expect(r.steps.find((s: { key: string }) => s.key === 'ACTIVATE')).toMatchObject({ status: 'FAILED', detail: 'ACTIVATION_BLOCKED' });
    expect(h.model.iam).toEqual([]);
    expect(h.model.nav).toEqual([]);
  });

  it('IN-10 / IN-03: a module with an ACTIVE version → UPGRADE_RECOVERY_UNAVAILABLE; commit refused, B01 / B02 / lock / release untouched', async () => {
    const h = build({ registered: [{ moduleKey: 'FBET_INST_U', moduleVersion: '1.0.0', status: 'ACTIVE', activeRoutes: [], moduleEnabled: true }] });
    const mic = micOf('FBET_INST_U', '1.1.0');
    writePackage(h.modules, 'FBET_INST_U', '1.1.0', { ...mic, mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.0', changes: ['x'] } });
    const { c, run } = await ready(h, 'FBET_INST_U');
    expect(run.result).toBe('READY');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan).toMatchObject({ state: 'BLOCKED', classification: 'UPGRADE' });
    expect(plan.blockers.map((b: { code: string }) => b.code)).toContain('UPGRADE_RECOVERY_UNAVAILABLE');
    const res = await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true });
    expect([res.status, res.body.error.code]).toEqual([409, 'PLAN_BLOCKED']);
    expect(h.model.calls).toEqual([]);
    expect(existsSync(join(h.releases, 'FBET_INST_U'))).toBe(false);
  });

  it('IN-01 / IN-02: an existing DRAFT of the version is reused (no duplicate B02 planned); an APPROVED / ACTIVE same version is VERSION_LOCKED', async () => {
    const h = build({ registered: [{ moduleKey: 'FBET_INST_DR', moduleVersion: '1.0.0', status: 'DRAFT', activeRoutes: null }, { moduleKey: 'FBET_INST_LK', moduleVersion: '1.0.0', status: 'APPROVED', activeRoutes: null }] });
    writePackage(h.modules, 'FBET_INST_DR');
    const dr = await ready(h, 'FBET_INST_DR');
    const plan = (await h.post(`/foundation/module-candidates/${dr.c.candidateId}/install/prepare`)).body.installation;
    const draftId = h.model.versions.find((v) => v.status === 'DRAFT')?.versionId;
    expect(plan.steps.find((s: { key: string }) => s.key === 'VERSION').detail).toBe(`Dùng lại DRAFT ${draftId} (không tạo bản trùng).`);
    expect(plan.blockers).toEqual([]); // REV-01 A10: a registered module without ACTIVE version is installable
    writePackage(h.modules, 'FBET_INST_LK');
    const scan = await h.post('/foundation/module-packages/scan');
    const lk = await h.post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey: 'FBET_INST_LK' });
    expect([lk.status, lk.body.error.code]).toEqual([409, 'CANDIDATE_NOT_ELIGIBLE']); // locked version: not even a candidate (MS-17)
  });

  it('plan validity: expired plan → 409 PLAN_EXPIRED; unknown plan → 404; not acknowledged → 400', async () => {
    let now = Date.parse('2026-10-23T03:00:00Z');
    const h = build({ now: () => now });
    writePackage(h.modules, 'FBET_INST_X');
    const { c } = await ready(h, 'FBET_INST_X');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect((await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: randomUUID(), acknowledge: true })).status).toBe(404);
    now += 16 * 60 * 1000;
    const res = await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true });
    expect([res.status, res.body.error.code]).toEqual([409, 'PLAN_EXPIRED']);
    expect(h.model.calls).toEqual([]);
  });

  it('SEC-07: two commits of the same module at once → one proceeds, the other is refused (no double register / activate)', async () => {
    const h = build();
    writePackage(h.modules, 'FBET_INST_Y');
    const { c } = await ready(h, 'FBET_INST_Y');
    const p1 = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    const p2 = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    const [a, b] = await Promise.all([
      h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: p1.installId, acknowledge: true }),
      h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: p2.installId, acknowledge: true }),
    ]);
    const states = [a, b].map((r) => (r.status === 200 ? r.body.installation.state : r.body.error.code));
    expect(states.filter((x) => x === 'AWAITING_RESTART')).toHaveLength(1);
    expect(states.filter((x) => x === 'INSTALL_IN_PROGRESS' || x === 'PLAN_BLOCKED')).toHaveLength(1);
    expect(h.model.calls.filter((x) => x.startsWith('REGISTER'))).toHaveLength(1);
  });

  it('ACTOR_PERMISSION_MISSING: without IAM catalog permission the plan is blocked (fail closed, no partial install)', async () => {
    const h = build({ grants: ALL.filter((p) => p !== PERM_IAM_ID) });
    writePackage(h.modules, 'FBET_INST_I');
    const { c } = await ready(h, 'FBET_INST_I');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan.blockers.find((b: { code: string }) => b.code === 'ACTOR_PERMISSION_MISSING')?.message).toContain('iam.permissions.manage');
  });
});

describe('FMI-03 IAM catalog privilege (fail closed before any write)', () => {
  it('the IAM connection cannot INSERT iam_permissions → plan BLOCKED (IAM_DB_GRANT_MISSING); commit refused; nothing registered', async () => {
    const h = build({ iamWritable: false });
    writePackage(h.modules, 'FBET_INST_Q');
    const { c } = await ready(h, 'FBET_INST_Q');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan.state).toBe('BLOCKED');
    expect(plan.blockers.map((b: { code: string }) => b.code)).toEqual(['IAM_DB_GRANT_MISSING']);
    expect((await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).status).toBe(409);
    expect(h.model.calls).toEqual([]);
  });
});

// FOUNDATION-REV-01 REV-A — red tests written before the fix (implementation-evidence/RED-TESTS.md).
describe('FOUNDATION-REV-01 REV-A installer', () => {
  const template = (key: string, version: string) => ({ ...validMic(key, version), mic02Functions: [{ functionKey: 'MAIN', name: 'Chức năng chính' }],
    mic03Actions: [{ functionKey: 'MAIN', actionKey: 'READ', name: 'Xem', nature: 'READ' }], mic04Navigation: [{ menuLabel: key }, { menuLabel: 'Chính', routePath: `/${key.toLowerCase()}`, screenKey: 'x.main', functionKey: 'MAIN' }],
    mic05Api: [], mic06DataResources: [], mic07IamMapping: [{ functionKey: 'MAIN', actionKey: 'READ', moduleCode: key, resourceCode: 'MAIN', operation: 'READ', minimumAssuranceLevel: 1 }],
    mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [{ name: 'x', result: 'NOT_TESTED', reference: 'x' }] } });

  it('A01 / A02 / A10: registered module without ACTIVE + DRAFT holding a MAIN.READ template → plan shows the MIC diff; commit reuses the DRAFT and stores the Candidate MIC (fresh read back)', async () => {
    const h = build({ registered: [{ moduleKey: 'FBET_REV_DR', moduleVersion: '1.0.0', status: 'DRAFT', activeRoutes: null }], draftMic: template('FBET_REV_DR', '1.0.0') });
    writePackage(h.modules, 'FBET_REV_DR');
    const { c } = await ready(h, 'FBET_REV_DR');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan).toMatchObject({ state: 'PREPARED', classification: 'UPGRADE', blockers: [] });
    expect(plan.micDiff.filter((d: { changed: boolean }) => d.changed).map((d: { section: string }) => d.section)).toEqual(expect.arrayContaining(['mic02Functions', 'mic05Api', 'mic07IamMapping']));
    expect(plan.micDiff.find((d: { section: string }) => d.section === 'mic05Api')).toMatchObject({ draft: 0, candidate: 2 });
    const done = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    expect(done.state).toBe('AWAITING_RESTART');
    expect(h.model.calls).toEqual(['PUT_MIC', 'SUBMIT', 'APPROVE']); // no REGISTER, no CREATE_VERSION
    const stored = h.model.versions[0]?.mic as { mic02Functions: { functionKey: string }[]; mic05Api: unknown[] };
    expect([stored.mic02Functions.map((f) => f.functionKey), stored.mic05Api.length]).toEqual([['ORDER', 'REPORT'], 2]);
    expect(done.steps.find((s: { key: string }) => s.key === 'MIC').detail).toContain('đọc lại khớp');
  });

  it('A03: the DRAFT MIC changed after the plan → commit refused DRAFT_CHANGED_EXTERNALLY, nothing written', async () => {
    const h = build({ registered: [{ moduleKey: 'FBET_REV_CX', moduleVersion: '1.0.0', status: 'DRAFT', activeRoutes: null }], draftMic: template('FBET_REV_CX', '1.0.0') });
    writePackage(h.modules, 'FBET_REV_CX');
    const { c } = await ready(h, 'FBET_REV_CX');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    const v = h.model.versions[0];
    if (v) v.mic = { ...template('FBET_REV_CX', '1.0.0'), mic08EventsAudit: { eventCodes: ['EDITED_BY_SOMEONE'], auditActionCodes: [] } };
    const res = await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true });
    expect([res.status, res.body.error.code, res.body.error.details.blockers]).toEqual([409, 'PLAN_BLOCKED', ['DRAFT_CHANGED_EXTERNALLY']]);
    expect(h.model.calls).toEqual([]);
  });

  it('A13 / A15: catalog created but no IAM assignment → POSTCHECK_INCOMPLETE (IAM_POLICY / ACCESS_VERIFIED NOT_TESTED), module kept ACTIVE + ENABLED, never INSTALLED_ACTIVE', async () => {
    const h = build();
    writePackage(h.modules, 'FBET_REV_PC');
    const { c } = await ready(h, 'FBET_REV_PC');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    const done = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    h.restart();
    const r = (await h.post(`/foundation/module-installations/${done.installId}/continue`)).body.installation;
    expect(r.state).toBe('POSTCHECK_INCOMPLETE');
    expect(r.postcheck.filter((p: { status: string }) => p.status !== 'PASS').map((p: { key: string; status: string }) => `${p.key}:${p.status}`)).toEqual(['IAM_POLICY:NOT_TESTED', 'ACCESS_VERIFIED:NOT_TESTED']);
    expect(h.model.modules.find((m) => m.moduleKey === 'FBET_REV_PC')?.enabled).toBe(true);
    expect(h.model.calls).not.toContain('DISABLE');
  });

  it('A14: B09 is written through the Builder contract (AREA → MENU → FUNCTION, no legacy); a HIDDEN link does not count as done; rerun adds no duplicate', async () => {
    const h = build({ moduleAllowed: true });
    writePackage(h.modules, 'FBET_REV_NV');
    const { c } = await ready(h, 'FBET_REV_NV');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan.navigationPlan).toMatchObject({ area: expect.any(String), menu: expect.any(String), links: [{ functionKey: 'ORDER', title: 'Đơn hàng' }] });
    const done = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    h.restart();
    const first = (await h.post(`/foundation/module-installations/${done.installId}/continue`)).body.installation;
    expect(first.state).toBe('POSTCHECK_INCOMPLETE'); // no assignment yet
    const layout = readLayout(h.model.nav);
    expect(layout.legacy).toEqual([]);
    expect(layout.areas.flatMap((a) => a.menus.flatMap((m) => m.items))).toHaveLength(1);
    // someone hides the link: it must not be counted as linked
    const link = h.model.nav.find((n) => n.functionId !== null);
    if (link) h.model.nav[h.model.nav.indexOf(link)] = { ...link, isVisible: false };
    h.model.assignments = 1;
    const second = (await h.post(`/foundation/module-installations/${done.installId}/continue`)).body.installation;
    expect(second.state).toBe('INSTALLED_ACTIVE');
    const after = readLayout(h.model.nav);
    expect(after.legacy).toEqual([]);
    expect(after.areas.flatMap((a) => a.menus.flatMap((m) => m.items)).filter((l) => l.visible)).toHaveLength(1); // re-shown, not duplicated
    expect(h.model.nav).toHaveLength(3);
  });
  it('A08 / E2E-05: an allowed session getting 200 with an error envelope (wrong response contract) → ACCESS_VERIFIED FAIL with the endpoint → RECOVERY_REQUIRED, never success', async () => {
    const h = build({ moduleAllowed: true });
    writePackage(h.modules, 'FBET_REV_CT');
    const { c } = await ready(h, 'FBET_REV_CT');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    const done = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    h.restart();
    h.model.assignments = 1;
    const broken = express.Router();
    broken.get('/fbet-rev-ct/orders', (req, res) => { if (!String(req.headers.cookie ?? '').includes(TOKEN)) { res.status(401).json({ error: { code: 'SESSION_INVALID' } }); return; } res.status(200).json({ error: { code: 'OOPS' } }); });
    broken.post('/fbet-rev-ct/orders', (_req, res) => { res.status(401).json({ error: { code: 'SESSION_INVALID' } }); });
    h.runtime.routers.set('FBET_REV_CT', broken);
    const r = (await h.post(`/foundation/module-installations/${done.installId}/continue`)).body.installation;
    expect(r.state).toBe('RECOVERY_REQUIRED');
    expect(r.postcheck.find((x: { key: string }) => x.key === 'ACCESS_VERIFIED')).toMatchObject({ status: 'FAIL', detail: 'GET /api/fbet-rev-ct/orders → 200' });
  });
});

// REV01-D1 — upgrade of a module with an ACTIVE version: recovery point, journalled activation, controlled rollback and
// verified recovery. Red before the fix: every upgrade plan was BLOCKED (UPGRADE_RECOVERY_UNAVAILABLE).
describe('REV01-D1 upgrade recovery', { timeout: 30_000 }, () => {
  const UPG = [...ALL, PERM_RETIRE_ID];
  const mic11 = (key: string) => {
    const m = micOf(key, '1.1.0');
    return { ...m, mic04Navigation: [...m.mic04Navigation, { menuLabel: 'Báo cáo', routePath: `${slug(key)}/report`, screenKey: 'pkg.report', functionKey: 'REPORT' }],
      mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.0', changes: ['Thêm báo cáo'] } };
  };
  const lockOf = (h: H, key: string) => parseDeployments(JSON.parse(readFileSync(h.lockFile, 'utf8'))).get(key);
  const status = (h: H, key: string) => Object.fromEntries(h.model.versions.filter((v) => h.model.modules.find((m) => m.moduleId === v.moduleId)?.moduleKey === key).map((v) => [v.moduleVersion, v.status]));
  const cont = (h: H, id: string) => h.post(`/foundation/module-installations/${id}/continue`);
  async function installed(h: H, key: string) {
    writePackage(h.modules, key);
    const { c } = await ready(h, key);
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    const done = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    h.restart();
    h.model.assignments = 1;
    expect((await cont(h, done.installId)).body.installation.state).toBe('INSTALLED_ACTIVE');
    return lockOf(h, key);
  }
  async function upgrade(h: H, key: string) {
    writePackage(h.modules, key, '1.1.0', mic11(key));
    const { c } = await ready(h, key);
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan).toMatchObject({ state: 'PREPARED', classification: 'UPGRADE', blockers: [] });
    const done = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    expect(done.state).toBe('AWAITING_RESTART');
    return { c, plan, done, id: String(done.installId) };
  }

  it('D1-01 success: recovery point taken at commit (B01/B02/MIC hash/lock/IAM/B09), activation journalled, 1.0.0 RETIRED, INSTALLED_ACTIVE, no rollback', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    const v1 = await installed(h, 'FBET_UPG_OK');
    const { done, id } = await upgrade(h, 'FBET_UPG_OK');
    expect(done.recoveryPoint).toMatchObject({ activeVersion: '1.0.0', enabled: true, lock: v1, activeManifestHash: expect.stringMatching(/^[0-9a-f]{64}$/), navigationRevision: expect.any(String) });
    expect(done.recoveryPoint.iamPermissions).toHaveLength(3);
    expect(lockOf(h, 'FBET_UPG_OK')?.packageVersion).toBe('1.1.0');
    expect(status(h, 'FBET_UPG_OK')).toEqual({ '1.0.0': 'ACTIVE', '1.1.0': 'APPROVED' }); // nothing activated before the restart
    h.restart();
    const fin = (await cont(h, id)).body.installation;
    expect(fin.state).toBe('INSTALLED_ACTIVE');
    expect(status(h, 'FBET_UPG_OK')).toEqual({ '1.0.0': 'RETIRED', '1.1.0': 'ACTIVE' });
    expect(fin.activation).toMatchObject({ versionId: done.after.versionId, retiredVersionId: done.recoveryPoint.activeVersionId, activatedAt: expect.any(String) });
    expect(fin.navigationAdded).toHaveLength(1);
    expect(h.model.calls.some((x) => x.startsWith('ROLLBACK'))).toBe(false);
    expect((await h.get(`/foundation/module-installations/${id}/report.txt`)).text).toContain('Điểm phục hồi: 1.0.0');
  });

  it('D1-02 failure before cutover (Activation Gate refuses 1.1.0): B02 untouched, lock restored → RECOVERY_AWAITING_RESTART; RESTART_PENDING until the old release runs; then RECOVERED', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    const v1 = await installed(h, 'FBET_UPG_GT');
    const { id } = await upgrade(h, 'FBET_UPG_GT');
    h.restart();
    h.fakeFail.set('activate', 'ACTIVATION_BLOCKED');
    const r = (await cont(h, id)).body.installation;
    expect(r.state).toBe('RECOVERY_AWAITING_RESTART');
    expect(r.rollback).toMatchObject({ b02: 'NOT_NEEDED', b01: 'NOT_NEEDED', navigation: 'NOT_NEEDED', lock: 'DONE' });
    expect(status(h, 'FBET_UPG_GT')).toEqual({ '1.0.0': 'ACTIVE', '1.1.0': 'APPROVED' });
    expect(lockOf(h, 'FBET_UPG_GT')).toEqual(v1);
    const early = await cont(h, id);
    expect([early.status, early.body.error.code]).toEqual([409, 'RESTART_PENDING']); // the process still runs 1.1.0
    expect((await h.get(`/foundation/module-installations/${id}`)).body.installation.state).toBe('RECOVERY_AWAITING_RESTART');
    h.restart();
    const fin = (await cont(h, id)).body.installation;
    expect(fin.state).toBe('RECOVERED');
    expect(fin.postcheck.map((p: { key: string; status: string }) => `${p.key}:${p.status}`)).toEqual(['RECOVERY_RUNTIME:PASS', 'RECOVERY_B02:PASS', 'RECOVERY_B01:PASS', 'RECOVERY_NAVIGATION:PASS', 'API_SMOKE:PASS']);
    expect((await cont(h, id)).status).toBe(409); // terminal
  });

  it('D1-03 failure after activation (B09 apply fails): Lifecycle ROLLBACK with the journal, 1.1.0 RETIRED / 1.0.0 ACTIVE, old lock; after restart RECOVERED', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    const v1 = await installed(h, 'FBET_UPG_NV');
    const { id } = await upgrade(h, 'FBET_UPG_NV');
    h.restart();
    h.fakeFail.set('nav', 'NAVIGATION_CONFLICT');
    const r = (await cont(h, id)).body.installation;
    expect(r.steps.find((s: { key: string }) => s.key === 'NAVIGATION')).toMatchObject({ status: 'FAILED', detail: 'NAVIGATION_CONFLICT' });
    expect(r.state).toBe('RECOVERY_AWAITING_RESTART');
    expect(r.rollback).toMatchObject({ b02: 'DONE', lock: 'DONE' });
    expect(h.model.calls.filter((x) => x.startsWith('ROLLBACK'))).toEqual([`ROLLBACK 1.1.0→1.0.0 ${id.slice(0, 8)}`]);
    expect(status(h, 'FBET_UPG_NV')).toEqual({ '1.0.0': 'ACTIVE', '1.1.0': 'RETIRED' });
    expect(lockOf(h, 'FBET_UPG_NV')).toEqual(v1);
    expect(r.recovery.join(' ')).toContain('DEPLOY_RESTART_REQUIRED');
    h.fakeFail.delete('nav');
    h.restart();
    expect((await cont(h, id)).body.installation.state).toBe('RECOVERED');
  });

  it('D1-04 postcheck FAIL (router not mounted): rollback hides the B09 link this install added (no delete), restores B02 + lock; RECOVERED only after the old router answers', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    await installed(h, 'FBET_UPG_PC');
    const navBefore = h.model.nav.length;
    const { id } = await upgrade(h, 'FBET_UPG_PC');
    h.restart();
    h.runtime.routers.delete('FBET_UPG_PC');
    const r = (await cont(h, id)).body.installation;
    expect(r.postcheck.find((p: { key: string }) => p.key === 'API_SMOKE').status).toBe('FAIL');
    expect(r.state).toBe('RECOVERY_AWAITING_RESTART');
    expect(r.rollback).toMatchObject({ b02: 'DONE', navigation: 'DONE', lock: 'DONE' });
    const report = h.model.functions.find((f) => f.functionKey === 'REPORT' && h.model.modules.find((m) => m.moduleId === f.moduleId)?.moduleKey === 'FBET_UPG_PC');
    expect(h.model.nav.filter((n) => n.functionId === report?.functionId).map((n) => n.isVisible)).toEqual([false]);
    expect(h.model.nav).toHaveLength(navBefore + 1); // added once, then hidden — never deleted
    h.restart(); // the old process mounts its router again
    const fin = (await cont(h, id)).body.installation;
    expect(fin.state).toBe('RECOVERED');
    expect(status(h, 'FBET_UPG_PC')).toEqual({ '1.0.0': 'ACTIVE', '1.1.0': 'RETIRED' });
  });

  it('D1-05 interrupted restart: only the backend restarted → RESTART_PENDING, nothing activated; same after a rollback (state kept)', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    await installed(h, 'FBET_UPG_RS');
    const { id } = await upgrade(h, 'FBET_UPG_RS');
    const backendOnly = () => { h.runtime.modules = [...parseDeployments(JSON.parse(readFileSync(h.lockFile, 'utf8'))).entries()].map(([moduleKey, v]) => ({ moduleKey, ...v })); };
    backendOnly();
    const early = await cont(h, id);
    expect([early.status, early.body.error.code]).toEqual([409, 'RESTART_PENDING']);
    expect(h.model.calls.filter((x) => x === 'ACTIVATE')).toHaveLength(1); // only the 1.0.0 install
    expect((await h.get(`/foundation/module-installations/${id}`)).body.installation.state).toBe('AWAITING_RESTART');
    h.restart();
    h.fakeFail.set('activate', 'ACTIVATION_BLOCKED');
    expect((await cont(h, id)).body.installation.state).toBe('RECOVERY_AWAITING_RESTART');
    backendOnly();
    const mid = await cont(h, id);
    expect([mid.status, mid.body.error.code]).toEqual([409, 'RESTART_PENDING']);
    expect((await h.get(`/foundation/module-installations/${id}`)).body.installation.state).toBe('RECOVERY_AWAITING_RESTART');
  });

  it('D1-06 recovery failing midway (Lifecycle ROLLBACK busy): RECOVERY_REQUIRED, 1.1.0 still ACTIVE, lock NOT restored; retry finishes the remaining steps once', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    const v1 = await installed(h, 'FBET_UPG_MF');
    const { id } = await upgrade(h, 'FBET_UPG_MF');
    h.restart();
    h.fakeFail.set('nav', 'NAVIGATION_CONFLICT');
    h.fakeFail.set('recoverUpgrade', 'SERVICE_BUSY');
    const r = (await cont(h, id)).body.installation;
    expect(r.state).toBe('RECOVERY_REQUIRED');
    expect(r.rollback).toMatchObject({ b02: 'PENDING', lock: 'PENDING' });
    expect(r.recovery.join(' ')).toContain('B02 (SERVICE_BUSY)');
    expect(status(h, 'FBET_UPG_MF')).toEqual({ '1.0.0': 'RETIRED', '1.1.0': 'ACTIVE' });
    expect(lockOf(h, 'FBET_UPG_MF')?.packageVersion).toBe('1.1.0'); // runtime and B02 stay consistent
    h.fakeFail.clear();
    const again = (await cont(h, id)).body.installation;
    expect(again.state).toBe('RECOVERY_AWAITING_RESTART');
    expect(lockOf(h, 'FBET_UPG_MF')).toEqual(v1);
    expect(h.model.calls.filter((x) => x.startsWith('ROLLBACK'))).toHaveLength(1);
    h.restart();
    expect((await cont(h, id)).body.installation.state).toBe('RECOVERED');
  });

  it('D1-07 competing installs: a second plan is INSTALL_IN_PROGRESS while the upgrade (or its recovery) is open; two continues at once → one runs, one 409, ACTIVATE once', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    await installed(h, 'FBET_UPG_CC');
    const { c, id } = await upgrade(h, 'FBET_UPG_CC');
    const second = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(second.blockers.map((b: { code: string }) => b.code)).toContain('INSTALL_IN_PROGRESS');
    h.restart();
    const [a, b] = await Promise.all([cont(h, id), cont(h, id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((x) => x.status === 409)?.body.error.code).toMatch(/^(INSTALL_IN_PROGRESS|INSTALL_STATE_CONFLICT)$/);
    expect(h.model.calls.filter((x) => x === 'ACTIVATE')).toHaveLength(2); // 1.0.0 install + this upgrade, once
    expect((await h.get(`/foundation/module-installations/${id}`)).body.installation.state).toBe('INSTALLED_ACTIVE');
    // during an open recovery the module is busy too
    const h2 = build({ moduleAllowed: true, grants: UPG });
    await installed(h2, 'FBET_UPG_CR');
    const u = await upgrade(h2, 'FBET_UPG_CR');
    h2.restart();
    h2.fakeFail.set('activate', 'ACTIVATION_BLOCKED');
    expect((await cont(h2, u.id)).body.installation.state).toBe('RECOVERY_AWAITING_RESTART');
    const blocked = (await h2.post(`/foundation/module-candidates/${u.c.candidateId}/install/prepare`)).body.installation;
    expect(blocked.blockers.map((x: { code: string }) => x.code)).toContain('INSTALL_IN_PROGRESS');
  });

  it('D1-08 reopen after a process restart: a NEW installer instance over the same journal continues the recovery and verifies it', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    await installed(h, 'FBET_UPG_RO');
    const { c, id } = await upgrade(h, 'FBET_UPG_RO');
    h.restart();
    h.fakeFail.set('nav', 'NAVIGATION_CONFLICT');
    expect((await cont(h, id)).body.installation.state).toBe('RECOVERY_AWAITING_RESTART');
    h.fakeFail.clear();
    h.restart();
    const service2 = new ModuleInstallerService({
      access: h.access, db: new ModelDb(h.model), registry: h.registry, scans: h.scans, modules: h.fakes.modules, versions: h.fakes.versions, manifests: h.fakes.manifests,
      lifecycle: h.fakes.lifecycle, navigation: h.fakes.navigation, iam: h.iamCatalog, runtime: h.runtime as InstallerRuntime, paths: h.paths, store: new InstallerStore(join(h.base, 'var', 'installer')),
      environment: { label: 'TEST', database: 'talo_mos_v4_test', nodeEnv: 'test' }, allowedDatabase: 'talo_mos_v4_test', logger: h.logger,
    });
    const app2 = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger: h.logger, apiRouters: [moduleInstallerRouter({ authService: h.auth, service: service2, secureCookie: false })] });
    const cand = await request(app2).get(`/api/foundation/module-candidates/${c.candidateId}`).set('Cookie', `talo_sid=${TOKEN}`);
    expect(cand.body.candidate.latestInstallId).toBe(id);
    const res = await request(app2).post(`/api/foundation/module-installations/${id}/continue`).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', `talo_sid=${TOKEN}`).send('{}');
    expect(res.body.installation.state).toBe('RECOVERED');
  });

  it('D1-09 state / hash mismatch: ACTIVE target without a journalled activation → UNPROVEN (no rollback, lock kept); a foreign ACTIVE → 409 UPGRADE_STATE_MISMATCH; a changed old release → lock UNPROVEN', async () => {
    const h = build({ moduleAllowed: true, grants: UPG });
    await installed(h, 'FBET_UPG_UP');
    const { id } = await upgrade(h, 'FBET_UPG_UP');
    const mod = h.model.modules.find((m) => m.moduleKey === 'FBET_UPG_UP');
    for (const v of h.model.versions.filter((x) => x.moduleId === mod?.moduleId)) { v.status = v.moduleVersion === '1.1.0' ? 'ACTIVE' : 'RETIRED'; v.activatedAt ??= '2026-10-24T01:00:00.000000Z'; } // activated outside the installer
    h.restart();
    const r = (await cont(h, id)).body.installation;
    expect(r.state).toBe('RECOVERY_REQUIRED');
    expect(r.rollback.b02).toBe('UNPROVEN');
    expect(r.recovery.join(' ')).toContain('không phục hồi tự động');
    expect(h.model.calls.some((x) => x.startsWith('ROLLBACK'))).toBe(false);
    expect(lockOf(h, 'FBET_UPG_UP')?.packageVersion).toBe('1.1.0');
    expect((await cont(h, id)).body.installation.rollback.b02).toBe('UNPROVEN'); // retry: still no guess

    const h2 = build({ moduleAllowed: true, grants: UPG });
    await installed(h2, 'FBET_UPG_FA');
    const u = await upgrade(h2, 'FBET_UPG_FA');
    const m2 = h2.model.modules.find((m) => m.moduleKey === 'FBET_UPG_FA');
    for (const v of h2.model.versions.filter((x) => x.moduleId === m2?.moduleId && x.status === 'ACTIVE')) v.status = 'RETIRED';
    h2.model.versions.push({ versionId: randomUUID(), moduleId: m2?.moduleId ?? '', moduleVersion: '1.0.9', status: 'ACTIVE', mic: null, activatedAt: '2026-10-24T02:00:00.000000Z' });
    h2.restart();
    const res = await cont(h2, u.id);
    expect([res.status, res.body.error.code]).toEqual([409, 'UPGRADE_STATE_MISMATCH']);
    expect(h2.model.calls.filter((x) => x === 'ACTIVATE')).toHaveLength(1);

    const h3 = build({ moduleAllowed: true, grants: UPG });
    await installed(h3, 'FBET_UPG_RH');
    const w = await upgrade(h3, 'FBET_UPG_RH');
    h3.restart();
    writeFileSync(join(releaseDir(h3.releases, 'FBET_UPG_RH', '1.0.0'), 'backend', 'index.ts'), 'export const TAMPERED = 1;\n');
    h3.fakeFail.set('nav', 'NAVIGATION_CONFLICT');
    const t = (await cont(h3, w.id)).body.installation;
    expect(t.state).toBe('RECOVERY_REQUIRED');
    expect(t.rollback).toMatchObject({ b02: 'DONE', lock: 'UNPROVEN' });
    expect(lockOf(h3, 'FBET_UPG_RH')?.packageVersion).toBe('1.1.0');
  });

  it('D1-10 no recovery point → the gate stays: actor without RETIRE, or the old release missing from the store → BLOCKED', async () => {
    const h = build({ moduleAllowed: true, grants: ALL }); // no RETIRE
    await installed(h, 'FBET_UPG_NR');
    writePackage(h.modules, 'FBET_UPG_NR', '1.1.0', mic11('FBET_UPG_NR'));
    const { c } = await ready(h, 'FBET_UPG_NR');
    const plan = (await h.post(`/foundation/module-candidates/${c.candidateId}/install/prepare`)).body.installation;
    expect(plan.state).toBe('BLOCKED');
    expect(plan.blockers.find((b: { code: string }) => b.code === 'ACTOR_PERMISSION_MISSING').message).toContain('foundation.module_version.retire');
    const h2 = build({ moduleAllowed: true, grants: UPG });
    await installed(h2, 'FBET_UPG_NL');
    rmSync(releaseDir(h2.releases, 'FBET_UPG_NL', '1.0.0'), { recursive: true, force: true });
    writePackage(h2.modules, 'FBET_UPG_NL', '1.1.0', mic11('FBET_UPG_NL'));
    const r2 = await ready(h2, 'FBET_UPG_NL');
    const p2 = (await h2.post(`/foundation/module-candidates/${r2.c.candidateId}/install/prepare`)).body.installation;
    expect(p2.blockers.find((b: { code: string }) => b.code === 'UPGRADE_RECOVERY_UNAVAILABLE').message).toContain('kho release không có');
  });
});
