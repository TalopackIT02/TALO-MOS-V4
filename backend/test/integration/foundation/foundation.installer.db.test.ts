import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Express, Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma/client.js';
import type { PrismaClient } from '../../../src/infrastructure/prisma/generated/client.js';
import { createHostCapabilities } from '../../../src/module-host/capabilities.js';
import type { HostCapabilities } from '../../../src/module-host/contract.js';
import { createAuthModule } from '../../../src/modules/auth/index.js';
import { PasswordHasher } from '../../../src/modules/auth/passwordHasher.js';
import { SlidingWindowRateLimiter } from '../../../src/modules/auth/rateLimiter.js';
import { createFoundationModule } from '../../../src/modules/foundation/index.js';
import type { FoundationModule } from '../../../src/modules/foundation/index.js';
import { createIamCatalog } from '../../../src/modules/foundation/foundation.installer.iam.js';
import type { IamCatalog } from '../../../src/modules/foundation/foundation.installer.service.js';
import type { Exec } from '../../../src/modules/foundation/foundation.preflight.js';
import { SqlFoundationRepository, prismaFoundationDb } from '../../../src/modules/foundation/foundation.repository.js';
import { parseDeployments, releaseDir, syncModules, writeDeployments } from '../../../scripts/modules-sync.mjs';
import { TEST_ORIGIN } from '../../helpers/testApp.js';
import { checkSmokeUrl } from '../../smoke/dbSmoke.js';
import { AuthFixtures } from '../../support/authFixtures.js';
import { PsqlSession, lit, uuidArray } from '../sc5/harness.js';

// FMI-03 — Foundation Installer on PostgreSQL 18.6 (talo_mos_v4_test). Runs only with TALO_FOUNDATION_DB=1.
// A synthetic NEW module FBET_INST_<RUN> (routes in its own namespace /fbet-inst-<run>, never a product route) goes through
// the REAL Foundation services as talo_app: scan → candidate → preflight → prepare → commit (B01, B02, MIC with the
// server's MIC-10 evidence, SUBMIT, APPROVE, deployment lock of a TEMPORARY folder) → AWAITING_RESTART → "restart"
// (real sync from the temporary release store, the release's backend entry mounted with the REAL Host capabilities)
// → continue (ACTIVATE through the real Activation Gate, ENABLE, B09 through the real navigation service) → postcheck.
//   IAM (REV01-D2): the REAL IAM catalog (IAM Management repository on the talo_iam_admin connection, column grants that
//   pre-exist on TEST) writes the K05 rows and the IAM audit; refusals are proven on the same path (module not ACTIVE,
//   wrong K05, duplicate, actor without iam.permissions.manage). The run's K05 rows are removed by UUID afterwards.
//   REV01-D1: the same fixture module is then upgraded 1.0.0 → 1.1.0 with a postcheck FAIL (router not mounted) → real
//   Lifecycle recoverUpgrade → old lock → "restart" → RECOVERED; then 1.0.0 → 1.2.0 succeeds (INSTALLED_ACTIVE).
// The toolchain of the preflight is a recorded fake here (real toolchain: foundation.preflight.toolchain.test.ts).
// Cleanup: the run's version is RETIRED and its menu group hidden through the API (Foundation rows are append-only, C2).

const enabled = process.env['TALO_FOUNDATION_DB'] === '1';
const PERM_CODES = ['foundation.module_registry.read', 'foundation.module_registry.create', 'foundation.module_version.create', 'foundation.module_version.update',
  'foundation.module_version.submit', 'foundation.module_version.approve', 'foundation.module_version.activate', 'foundation.module_version.retire',
  'foundation.module_registry.enable', 'foundation.module_registry.disable', 'foundation.navigation.manage', 'iam.permissions.manage'];
const BACKEND = resolve(import.meta.dirname, '../../..');
const write = (file: string, text: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

describe.skipIf(!enabled)('FMI-03 installer — PostgreSQL (talo_mos_v4_test)', { timeout: 300_000 }, () => {
  const run = `${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString('hex').toUpperCase()}`;
  const moduleKey = `FBET_INST_${run}`;
  const route = `/${moduleKey.toLowerCase().replace(/_/g, '-')}`;
  let prisma: PrismaClient;
  let iamPrisma: PrismaClient;
  let h: PsqlSession;
  let fx: AuthFixtures;
  let app: Express;
  let foundation: FoundationModule;
  let authService: Awaited<ReturnType<typeof createAuthModule>>['service'];
  let base = '';
  let cookie = '';
  let actorId = '';
  const roles: string[] = [];
  const userRoles: string[] = [];
  const createdPermissions: string[] = [];
  const runtime: { modules: { moduleKey: string; packageVersion: string; packageHash: string | null }[]; routers: Map<string, Router> } = { modules: [], routers: new Map() };
  const evidence: Record<string, unknown> = {};
  let realIam: IamCatalog;
  const logs: string[] = [];
  const logger = createLogger({ level: 'warn', sink: (line) => logs.push(line) });
  const exec: Exec = async (args) => {
    const tool = args[0] ?? '';
    if (tool.endsWith('tsc')) return { exitCode: 0, output: '', timedOut: false, durationMs: 1 };
    if (tool.endsWith('vitest.mjs')) return { exitCode: 0, output: '      Tests  1 passed (1)\n', timedOut: false, durationMs: 1 };
    const declared = [`GET ${route}/orders`, `POST ${route}/orders`];
    return { exitCode: 0, timedOut: false, durationMs: 1, output: `${JSON.stringify({ moduleKey, handshake: [], routes: { mounted: declared, declared, missing: [], undeclared: [] },
      smoke: declared.map((d) => ({ method: d.split(' ')[0], path: `/api${d.split(' ')[1]}`, status: 401, code: 'SESSION_INVALID' })) })}\n` };
  };
  // REV01-D2: the installer uses the REAL IAM catalog only (no test-only writer).
  const iam: IamCatalog = {
    get permission() { return realIam.permission; },
    existing: (m) => realIam.existing(m),
    writable: () => realIam.writable(),
    assignments: (m) => realIam.assignments(m),
    create: (a, r) => realIam.create(a, r),
  };
  // module.json + MIC of one package version of the fixture (same backend / frontend entries; CHANGE from the ACTIVE 1.0.0).
  const writeVersion = (version: string) => {
    const pkg = join(base, 'modules', moduleKey);
    const manifest = JSON.parse(readFileSync(join(pkg, 'module.json'), 'utf8')) as Record<string, unknown>;
    write(join(pkg, 'module.json'), JSON.stringify({ ...manifest, packageVersion: version }));
    write(join(pkg, 'mic', 'module.mic.json'), JSON.stringify({
      mic01Identity: { moduleKey, moduleName: `FBET installer ${run}`, moduleVersion: version, micStandard: 'MIC-1.0' },
      mic02Functions: [{ functionKey: 'ORDER', name: 'Đơn hàng' }],
      mic03Actions: [{ functionKey: 'ORDER', actionKey: 'READ', name: 'Xem', nature: 'READ' }, { functionKey: 'ORDER', actionKey: 'CREATE', name: 'Tạo', nature: 'WRITE' }],
      mic04Navigation: [{ menuLabel: 'FBET' }, { menuLabel: 'Đơn hàng', routePath: route, screenKey: 'fbet.inst', functionKey: 'ORDER' }],
      mic05Api: [
        { method: 'GET', path: `/api${route}/orders`, functionKey: 'ORDER', actionKey: 'READ', errors: [] },
        { method: 'POST', path: `/api${route}/orders`, functionKey: 'ORDER', actionKey: 'CREATE', errors: [] },
      ],
      mic06DataResources: [{ resourceKey: 'ORDER_FEED', interfaceKind: 'API', columns: [], relations: [], access: [{ functionKey: 'ORDER', actionKey: 'READ', operation: 'SELECT' }] }],
      mic07IamMapping: [
        { functionKey: 'ORDER', actionKey: 'READ', moduleCode: moduleKey, resourceCode: 'ORDER', operation: 'READ', minimumAssuranceLevel: 1 },
        { functionKey: 'ORDER', actionKey: 'CREATE', moduleCode: moduleKey, resourceCode: 'ORDER', operation: 'CREATE', minimumAssuranceLevel: 1 },
      ],
      mic08EventsAudit: { eventCodes: [], auditActionCodes: [] },
      mic09Compatibility: version === '1.0.0' ? { kind: 'INITIAL_REGISTRATION', changes: [] } : { kind: 'CHANGE', fromVersion: '1.0.0', changes: [`Nâng cấp ${version}`] },
      mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [{ name: 'declared by the package', result: 'PASS', reference: 'self-declared' }] },
    }));
  };
  // The operator's restart onto the CURRENT lock: Host build from the release store + the release's backend entry
  // (REAL Host capabilities). mount=false: the new process does not mount the module router (postcheck must FAIL).
  const restartOnto = async (mount = true) => {
    const deployments = JSON.parse(readFileSync(join(base, 'module-deployments.json'), 'utf8'));
    syncModules({ target: 'frontend', releasesDir: join(base, 'releases'), deployments, outDir: join(base, 'frontend', 'src', 'installed-modules'), log: () => undefined });
    const entryOf = parseDeployments(deployments).get(moduleKey);
    runtime.modules = entryOf ? [{ moduleKey, packageVersion: entryOf.packageVersion, packageHash: entryOf.packageHash }] : [];
    runtime.routers.delete(moduleKey);
    if (!mount || !entryOf) return;
    const entry = await import(pathToFileURL(join(releaseDir(join(base, 'releases'), moduleKey, entryOf.packageVersion), 'backend', 'index.ts')).href) as { createModule: (h: HostCapabilities) => { router: Router } };
    const db = prismaFoundationDb(prisma);
    runtime.routers.set(moduleKey, entry.createModule(createHostCapabilities(moduleKey, {
      db, access: new SqlFoundationRepository(db), authService, navigation: foundation.navigationService, logger, secureCookie: false,
    })).router);
  };
  const candidateReady = async () => {
    const scan = await post('/foundation/module-packages/scan');
    expect(scan.status).toBe(200);
    const cand = await post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey });
    expect(cand.status, JSON.stringify(cand.body)).toBe(201);
    const candidateId = String(cand.body.candidate.candidateId);
    const start = await post(`/foundation/module-candidates/${candidateId}/preflight`);
    expect(start.status).toBe(202);
    await foundation.installerService?.whenIdle();
    const pf = (await get(`/foundation/module-candidates/${candidateId}/preflight/${start.body.runId}`)).body.run;
    expect(pf.result, JSON.stringify(pf.checks)).toBe('READY');
    return { candidateId, pf };
  };
  const b02 = async () => (await h.ok(`SELECT v.module_version, v.status FROM foundation.fnd_module_versions v JOIN foundation.fnd_modules m ON m.module_id = v.module_id
    WHERE m.module_key = ${lit(moduleKey)} ORDER BY v.module_version`)).map((r) => `${r[0]}:${r[1]}`);
  const post = (url: string, body: unknown = {}) => request(app).post(`/api${url}`).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify(body));
  const get = (url: string) => request(app).get(`/api${url}`).set('User-Agent', fx.userAgent).set('Cookie', cookie);
  const facts = async () => (await h.ok(`SELECT m.module_id, m.is_enabled::text, v.version_id, v.status, v.manifest_json->'mic10Manifest'->'testEvidence'->0->>'reference',
      (SELECT count(*) FROM foundation.fnd_module_versions vv WHERE vv.module_id = m.module_id)::text,
      (SELECT string_agg(e.event_type, ',' ORDER BY e.occurred_at, e.event_type) FROM foundation.fnd_module_events e WHERE e.module_id = m.module_id),
      (SELECT count(*) FROM foundation.fnd_navigation_items n WHERE n.module_id = m.module_id AND n.function_id IS NOT NULL AND n.is_visible)::text,
      (SELECT count(*) FROM iam.iam_permissions p WHERE p.module_code = m.module_key)::text
    FROM foundation.fnd_modules m LEFT JOIN foundation.fnd_module_versions v ON v.module_id = m.module_id WHERE m.module_key = ${lit(moduleKey)}`))[0] ?? [];

  beforeAll(async () => {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const url = process.env['DATABASE_URL'];
    const check = checkSmokeUrl(url);
    if (!check.ok) throw new Error(`DATABASE_URL must target talo_app@talo_mos_v4_test: ${check.reason ?? ''}`);
    prisma = createPrismaClient(url ?? '');
    const iamUrl = process.env['IAM_ADMIN_DATABASE_URL'] ?? '';
    if (new URL(iamUrl).pathname !== '/talo_mos_v4_test') throw new Error('IAM_ADMIN_DATABASE_URL must target talo_mos_v4_test');
    iamPrisma = createPrismaClient(iamUrl);
    realIam = createIamCatalog(prismaFoundationDb(iamPrisma), null);
    // REV01-D2: identity of the connection the installer's IAM catalog really uses (never the URL / secret).
    const [ident] = await iamPrisma.$queryRawUnsafe<{ db: string; cu: string; su: string }[]>('SELECT current_database() AS db, current_user AS cu, session_user AS su');
    evidence['iamConnection'] = ident;
    if (ident?.db !== 'talo_mos_v4_test' || ident.cu !== 'talo_iam_admin') throw new Error('guard: IAM catalog must run as talo_iam_admin on talo_mos_v4_test');
    base = mkdtempSync(join(BACKEND, 'var', 'installer', 'dbtest-'));
    const modules = join(base, 'modules');
    const pkg = join(modules, moduleKey);
    write(join(pkg, 'module.json'), JSON.stringify({
      packageFormat: 'TALO-MODULE-PACKAGE-1', moduleKey, name: `FBET installer ${run}`, packageVersion: '1.0.0', contractVersion: 'MIC-1.0', hostProtocol: 'TALO-MODULE-HOST-1',
      backendEntry: 'backend/index.ts', frontendEntry: 'frontend/Screen.tsx', micEntry: 'mic/pkg.mic.ts',
      frontend: { screens: [{ screenKey: 'fbet.inst', name: 'FBET', description: 'Fixture FMI-03', tabs: [{ label: 'Đơn hàng', path: route }] }] }, requiredCapabilities: ['session'],
    }));
    write(join(pkg, 'backend', 'index.ts'), `import express from 'express';
import type { Request, RequestHandler, Response, Router } from 'express';
export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';
export const REQUIRED_CAPABILITIES: readonly string[] = ['session'];
interface Host { session(handler: (req: Request, res: Response, actor: unknown) => Promise<void>): RequestHandler }
export function createModule(host: Host): { router: Router } {
  const router = express.Router();
  router.get('${route}/orders', host.session(async (_req, res) => { res.status(200).json({ orders: [] }); }));
  router.post('${route}/orders', host.session(async (_req, res) => { res.status(201).json({}); }));
  return { router };
}
`);
    write(join(pkg, 'frontend', 'Screen.tsx'), "function Main() { return <p>fbet</p>; }\nexport const screens = { 'fbet.inst': Main };\n");
    write(join(pkg, 'mic', 'pkg.mic.ts'), 'export const mic = {};\n');
    write(join(pkg, 'tests', 'pkg.test.ts'), 'export {};\n');
    writeVersion('1.0.0');
    write(join(base, 'frontend', 'src', 'main.tsx'), 'export {};\n');
    write(join(base, 'frontend', 'tsconfig.app.json'), '{}\n');
    writeDeployments(join(base, 'module-deployments.json'), []);
    const hasher = new PasswordHasher();
    const auth = await createAuthModule({ prisma, logger, production: false, hasher, loginLimiter: new SlidingWindowRateLimiter({ limit: 10_000, windowMs: 15 * 60_000 }) });
    authService = auth.service;
    foundation = createFoundationModule({
      prisma, authService: auth.service, logger, secureCookie: false, environment: 'TEST', moduleScanRoot: modules,
      installer: {
        runtime, iam, environment: { label: 'TEST', database: 'talo_mos_v4_test', nodeEnv: 'test' }, storeRoot: join(base, 'store'), exec,
        paths: { frontendDir: join(base, 'frontend'), releasesDir: join(base, 'releases'), lockFile: join(base, 'module-deployments.json') },
      },
    });
    app = createApp({ config: loadConfig({ NODE_ENV: 'test', APP_ORIGIN: TEST_ORIGIN }), logger, apiRouters: [auth.router, foundation.router] });
    h = await AuthFixtures.connect();
    fx = new AuthFixtures(h, hasher);
    await fx.assertNoLeftovers();
    const acc = await fx.create();
    actorId = acc.accountId;
    const perms = await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE permission_code = ANY(ARRAY[${PERM_CODES.map(lit).join(',')}])`);
    expect(perms).toHaveLength(PERM_CODES.length);
    const roleId = randomUUID();
    const userRoleId = randomUUID();
    await h.ok('BEGIN');
    await h.ok(`INSERT INTO iam.iam_roles (role_id, role_code, role_name, is_active, is_system) VALUES (${lit(roleId)}, ${lit(`FBET-INST-${run}-R1`)}, 'FBET FMI-03', true, false)`);
    for (const [p] of perms) await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roleId)}, ${lit(p ?? '')})`);
    await h.ok(`INSERT INTO iam.iam_user_roles (user_role_id, user_account_id, role_id) VALUES (${lit(userRoleId)}, ${lit(acc.accountId)}, ${lit(roleId)})`);
    await h.ok('COMMIT');
    roles.push(roleId);
    userRoles.push(userRoleId);
    const login = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).set('Content-Type', 'application/json').set('User-Agent', fx.userAgent)
      .send(JSON.stringify({ username: acc.username, password: acc.password }));
    expect(login.status).toBe(200);
    cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  });

  afterAll(async () => {
    // Retire the run's version and hide its menu (API, audited); remove the run's IAM rows by UUID (ownership: this run).
    if (app && cookie !== '') {
      const [row] = await h.ok(`SELECT m.module_id, v.version_id FROM foundation.fnd_modules m JOIN foundation.fnd_module_versions v ON v.module_id = m.module_id WHERE m.module_key = ${lit(moduleKey)} AND v.status = 'ACTIVE'`);
      if (row) evidence['retire'] = (await post(`/foundation/modules/${row[0] ?? ''}/versions/${row[1] ?? ''}/retire`)).status;
      if (row) evidence['disable'] = (await post(`/foundation/modules/${row[0] ?? ''}/disable`)).status;
      const groups = await h.ok(`SELECT DISTINCT area.navigation_id FROM foundation.fnd_navigation_items l JOIN foundation.fnd_modules m ON m.module_id = l.module_id
        JOIN foundation.fnd_navigation_items menu ON menu.navigation_id = l.parent_id JOIN foundation.fnd_navigation_items area ON area.navigation_id = menu.parent_id
        WHERE m.module_key = ${lit(moduleKey)} AND l.function_id IS NOT NULL AND area.parent_id IS NULL AND area.is_visible AND area.menu_title = ${lit(`FBET installer ${run}`)}`);
      for (const [g] of groups) evidence['hide'] = (await request(app).patch(`/api/foundation/navigation/items/${g ?? ''}`).set('User-Agent', fx.userAgent).set('Origin', TEST_ORIGIN)
        .set('Content-Type', 'application/json').set('Cookie', cookie).send(JSON.stringify({ isVisible: false }))).status;
    }
    if (h) {
      // REV01-D2: the run's K05 rows were created by IAM Management (real catalog): their UUIDs, by the run-unique module code.
      for (const [id] of await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE module_code = ${lit(moduleKey)}`)) if (id && !createdPermissions.includes(id)) createdPermissions.push(id);
      evidence['iamAudit'] = await h.ok(`SELECT action_code, outcome, count(*)::text FROM iam.iam_audit_logs WHERE metadata->>'permissionCode' LIKE ${lit(`${moduleKey.toLowerCase()}.%`)}
        OR metadata->>'triple' LIKE ${lit(`${moduleKey}/%`)} GROUP BY 1, 2 ORDER BY 1, 2`);
      // Assignments of the run's role first (FK RESTRICT from iam_role_permissions), then the run's permissions by UUID.
      await h.ok('BEGIN');
      await h.ok(`DELETE FROM iam.iam_user_roles WHERE user_role_id = ANY(${uuidArray(userRoles)})`);
      await h.ok(`DELETE FROM iam.iam_role_permissions WHERE role_id = ANY(${uuidArray(roles)})`);
      await h.ok(`DELETE FROM iam.iam_roles WHERE role_id = ANY(${uuidArray(roles)}) AND role_code LIKE ${lit(`FBET-INST-${run}-%`)}`);
      await h.ok('COMMIT');
      const [del] = await h.ok(`WITH d AS (DELETE FROM iam.iam_permissions WHERE permission_id = ANY(${uuidArray(createdPermissions)}) AND module_code = ${lit(moduleKey)} RETURNING 1) SELECT count(*) FROM d`);
      evidence['iamDeleted'] = del?.[0];
      evidence['auth'] = await fx.cleanup();
      evidence['remaining'] = await fx.remaining();
      evidence['final'] = await facts();
    }
    console.log(`[fmi-03] run ${run} module ${moduleKey} evidence ${JSON.stringify(evidence)}`);
    if (base) rmSync(base, { recursive: true, force: true });
    await h?.close();
    await prisma?.$disconnect();
    await iamPrisma?.$disconnect();
    expect(evidence['remaining']).toBe(0);
  });

  it('IN-04 … IN-12 on TEST with the REAL IAM catalog (REV01-D2): B01 → B02 → MIC (server evidence) → APPROVE → AWAITING_RESTART → ACTIVATE → ENABLE → IAM → B09 → INSTALLED_ACTIVE', async () => {
    const scan = await post('/foundation/module-packages/scan');
    expect(scan.status).toBe(200);
    const cand = await post('/foundation/module-candidates', { scanId: scan.body.scanId, moduleKey });
    expect(cand.status, JSON.stringify(cand.body)).toBe(201);
    const candidateId = String(cand.body.candidate.candidateId);
    const start = await post(`/foundation/module-candidates/${candidateId}/preflight`);
    expect(start.status).toBe(202);
    await foundation.installerService?.whenIdle();
    const pf = (await get(`/foundation/module-candidates/${candidateId}/preflight/${start.body.runId}`)).body.run;
    expect(pf.checks.filter((c: { status: string }) => c.status !== 'PASS').map((c: { key: string; status: string }) => `${c.key}:${c.status}`)).toEqual(['DATABASE_TESTS:NOT_APPLICABLE', 'AUTHENTICATED_IAM_SMOKE:NOT_TESTED']);
    expect(pf.result).toBe('READY');

    // 1. REV01-D2: the REAL IAM catalog on TEST is writable through its column grants (no IAM_DB_GRANT_MISSING).
    expect(await realIam.writable()).toBe(true);
    const plan = (await post(`/foundation/module-candidates/${candidateId}/install/prepare`)).body.installation;
    expect(plan).toMatchObject({ state: 'PREPARED', classification: 'NEW_MODULE', blockers: [] });
    const committed = await post(`/foundation/module-candidates/${candidateId}/install/commit`, { planId: plan.installId, acknowledge: true });
    expect(committed.status).toBe(200);
    const inst = committed.body.installation;
    expect(inst.steps.filter((s: { status: string }) => s.status === 'FAILED')).toEqual([]);
    expect(inst.state).toBe('AWAITING_RESTART');
    const afterCommit = await facts();
    expect(afterCommit.slice(1, 7)).toEqual(['false', expect.any(String), 'APPROVED', `fmi02:${pf.runId}:${pf.reportHash}`, '1', 'REGISTER,SUBMIT,APPROVE']);
    const lock = parseDeployments(JSON.parse(readFileSync(join(base, 'module-deployments.json'), 'utf8')));
    expect(lock.get(moduleKey)?.packageHash).toBe(pf.packageHash);
    const early = await post(`/foundation/module-installations/${inst.installId}/continue`);
    expect([early.status, early.body.error.code]).toEqual([409, 'RESTART_PENDING']);
    expect((await facts())[3]).toBe('APPROVED'); // not activated while the runtime does not run the release
    // REV01-D2: module not ACTIVE → IAM Management refuses the K05 row (BINDING_INVALID), nothing created
    const asActor = { userAccountId: actorId, assuranceLevel: 1, requestId: randomUUID() };
    const k05 = { permissionCode: `${moduleKey.toLowerCase()}.order.read`, moduleCode: moduleKey, resourceCode: 'ORDER', operation: 'READ', minimumAssuranceLevel: 1, description: 'D2' };
    await expect(realIam.create(asActor, k05)).rejects.toMatchObject({ status: 422, code: 'BINDING_INVALID' });
    expect((await facts())[8]).toBe('0');

    // "restart": the Host build from the release store + the release's backend entry with the REAL Host capabilities.
    await restartOnto();

    // REV-01 A13 / A15: catalog created, no assignment yet → POSTCHECK_INCOMPLETE (never INSTALLED_ACTIVE).
    const first = await post(`/foundation/module-installations/${inst.installId}/continue`);
    expect(first.status).toBe(200);
    expect(first.body.installation.steps.filter((s: { status: string }) => s.status === 'FAILED').map((s: { key: string; detail: string }) => `${s.key} ${s.detail}`)).toEqual([]);
    expect(first.body.installation.state).toBe('POSTCHECK_INCOMPLETE');
    expect(first.body.installation.postcheck.filter((p: { status: string }) => p.status !== 'PASS').map((p: { key: string; status: string }) => `${p.key}:${p.status}`)).toEqual(['IAM_POLICY:NOT_TESTED']);
    const mid = (await facts())[0] ?? '';
    // REV01-D2 on the real repository: 2 K05 rows created by the installer; wrong K05 / wrong level → 422, duplicate → 409,
    // an actor without iam.permissions.manage → 403; no duplicate row; IAM audit written by IAM Management.
    expect((await facts())[8]).toBe('2');
    const d2: Record<string, unknown> = {};
    for (const [name, data] of [['wrongK05', { ...k05, permissionCode: `${moduleKey.toLowerCase()}.order.delete`, operation: 'DELETE' }], ['wrongLevel', { ...k05, minimumAssuranceLevel: 2 }]] as const) {
      await expect(realIam.create(asActor, data)).rejects.toMatchObject({ status: 422, code: 'BINDING_INVALID' });
      d2[name] = 'BINDING_INVALID';
    }
    await expect(realIam.create(asActor, k05)).rejects.toMatchObject({ status: 409, code: 'PERMISSION_TRIPLE_EXISTS' });
    d2['duplicate'] = 'PERMISSION_TRIPLE_EXISTS';
    const plain = await fx.create(); // no role: no iam.permissions.manage
    await expect(realIam.create({ userAccountId: plain.accountId, assuranceLevel: 1, requestId: randomUUID() }, k05)).rejects.toMatchObject({ status: 403 });
    d2['actorDenied'] = 403;
    expect((await facts())[8]).toBe('2');
    const [audit] = await h.ok(`SELECT count(*) FROM iam.iam_audit_logs WHERE action_code = 'IAM.PERMISSION.CREATE' AND outcome = 'SUCCESS' AND actor_account_id = ${lit(actorId)}`);
    expect(audit?.[0]).toBe('2');
    d2['auditSuccess'] = audit?.[0];
    evidence['d2'] = d2;
    // REV-01 A14: the REAL Navigation Builder holds the link AREA → MENU → FUNCTION (no legacy row of the module).
    const layout = await foundation.navigationService.layout({ userAccountId: actorId, assuranceLevel: 1, requestId: randomUUID() });
    const placed = layout.areas.flatMap((a) => a.menus.flatMap((m) => m.items.filter((l) => l.moduleId === mid).map((l) => `${a.title} › ${m.title} › ${l.title}:${l.visible && m.visible && a.visible}`)));
    expect(placed).toEqual([`FBET installer ${run} › FBET › Đơn hàng:true`]);
    expect(layout.legacy.filter((l) => l.moduleId === mid)).toEqual([]);
    // the IAM policy of the TEST fixture: the run's own role receives the module permissions (harness, by UUID) → access proven
    // the run's K05 rows (created by IAM Management above), by the run-unique module code
    for (const [id] of await h.ok(`SELECT permission_id FROM iam.iam_permissions WHERE module_code = ${lit(moduleKey)}`)) if (id && !createdPermissions.includes(id)) createdPermissions.push(id);
    expect(createdPermissions).toHaveLength(2);
    await h.ok('BEGIN');
    for (const p of createdPermissions) await h.ok(`INSERT INTO iam.iam_role_permissions (role_id, permission_id) VALUES (${lit(roles[0] ?? '')}, ${lit(p)})`);
    await h.ok('COMMIT');
    const fin = await post(`/foundation/module-installations/${inst.installId}/continue`);
    expect(fin.status).toBe(200);
    const done = fin.body.installation;
    expect(done.postcheck.map((p: { key: string; status: string }) => `${p.key}:${p.status}`)).toEqual(['B02_ACTIVE:PASS', 'RUNTIME_RELEASE:PASS', 'IAM_CATALOG:PASS', 'IAM_POLICY:PASS', 'NAVIGATION:PASS', 'API_SMOKE:PASS', 'ACCESS_VERIFIED:PASS']);
    expect(done.state).toBe('INSTALLED_ACTIVE');
    const final = await facts();
    expect([final[1], final[3], final[6], final[7], final[8]]).toEqual(['true', 'ACTIVE', 'REGISTER,SUBMIT,APPROVE,ACTIVATE,ENABLE', '1', '2']);
    expect((await foundation.navigationService.layout({ userAccountId: actorId, assuranceLevel: 1, requestId: randomUUID() })).revision).toBe(layout.revision); // the second continue wrote no B09
    // IN-11: no replay
    expect((await post(`/foundation/module-installations/${inst.installId}/continue`)).status).toBe(409);
    evidence['install'] = { installId: inst.installId, runId: pf.runId, reportHash: pf.reportHash, postcheck: done.postcheck.map((p: { key: string; status: string }) => `${p.key}:${p.status}`) };
    evidence['b08'] = await h.ok(`SELECT a.action_code, a.outcome FROM foundation.fnd_audit_logs a JOIN foundation.fnd_modules m ON m.module_id = a.module_id WHERE m.module_key = ${lit(moduleKey)} ORDER BY a.occurred_at`);
  });
  it('REV01-D1 on TEST: upgrade 1.0.0 → 1.1.0 with a postcheck FAIL → Lifecycle ROLLBACK → old lock → restart → RECOVERED; then 1.0.0 → 1.2.0 → INSTALLED_ACTIVE', async () => {
    expect(await b02()).toEqual(['1.0.0:ACTIVE']); // the first test installed 1.0.0
    const lock100 = parseDeployments(JSON.parse(readFileSync(join(base, 'module-deployments.json'), 'utf8'))).get(moduleKey);
    // 1.1.0: prepare has a recovery point (no UPGRADE_RECOVERY_UNAVAILABLE), commit → AWAITING_RESTART
    writeVersion('1.1.0');
    const c11 = await candidateReady();
    const plan = (await post(`/foundation/module-candidates/${c11.candidateId}/install/prepare`)).body.installation;
    expect(plan, JSON.stringify(plan.blockers)).toMatchObject({ state: 'PREPARED', classification: 'UPGRADE', blockers: [] });
    const committed = (await post(`/foundation/module-candidates/${c11.candidateId}/install/commit`, { planId: plan.installId, acknowledge: true })).body.installation;
    expect(committed.state).toBe('AWAITING_RESTART');
    expect(committed.recoveryPoint).toMatchObject({ activeVersion: '1.0.0', enabled: true, lock: lock100 });
    expect(await b02()).toEqual(['1.0.0:ACTIVE', '1.1.0:APPROVED']);
    // the new process runs 1.1.0 but did not mount the module router → API_SMOKE FAIL → controlled rollback
    await restartOnto(false);
    const failed = (await post(`/foundation/module-installations/${committed.installId}/continue`)).body.installation;
    expect(failed.postcheck.find((p: { key: string }) => p.key === 'API_SMOKE')?.status).toBe('FAIL');
    expect(failed.state, JSON.stringify(failed.recovery)).toBe('RECOVERY_AWAITING_RESTART');
    expect(failed.rollback).toMatchObject({ b02: 'DONE', lock: 'DONE' });
    expect(await b02()).toEqual(['1.0.0:ACTIVE', '1.1.0:RETIRED']);
    const [one] = await h.ok(`SELECT count(*) FROM foundation.fnd_module_versions v JOIN foundation.fnd_modules m ON m.module_id = v.module_id WHERE m.module_key = ${lit(moduleKey)} AND v.status = 'ACTIVE'`);
    expect(one?.[0]).toBe('1');
    const events = await h.ok(`SELECT e.event_type, v.module_version FROM foundation.fnd_module_events e JOIN foundation.fnd_modules m ON m.module_id = e.module_id
      LEFT JOIN foundation.fnd_module_versions v ON v.version_id = e.version_id WHERE m.module_key = ${lit(moduleKey)} ORDER BY e.occurred_at, e.event_type`);
    // activation transaction (ACTIVATE 1.1.0 + RETIRE 1.0.0, same occurred_at) then the recovery transaction (RETIRE 1.1.0 + ROLLBACK 1.0.0)
    expect(events.slice(-4).map((e) => e.join(':'))).toEqual(['ACTIVATE:1.1.0', 'RETIRE:1.0.0', 'RETIRE:1.1.0', 'ROLLBACK:1.0.0']);
    const [rb] = await h.ok(`SELECT a.action_code, a.outcome, a.metadata->>'installId', v.module_version FROM foundation.fnd_audit_logs a JOIN foundation.fnd_modules m ON m.module_id = a.module_id
      LEFT JOIN foundation.fnd_module_versions v ON v.version_id = a.version_id WHERE m.module_key = ${lit(moduleKey)} AND a.action_code = 'MODULE_VERSION.ROLLBACK'`);
    expect(rb).toEqual(['MODULE_VERSION.ROLLBACK', 'SUCCESS', committed.installId, '1.0.0']);
    expect(parseDeployments(JSON.parse(readFileSync(join(base, 'module-deployments.json'), 'utf8'))).get(moduleKey)).toEqual(lock100);
    const early = await post(`/foundation/module-installations/${committed.installId}/continue`);
    expect([early.status, early.body.error.code]).toEqual([409, 'RESTART_PENDING']);
    // restart onto the old release → verified → RECOVERED
    await restartOnto();
    const rec = (await post(`/foundation/module-installations/${committed.installId}/continue`)).body.installation;
    expect(rec.postcheck.map((p: { key: string; status: string }) => `${p.key}:${p.status}`)).toEqual(['RECOVERY_RUNTIME:PASS', 'RECOVERY_B02:PASS', 'RECOVERY_B01:PASS', 'RECOVERY_NAVIGATION:PASS', 'API_SMOKE:PASS']);
    expect(rec.state).toBe('RECOVERED');
    // 1.2.0 succeeds on the same module (CHANGE from the ACTIVE 1.0.0)
    writeVersion('1.2.0');
    const c12 = await candidateReady();
    const plan12 = (await post(`/foundation/module-candidates/${c12.candidateId}/install/prepare`)).body.installation;
    expect(plan12, JSON.stringify(plan12.blockers)).toMatchObject({ state: 'PREPARED', blockers: [] });
    const com12 = (await post(`/foundation/module-candidates/${c12.candidateId}/install/commit`, { planId: plan12.installId, acknowledge: true })).body.installation;
    await restartOnto();
    const fin = (await post(`/foundation/module-installations/${com12.installId}/continue`)).body.installation;
    expect(fin.postcheck.map((p: { key: string; status: string }) => `${p.key}:${p.status}`)).toEqual(['B02_ACTIVE:PASS', 'RUNTIME_RELEASE:PASS', 'IAM_CATALOG:PASS', 'IAM_POLICY:PASS', 'NAVIGATION:PASS', 'API_SMOKE:PASS', 'ACCESS_VERIFIED:PASS']);
    expect(fin.state).toBe('INSTALLED_ACTIVE');
    expect(await b02()).toEqual(['1.0.0:RETIRED', '1.1.0:RETIRED', '1.2.0:ACTIVE']);
    expect((await facts())[8]).toBe('2'); // no duplicate K05 row across the upgrades
    evidence['d1'] = { recovered: committed.installId, upgraded: com12.installId, b02: await b02(), events: events.slice(-4).map((e) => e.join(':')), rollbackAudit: rb };
  });
});
