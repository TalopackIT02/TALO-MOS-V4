import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { parseDeployments, releaseDir, syncModules } from '../../../scripts/modules-sync.mjs';
import { hashPackage, walkPackage } from '../../../scripts/module-package.mjs';
import { readPackage } from './foundation.module-scan.files.js';
import { evaluatePackage, manifestRoutes } from './foundation.module-scan.validation.js';
import type { ModuleScanRegistry, RegistryFacts } from './foundation.module-scan.types.js';
import type { FoundationDb } from './foundation.repository.js';

// FMI-02 — Foundation Preflight Engine (03_FMI02_PREFLIGHT.md). Runs the checks of ONE candidate snapshot, in order,
// every one producing evidence; a PASS is only ever produced by a check that really ran here:
//   P0 PACKAGE_INTEGRITY    source folder and snapshot rehashed (TALO-PACKAGE-HASH-1) = candidate hash, else PACKAGE_CHANGED
//   P1 STATIC_SCAN          FMI-01 evaluation of the snapshot against a fresh Registry read (MIC-1.0, MIC01–10, K05, routes)
//   P2 BACKEND_TYPECHECK    tsc of a staged copy of the Host backend with the installed releases + the candidate
//   P2 FRONTEND_TYPECHECK   tsc of a staged copy of the Host frontend, same set
//   P3 PACKAGE_TESTS        the package's own tests/ (not *.db.test.ts) with the Host-owned Vitest configuration
//   P4 HOST_HANDSHAKE       staged entry: protocol, capabilities, createModule; mounted routes = MIC-05 exactly
//   P5 DATABASE_CONTRACT    MIC-06 tables (VIEW / DIRECT_DB) exist and are readable — read-only metadata queries
//   P5 DATABASE_TESTS       *.db.test.ts need an isolated database (none here) → NOT_TESTED, blocks READY
//   P6 RUNTIME_SMOKE        every MIC-05 endpoint over HTTP without session → 401 JSON envelope (mounted, behind session)
//   P7 INSTALLED_RUNTIME    deployment lock + generated registries unchanged by the run (old ACTIVE release untouched)
// Child processes: fixed node scripts of the Host (never a request value), scrubbed environment (no database URL, no
// secret), time limit, output cap; logs are sanitised before they are stored. Staging lives under the installer store
// (backend side) and frontend/var/installer (frontend side, for its node_modules) and is removed at the end.

export const SUITE_VERSION = 'FMI-02-PREFLIGHT-1';
// REV-01 (08_PREFLIGHT_CONTRACT): NOT_APPLICABLE = the check has nothing to run for this package (e.g. no DB test) — never
// counted as PASS; a required check must be PASS or NOT_APPLICABLE for READY; an optional check never makes READY.
export type PreflightStatus = 'PASS' | 'WARN' | 'FAIL' | 'NOT_TESTED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
export const CHECK_DEFS = [
  { id: 'P0', key: 'PACKAGE_INTEGRITY', label: 'Toàn vẹn package (hash nguồn + snapshot)' },
  { id: 'P1', key: 'STATIC_SCAN', label: 'Kiểm tra tĩnh manifest / MIC / route (FMI-01)' },
  { id: 'P2a', key: 'BACKEND_TYPECHECK', label: 'Typecheck Backend (staging)' },
  { id: 'P2b', key: 'FRONTEND_TYPECHECK', label: 'Typecheck Frontend (staging)' },
  { id: 'P3', key: 'PACKAGE_TESTS', label: 'Test của package (không ghi DB)' },
  { id: 'P4', key: 'HOST_HANDSHAKE', label: 'Host handshake + route API = MIC-05' },
  { id: 'P5a', key: 'DATABASE_CONTRACT', label: 'Hợp đồng dữ liệu MIC-06 (chỉ đọc metadata)' },
  { id: 'P5b', key: 'DATABASE_TESTS', label: 'Test ghi DB (cần DB staging cô lập)' },
  { id: 'P6', key: 'RUNTIME_SMOKE', label: 'Runtime smoke API (không phiên → 401)' },
  { id: 'P7', key: 'INSTALLED_RUNTIME', label: 'Runtime đang cài không bị thay đổi' },
  { id: 'P8', key: 'AUTHENTICATED_IAM_SMOKE', label: 'API có phiên + IAM cho phép / từ chối (tùy chọn)', optional: true },
] as const;
export type CheckKey = (typeof CHECK_DEFS)[number]['key'];

export interface CheckIssue { readonly message: string; readonly path?: string; readonly field?: string; readonly expected?: string; readonly actual?: string }
export interface PreflightCheck {
  readonly id: string;
  readonly key: CheckKey;
  readonly label: string;
  readonly required: boolean;
  status: PreflightStatus;
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  exitCode: number | null;
  logHash: string | null;
  reference: string | null;
  limitations: string[];
  issues: CheckIssue[];
}

export interface PreflightRun {
  readonly runId: string;
  readonly candidateId: string;
  readonly moduleKey: string;
  readonly packageVersion: string;
  readonly packageHash: string;
  readonly suiteVersion: typeof SUITE_VERSION;
  readonly environment: PreflightEnvironment;
  readonly startedBy: string;
  readonly traceId: string;
  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  result: 'READY' | 'NEEDS_FIX' | 'INVALIDATED' | null;
  startedAt: string;
  finishedAt: string | null;
  checks: PreflightCheck[];
  summary: Record<PreflightStatus, number>;
  reportHash: string | null;
  limitations: string[];
}

export interface PreflightEnvironment { readonly label: 'TEST'; readonly database: string; readonly nodeEnv: string }

export interface PreflightPaths {
  readonly backendDir: string;
  readonly frontendDir: string;
  readonly modulesRoot: string;
  readonly releasesDir: string;
  readonly lockFile: string;
}

export interface ExecResult { readonly exitCode: number | null; readonly output: string; readonly timedOut: boolean; readonly durationMs: number }
export type Exec = (args: readonly string[], options: { readonly cwd: string; readonly env?: Record<string, string>; readonly timeoutMs: number }) => Promise<ExecResult>;

export interface PreflightTarget {
  readonly candidateId: string;
  readonly moduleKey: string;
  readonly folder: string;
  readonly sourceHash: string;
  readonly snapshotDir: string; // <store>/candidates/<id>/package/<MODULE_KEY>
}

export interface PreflightDeps {
  readonly paths: PreflightPaths;
  readonly registry: ModuleScanRegistry;
  readonly db: Pick<FoundationDb, 'query'>;
  readonly exec?: Exec;
  readonly now?: () => number;
  readonly stagingRoot: string; // backend side (under the installer store)
  readonly onProgress?: (run: PreflightRun) => void;
  readonly writeLog: (checkId: string, content: string) => string; // returns the stored reference
}

// ------------------------------------------------------------------------------------------------- process runner
const MAX_OUTPUT = 256 * 1024;
const ENV_KEEP = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];

// The environment of a child: an allowlist of system variables only (no DATABASE_URL, IAM_*, POSTGRES_*, secrets).
export function scrubbedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ENV_KEEP) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return { ...env, NODE_ENV: 'test', ...extra };
}

export const nodeExec: Exec = (args, { cwd, env, timeoutMs }) => new Promise((resolveExec) => {
  const started = Date.now();
  const child = spawn(process.execPath, ['--max-old-space-size=2048', ...args], { cwd, env: env ?? scrubbedEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const take = (chunk: Buffer) => {
    if (output.length < MAX_OUTPUT) output += chunk.toString('utf8').slice(0, MAX_OUTPUT - output.length);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32' && child.pid !== undefined) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGKILL');
  }, timeoutMs);
  child.on('error', () => undefined);
  child.on('close', (code) => {
    clearTimeout(timer);
    resolveExec({ exitCode: code, output, timedOut, durationMs: Date.now() - started });
  });
});

// Logs: no absolute path of this machine, no connection string, cookie, password or bearer token; bounded.
export function sanitizeLog(text: string, roots: readonly string[]): string {
  let s = text;
  for (const r of roots) {
    if (r === '') continue;
    for (const variant of new Set([r, r.split(sep).join('/'), r.split('/').join('\\')])) s = s.split(variant).join('<repo>');
  }
  return s
    .replace(/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"]+/gi, '$1://***')
    .replace(/(talo_sid=)[^\s;'"]+/gi, '$1***')
    .replace(/((?:cookie|authorization|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^\s'",;]+/gi, '$1***')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .slice(0, MAX_OUTPUT);
}

// tsc diagnostics → issues (file + message), at most 20; paths stay relative to the staging root.
function tscIssues(output: string): CheckIssue[] {
  return [...output.matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm)].slice(0, 20)
    .map((m) => ({ message: `${m[4] ?? ''}: ${(m[5] ?? '').trim().slice(0, 300)}`, path: `${(m[1] ?? '').replace(/^src\/installed-modules\//, '')}:${m[2] ?? ''}:${m[3] ?? ''}` }));
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const fileHash = (file: string) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'missing');
const iso = (ms: number) => new Date(ms).toISOString();
const emptySummary = (): Record<PreflightStatus, number> => ({ PASS: 0, WARN: 0, FAIL: 0, NOT_TESTED: 0, UNAVAILABLE: 0, NOT_APPLICABLE: 0 });

// P1 warnings that do not block READY: MIC-10 is replaced by THIS run's evidence at install; a disabled holder is
// reported (MS-16) and re-checked by the installer; an existing DRAFT has no stored package hash yet.
export const ACCEPTED_SCAN_WARNINGS = ['TEST_EVIDENCE_PENDING', 'TEST_EVIDENCE_UNVERIFIED', 'ROUTE_RESERVED_BY_DISABLED_MODULE', 'INTEGRITY_UNVERIFIED'];

function listFiles(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      if (name.isSymbolicLink()) continue;
      if (name.isDirectory()) {
        if (name.name !== 'node_modules') visit(join(d, name.name));
      } else if (re.test(name.name)) out.push(relative(dir, join(d, name.name)).split(sep).join('/'));
    }
  };
  visit(dir);
  return out.sort();
}

// ------------------------------------------------------------------------------------------------- engine
export async function runPreflight(run: PreflightRun, target: PreflightTarget, deps: PreflightDeps): Promise<PreflightRun> {
  const now = deps.now ?? Date.now;
  const exec = deps.exec ?? nodeExec;
  const { paths } = deps;
  const roots = [paths.backendDir, paths.frontendDir, paths.modulesRoot, deps.stagingRoot, process.cwd()].map((p) => p.replace(/[\\/](backend|frontend|modules)$/, ''));
  const check = (key: CheckKey) => {
    const c = run.checks.find((x) => x.key === key);
    if (!c) throw new Error(`unknown check ${key}`);
    return c;
  };
  const begin = (key: CheckKey) => {
    const c = check(key);
    c.startedAt = iso(now());
    deps.onProgress?.(run);
    return c;
  };
  const finish = (c: PreflightCheck, status: PreflightStatus, detail: string, log?: string, exitCode: number | null = null) => {
    c.status = status;
    c.detail = detail;
    c.exitCode = exitCode;
    c.finishedAt = iso(now());
    c.durationMs = Math.max(0, Date.parse(c.finishedAt) - Date.parse(c.startedAt ?? c.finishedAt));
    if (log !== undefined) {
      const clean = sanitizeLog(log, roots);
      c.logHash = sha256(clean);
      c.reference = deps.writeLog(c.id, clean);
    }
    deps.onProgress?.(run);
  };
  const skipRest = (reason: string) => {
    for (const c of run.checks) if (c.startedAt === null) {
      c.status = 'NOT_TESTED';
      c.detail = `Không chạy: ${reason}.`;
    }
  };
  const stagingBackend = join(deps.stagingRoot, run.runId, 'backend');
  const stagingModules = join(deps.stagingRoot, run.runId, 'modules');
  const stagingFrontend = join(paths.frontendDir, 'var', 'installer', 'staging', run.runId);
  const runtimeFingerprint = () => [fileHash(paths.lockFile), fileHash(join(paths.backendDir, 'src', 'installed-modules', 'registry.ts')), fileHash(join(paths.frontendDir, 'src', 'installed-modules', 'registry.ts'))];
  const fingerprintBefore = runtimeFingerprint();

  try {
    // P0 — integrity of the source folder and of the snapshot.
    {
      const c = begin('PACKAGE_INTEGRITY');
      const source = join(paths.modulesRoot, target.folder);
      const src = existsSync(source) ? hashPackage(source, walkPackage(source)).hash : null;
      const snap = hashPackage(target.snapshotDir, walkPackage(target.snapshotDir)).hash;
      if (src !== target.sourceHash || snap !== target.sourceHash) {
        c.issues.push({ message: 'Package đã thay đổi sau lần quét: bằng chứng cũ không còn áp dụng.', expected: target.sourceHash, actual: `source ${src ?? 'unavailable'} / snapshot ${snap ?? 'unavailable'}` });
        finish(c, 'FAIL', 'PACKAGE_CHANGED — quét lại bằng nút Quét Module rồi tạo candidate mới.', `source=${src ?? 'unavailable'}\nsnapshot=${snap ?? 'unavailable'}\nexpected=${target.sourceHash}\n`);
        run.result = 'INVALIDATED';
        skipRest('package đã thay đổi (PACKAGE_CHANGED)');
        return run;
      }
      finish(c, 'PASS', `SHA-256 ${target.sourceHash} khớp ở thư mục nguồn và snapshot.`, `source=${src}\nsnapshot=${snap}\n`);
    }

    // P1 — static evaluation (the FMI-01 rules) against a fresh Registry read.
    let registry: RegistryFacts | null = null;
    {
      const c = begin('STATIC_SCAN');
      try {
        registry = await deps.registry.read();
      } catch {
        registry = null;
      }
      const facts = readPackage(join(target.snapshotDir, '..'), basename(target.snapshotDir), false);
      const folderRoutes = new Map<string, Set<string>>();
      if (facts.manifest.state === 'OK') for (const r of manifestRoutes(facts.manifest.value)) folderRoutes.set(r, new Set([target.moduleKey]));
      const scanned = evaluatePackage(facts, { registry, folderRoutes });
      const blocking = scanned.checks.filter((x) => x.status === 'FAIL' || x.status === 'UNAVAILABLE');
      const warnings = scanned.issues.filter((i) => i.severity === 'WARNING');
      const unaccepted = warnings.filter((w) => !ACCEPTED_SCAN_WARNINGS.includes(w.code));
      for (const i of scanned.issues) c.issues.push({ message: `${i.checkId} ${i.code}: ${i.message}`, ...(i.path ? { path: i.path } : {}), ...(i.field ? { field: i.field } : {}), ...(i.expected ? { expected: i.expected } : {}), ...(i.actual ? { actual: i.actual } : {}) });
      const log = scanned.checks.map((x) => `${x.id} ${x.status} ${x.code} ${x.message}`).join('\n');
      if (blocking.length > 0 || unaccepted.length > 0 || !scanned.eligibleForPreflight) {
        finish(c, 'FAIL', `${blocking.length} phép kiểm lỗi / chưa xác minh, ${unaccepted.length} cảnh báo chặn (${[...new Set([...blocking.map((b) => b.code), ...unaccepted.map((u) => u.code)])].join(', ') || 'không đủ điều kiện preflight'}).`, log);
      } else {
        if (warnings.length > 0) c.limitations.push(`Cảnh báo được chấp nhận: ${[...new Set(warnings.map((w) => w.code))].join(', ')}.`);
        finish(c, 'PASS', `20/20 quy tắc FMI-01 không có lỗi; phân loại ${scanned.classification}${warnings.length > 0 ? ` (${warnings.length} cảnh báo được chấp nhận)` : ''}.`, log);
      }
    }

    // Staging: installed releases (lock) except the candidate's key + the candidate snapshot, synced like the Host does.
    const lock = parseDeployments(JSON.parse(readFileSync(paths.lockFile, 'utf8')));
    rmSync(join(deps.stagingRoot, run.runId), { recursive: true, force: true });
    mkdirSync(stagingModules, { recursive: true });
    for (const [key, pinned] of lock) if (key !== target.moduleKey) cpSync(releaseDir(paths.releasesDir, key, pinned.packageVersion), join(stagingModules, key), { recursive: true });
    cpSync(target.snapshotDir, join(stagingModules, target.moduleKey), { recursive: true });
    const notInstalled = (src: string) => !src.split(/[\\/]/).includes('installed-modules');

    // P2a — backend typecheck.
    {
      const c = begin('BACKEND_TYPECHECK');
      try {
        cpSync(join(paths.backendDir, 'src'), join(stagingBackend, 'src'), { recursive: true, filter: notInstalled });
        cpSync(join(paths.backendDir, 'scripts'), join(stagingBackend, 'scripts'), { recursive: true });
        cpSync(join(paths.backendDir, 'tsconfig.json'), join(stagingBackend, 'tsconfig.json'));
        const synced: string[] = [];
        syncModules({ target: 'backend', modulesDir: stagingModules, outDir: join(stagingBackend, 'src', 'installed-modules'), log: (l) => synced.push(l) });
        const r = await exec([join(paths.backendDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(stagingBackend, 'tsconfig.json'), '--noEmit'], { cwd: stagingBackend, timeoutMs: 240_000 });
        const ok = r.exitCode === 0 && !r.timedOut && synced.some((l) => l.includes(`${target.moduleKey} `));
        c.issues.push(...tscIssues(sanitizeLog(r.output, roots)));
        finish(c, ok ? 'PASS' : 'FAIL', ok ? `tsc --noEmit: 0 lỗi (${synced.length} package trong staging).` : r.timedOut ? 'Quá thời gian typecheck.' : `tsc thoát mã ${r.exitCode ?? 'null'}.`, `${synced.join('\n')}\n${r.output}`, r.exitCode);
      } catch (error) {
        finish(c, 'FAIL', `Không dựng được staging backend: ${error instanceof Error ? error.message : 'lỗi'}.`, String(error));
      }
    }

    // P2b — frontend typecheck (staged next to frontend/node_modules).
    {
      const c = begin('FRONTEND_TYPECHECK');
      try {
        rmSync(stagingFrontend, { recursive: true, force: true });
        cpSync(join(paths.frontendDir, 'src'), join(stagingFrontend, 'src'), { recursive: true, filter: notInstalled });
        cpSync(join(paths.frontendDir, 'tsconfig.app.json'), join(stagingFrontend, 'tsconfig.json'));
        const synced: string[] = [];
        syncModules({ target: 'frontend', modulesDir: stagingModules, outDir: join(stagingFrontend, 'src', 'installed-modules'), log: (l) => synced.push(l) });
        const r = await exec([join(paths.frontendDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(stagingFrontend, 'tsconfig.json'), '--noEmit'], { cwd: stagingFrontend, timeoutMs: 240_000 });
        const ok = r.exitCode === 0 && !r.timedOut && synced.some((l) => l.includes(`${target.moduleKey} `));
        c.issues.push(...tscIssues(sanitizeLog(r.output, roots)));
        finish(c, ok ? 'PASS' : 'FAIL', ok ? `tsc --noEmit: 0 lỗi (${synced.length} package trong staging).` : r.timedOut ? 'Quá thời gian typecheck.' : `tsc thoát mã ${r.exitCode ?? 'null'}.`, `${synced.join('\n')}\n${r.output}`, r.exitCode);
      } catch (error) {
        finish(c, 'FAIL', `Không dựng được staging frontend: ${error instanceof Error ? error.message : 'lỗi'}.`, String(error));
      } finally {
        rmSync(stagingFrontend, { recursive: true, force: true });
      }
    }

    // P3 — the package's own tests (non-DB), Host-owned configuration.
    const testsDir = join(target.snapshotDir, 'tests');
    const testFiles = listFiles(testsDir, /\.test\.tsx?$/);
    const dbTests = testFiles.filter((f) => f.endsWith('.db.test.ts'));
    {
      const c = begin('PACKAGE_TESTS');
      const plain = testFiles.filter((f) => !f.endsWith('.db.test.ts'));
      if (plain.length === 0) {
        c.limitations.push('Package không có tests/*.test.ts (không ghi DB).');
        finish(c, 'NOT_TESTED', 'Package không khai báo test chạy được trong preflight.');
      } else {
        const r = await exec([join(paths.backendDir, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', join(paths.backendDir, 'scripts', 'installer', 'preflight.vitest.config.mjs')],
          { cwd: paths.backendDir, env: scrubbedEnv({ TALO_PREFLIGHT_TESTS: testsDir }), timeoutMs: 240_000 });
        const counts = /Tests\s+(.+?)\s*\((\d+)\)/.exec(sanitizeLog(r.output, []))?.[0] ?? 'không đọc được số test';
        const ok = r.exitCode === 0 && !r.timedOut;
        finish(c, ok ? 'PASS' : 'FAIL', `${plain.length} tệp test · ${counts}${r.timedOut ? ' · quá thời gian' : ''}.`, r.output, r.exitCode);
      }
    }

    // P4 + P6 — staged entry through the fixed harness.
    {
      const c4 = begin('HOST_HANDSHAKE');
      const r = await exec([join(paths.backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(paths.backendDir, 'scripts', 'installer', 'host-smoke.mts'), join(stagingModules, target.moduleKey)],
        { cwd: paths.backendDir, timeoutMs: 120_000 });
      const line = r.output.split(/\r?\n/).reverse().find((l) => l.startsWith('{"moduleKey"'));
      let parsed: { handshake?: string[]; routes?: { missing: string[]; undeclared: string[]; mounted: string[] }; smoke?: { method: string; path: string; status: number; code: string | null }[]; error?: string } | null = null;
      try {
        parsed = line ? JSON.parse(line) : null;
      } catch {
        parsed = null;
      }
      if (parsed === null || parsed.error !== undefined || parsed.handshake === undefined) {
        finish(c4, 'FAIL', `Không nạp được backend entry trong staging${parsed?.error ? `: ${sanitizeLog(parsed.error, roots)}` : ''}.`, r.output, r.exitCode);
      } else {
        for (const p of parsed.handshake) c4.issues.push({ message: `Handshake: ${p}` });
        for (const m of parsed.routes?.missing ?? []) c4.issues.push({ message: 'API khai báo trong MIC-05 nhưng không được mount.', field: 'mic05Api', expected: m, actual: '(không có)' });
        for (const u of parsed.routes?.undeclared ?? []) c4.issues.push({ message: 'Route được mount nhưng không khai báo trong MIC-05.', field: 'mic05Api', expected: '(khai báo)', actual: u });
        const ok = parsed.handshake.length === 0 && (parsed.routes?.missing.length ?? 1) === 0 && (parsed.routes?.undeclared.length ?? 1) === 0;
        finish(c4, ok ? 'PASS' : 'FAIL', ok ? `TALO-MODULE-HOST-1 hợp lệ; ${parsed.routes?.mounted.length ?? 0} route mount = MIC-05.` : `${c4.issues.length} sai lệch handshake / MIC-05.`, r.output, r.exitCode);
      }
      const c6 = begin('RUNTIME_SMOKE');
      const smoke = parsed?.smoke ?? [];
      if (smoke.length === 0) finish(c6, c4.status === 'PASS' ? 'NOT_TESTED' : 'FAIL', 'Không có endpoint nào được gọi (handshake lỗi hoặc MIC-05 rỗng).');
      else {
        for (const s of smoke) if (s.status !== 401 || s.code === null) c6.issues.push({ message: 'Endpoint không trả 401 + JSON envelope khi không có phiên.', field: `${s.method} ${s.path}`, expected: '401 {error:{code}}', actual: `${s.status} ${s.code ?? '(không phải envelope)'}` });
        c6.limitations.push('Hành vi đã xác thực (200 / 403 theo IAM) được kiểm ở hậu kiểm sau ACTIVE (FMI-03).');
        finish(c6, c6.issues.length === 0 ? 'PASS' : 'FAIL', `${smoke.length - c6.issues.length}/${smoke.length} endpoint trả 401 đúng envelope khi không có phiên.`, JSON.stringify(smoke, null, 2));
      }
    }

    // P5a — MIC-06 tables: read-only metadata (to_regclass + SELECT privilege of the runtime role).
    {
      const c = begin('DATABASE_CONTRACT');
      const mic = JSON.parse(readFileSync(join(target.snapshotDir, 'mic', 'module.mic.json'), 'utf8')) as { mic06DataResources?: { resourceKey: string; interfaceKind: string; schema?: string; table?: string }[] };
      const resources = mic.mic06DataResources ?? [];
      const tables = resources.filter((r) => r.schema && r.table);
      const lines: string[] = [];
      try {
        for (const r of resources.filter((x) => x.interfaceKind === 'DIRECT_DB')) c.issues.push({ message: 'DIRECT_DB cần phê duyệt riêng (Activation Gate chặn).', field: `mic06DataResources.${r.resourceKey}` });
        for (const t of tables) {
          const rows = await deps.db.query(`SELECT to_regclass($1) IS NOT NULL AS present, CASE WHEN to_regclass($1) IS NULL THEN false ELSE has_table_privilege(to_regclass($1), 'SELECT') END AS readable`, [`${t.schema}.${t.table}`]);
          const row = rows[0] as { present?: boolean; readable?: boolean } | undefined;
          lines.push(`${t.resourceKey} ${t.schema}.${t.table} present=${String(row?.present)} readable=${String(row?.readable)}`);
          if (row?.present !== true || row.readable !== true) c.issues.push({ message: 'Bảng MIC-06 không tồn tại hoặc runtime không có quyền SELECT.', field: `mic06DataResources.${t.resourceKey}`, expected: 'present + SELECT', actual: `${String(row?.present)} / ${String(row?.readable)}` });
        }
        const detail = tables.length === 0 ? `${resources.length} tài nguyên MIC-06 (${[...new Set(resources.map((r) => r.interfaceKind))].join(', ') || 'không có'}), không có bảng DB cần đối chiếu.` : `${tables.length - c.issues.length}/${tables.length} bảng MIC-06 tồn tại và đọc được.`;
        finish(c, c.issues.length === 0 ? 'PASS' : 'FAIL', detail, lines.join('\n') || '(no table)');
      } catch {
        finish(c, 'UNAVAILABLE', 'Không đọc được metadata PostgreSQL (không coi là đạt).');
      }
    }
    {
      const c = begin('DATABASE_TESTS');
      if (dbTests.length === 0) finish(c, 'NOT_APPLICABLE', 'N/A — package không khai báo test ghi DB (tests/*.db.test.ts): KHÔNG có test tích hợp DB nào được chạy.');
      else {
        c.limitations.push('Không có database staging cô lập; test ghi DB không được chạy trên talo_mos_v4_test chính.');
        finish(c, 'NOT_TESTED', `${dbTests.length} tệp *.db.test.ts cần DB staging cô lập (chưa có): chặn READY.`, dbTests.join('\n'));
      }
    }

    // P7 — the installed runtime is untouched by the run.
    {
      const c = begin('INSTALLED_RUNTIME');
      const after = runtimeFingerprint();
      const same = after.every((h, i) => h === fingerprintBefore[i]);
      finish(c, same ? 'PASS' : 'FAIL', same ? 'Lock triển khai và registry Backend/Frontend không đổi trong lượt chạy (phiên bản ACTIVE cũ giữ nguyên).' : 'Lock / registry runtime thay đổi trong lượt chạy.',
        `before=${fingerprintBefore.join(',')}\nafter=${after.join(',')}\n`);
    }

    // P8 (optional) — authenticated IAM allow / deny cannot run in staging (no principal, no session, no database for the
    // module): reported NOT_TESTED, never PASS. The real proof is the installer's postcheck ACCESS_VERIFIED after ACTIVE.
    {
      const c = begin('AUTHENTICATED_IAM_SMOKE');
      c.limitations.push('Không có principal / phiên / DB fixture cô lập cho module trong staging; truy cập thật được kiểm ở hậu kiểm ACCESS_VERIFIED (FMI-03).');
      finish(c, 'NOT_TESTED', 'Không chạy trong preflight: P6 chỉ chứng minh 401 khi không có phiên, chưa chứng minh 200 / 403 theo IAM.');
    }
    return run;
  } finally {
    rmSync(join(deps.stagingRoot, run.runId), { recursive: true, force: true });
    rmSync(stagingFrontend, { recursive: true, force: true });
  }
}

// Fills summary / result / limitations once every check has finished (or been skipped).
export function concludeRun(run: PreflightRun): PreflightRun {
  run.summary = emptySummary();
  for (const c of run.checks) run.summary[c.status] += 1;
  if (run.result !== 'INVALIDATED') run.result = run.checks.every((c) => !c.required || c.status === 'PASS' || c.status === 'NOT_APPLICABLE') ? 'READY' : 'NEEDS_FIX';
  run.limitations = [
    'Static-only PASS không phải runtime PASS: runtime smoke chỉ chứng minh API được mount sau session; quyền IAM thực được hậu kiểm sau ACTIVE.',
    'Test ghi DB chỉ chạy được khi có DB staging cô lập (chưa cấu hình).',
    ...run.checks.flatMap((c) => c.limitations.map((l) => `${c.id}: ${l}`)),
  ];
  return run;
}

export function newRun(input: { runId: string; candidateId: string; moduleKey: string; packageVersion: string; packageHash: string; environment: PreflightEnvironment; startedBy: string; startedAt: string }): PreflightRun {
  return {
    ...input, suiteVersion: SUITE_VERSION, traceId: input.runId, status: 'RUNNING', result: null, finishedAt: null, reportHash: null, limitations: [], summary: emptySummary(),
    checks: CHECK_DEFS.map((d) => ({ id: d.id, key: d.key, label: d.label, required: !('optional' in d), status: 'NOT_TESTED', detail: 'Chưa chạy.', startedAt: null, finishedAt: null, durationMs: 0, exitCode: null, logHash: null, reference: null, limitations: [], issues: [] })),
  };
}

// ------------------------------------------------------------------------------------------------- reports
export interface ReportContext { readonly folder: string; readonly scanId: string; readonly candidateStatus: string }

export function reportJson(run: PreflightRun, ctx: ReportContext): string {
  const evidence = run.checks.map((c) => ({
    testId: `${run.suiteVersion}/${c.id}`, result: c.status, environment: `${run.environment.label} ${run.environment.database}`, candidateId: run.candidateId,
    packageHash: run.packageHash, suiteVersion: run.suiteVersion, runId: run.runId, startedAt: c.startedAt, finishedAt: c.finishedAt, exitCode: c.exitCode,
    logHash: c.logHash, reference: c.reference, traceId: `${run.traceId}/${c.id}`, limitations: c.limitations,
  }));
  return `${JSON.stringify({ format: 'TALO-PREFLIGHT-REPORT-1', ...ctx, run: { ...run, reportHash: undefined }, evidence }, null, 2)}\n`;
}

export function reportTxt(run: PreflightRun, ctx: ReportContext): string {
  const l: string[] = [];
  l.push('TALO-MOS-V4 — FMI-02 PREFLIGHT REPORT (Kiểm tra & Chạy thử)', '='.repeat(64));
  l.push(`Module          : ${run.moduleKey} ${run.packageVersion}`, `Thư mục         : modules/${ctx.folder}`, `Package SHA-256 : ${run.packageHash}`,
    `Candidate       : ${run.candidateId} (${ctx.candidateStatus})`, `Scan ID         : ${ctx.scanId}`, `Run ID          : ${run.runId}`, `Suite           : ${run.suiteVersion}`,
    `Môi trường      : ${run.environment.label} · DB ${run.environment.database} · NODE_ENV ${run.environment.nodeEnv}`,
    `Bắt đầu         : ${run.startedAt}`, `Kết thúc        : ${run.finishedAt ?? '(đang chạy)'}`,
    `Kết luận        : ${run.result ?? run.status}`, `Tổng hợp        : PASS ${run.summary.PASS} · WARN ${run.summary.WARN} · FAIL ${run.summary.FAIL} · NOT_TESTED ${run.summary.NOT_TESTED} · UNAVAILABLE ${run.summary.UNAVAILABLE} · N/A ${run.summary.NOT_APPLICABLE}`, '');
  for (const c of run.checks) {
    l.push(`[${c.status}] ${c.id} ${c.key} — ${c.label}${c.required ? '' : ' (tùy chọn, không chặn READY)'}`, `    ${c.detail}`);
    if (c.startedAt) l.push(`    thời gian: ${c.startedAt} → ${c.finishedAt ?? ''} (${c.durationMs} ms), exit ${c.exitCode ?? '—'}`);
    if (c.logHash) l.push(`    log: ${c.reference ?? ''} sha256 ${c.logHash}`);
    for (const i of c.issues.slice(0, 50)) l.push(`    - ${i.message}${i.path ? ` | tệp ${i.path}` : ''}${i.field ? ` | trường ${i.field}` : ''}${i.expected ? ` | mong đợi ${i.expected}` : ''}${i.actual ? ` | thực tế ${i.actual}` : ''}`);
    for (const x of c.limitations) l.push(`    giới hạn: ${x}`);
  }
  l.push('', 'Giới hạn chung:', ...run.limitations.map((x) => `- ${x}`));
  l.push('', 'Báo cáo không chứa cookie, chuỗi kết nối, mật khẩu, token hoặc dữ liệu dòng. READY chỉ khi mọi check bắt buộc PASS với cùng package hash.');
  return `${l.join('\n')}\n`;
}
