import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Router } from 'express';
import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import { copyPackage, parseDeployments, releaseDir, writeDeployments, writeRelease } from '../../../scripts/modules-sync.mjs';
import { hashPackage, walkPackage } from '../../../scripts/module-package.mjs';
import { AccessGuard } from './foundation.access.js';
import type { Actor } from './foundation.access.js';
import { canonicalDigest } from './foundation.json.js';
import type { ModuleLifecycleService } from './foundation.lifecycle.service.js';
import type { ModuleManifestService } from './foundation.manifest.service.js';
import type { ModuleScanService } from './foundation.module-scan.service.js';
import type { ModuleScanRegistry, ScannedModule } from './foundation.module-scan.types.js';
import type { NavigationService } from './foundation.navigation.service.js';
import {
  MODULE_REGISTRY_CREATE, MODULE_REGISTRY_ENABLE, MODULE_REGISTRY_READ, MODULE_VERSION_ACTIVATE, MODULE_VERSION_APPROVE, MODULE_VERSION_CREATE,
  MODULE_VERSION_SUBMIT, MODULE_VERSION_UPDATE, NAVIGATION_MANAGE, evaluateAccess,
} from './foundation.permissions.js';
import type { PermissionRef } from './foundation.permissions.js';
import { concludeRun, newRun, reportJson, reportTxt, runPreflight } from './foundation.preflight.js';
import type { Exec, PreflightEnvironment, PreflightPaths, PreflightRun } from './foundation.preflight.js';
import type { FoundationDb, FoundationRepository } from './foundation.repository.js';
import type { FoundationService } from './foundation.service.js';
import { InstallerStore, isStoreId } from './foundation.installer.store.js';
import type { ModuleVersionService } from './foundation.versions.service.js';

// FMI-02 / FMI-03 — Candidate Workspace, Preflight and Installer (documents/development/FMI-02-03-FOUNDATION-INSTALLER).
//   Candidate  : created from a stored FMI-01 scan result (scanId + moduleKey, nothing else from the client); the package
//                is snapshotted (hash verified) BEFORE any B01 / B02 row exists. Status SCANNED → VALIDATING → READY |
//                NEEDS_FIX | INVALIDATED (package changed / superseded) | ERROR (engine).
//   Preflight  : one run at a time in this process (bounded worker), fixed checks (foundation.preflight.ts), sanitised
//                JSON / TXT report hashed; READY only when every required check is PASS for the same package hash.
//   Install    : prepare = dry run (plan + blockers, nothing written); commit = only for a valid, unexpired, unblocked
//                plan, acknowledged, serialised per module: release (immutable store) → B01 → B02 (reuse a DRAFT, never
//                duplicate) → MIC with the server's own MIC-10 evidence → SUBMIT → APPROVE → deployment lock →
//                AWAITING_RESTART (no deploy supervisor here: the operator restarts; never reported as done). continue =
//                after the restart, the running release must match → ACTIVATE → ENABLE → IAM catalog (MIC-07, no
//                assignment) → B09 (idempotent) → postcheck → INSTALLED_ACTIVE, or RECOVERY_REQUIRED (module DISABLED).
//   An upgrade of a module that has an ACTIVE version is BLOCKED (UPGRADE_RECOVERY_UNAVAILABLE): ACTIVATE retires the old
//   version and Foundation has no RETIRED → ACTIVE path, so no tested rollback exists (04_FMI03_INSTALLER.md).
// Every lifecycle / IAM / navigation write goes through the existing services with the requesting actor (their own
// permission checks, B07 / B08 / IAM audit). The client never sends a path, a command, SQL or MIC-10 evidence.

const MESSAGES = {
  SCAN_NOT_FOUND: 'Không tìm thấy kết quả quét (hết hạn 10 phút). Bấm Quét Module rồi chọn lại.',
  CANDIDATE_SOURCE_NOT_FOUND: 'Kết quả quét không có module này.',
  CANDIDATE_NOT_ELIGIBLE: 'Package chưa đủ điều kiện kiểm tra (còn lỗi quét tĩnh hoặc không có mã băm).',
  CANDIDATE_NOT_FOUND: 'Không tìm thấy candidate.',
  CANDIDATE_STATE_CONFLICT: 'Candidate không ở trạng thái cho phép thao tác này.',
  PACKAGE_CHANGED: 'Package đã thay đổi sau lần quét: bấm Quét Module lại và tạo candidate mới.',
  PREFLIGHT_IN_PROGRESS: 'Đang có lượt Kiểm tra & Chạy thử khác. Vui lòng chờ lượt đó hoàn tất.',
  RUN_NOT_FOUND: 'Không tìm thấy lượt kiểm tra.',
  REPORT_NOT_READY: 'Báo cáo chưa sẵn sàng (lượt kiểm tra chưa kết thúc).',
  PLAN_NOT_FOUND: 'Không tìm thấy kế hoạch cài đặt.',
  PLAN_EXPIRED: 'Kế hoạch cài đặt đã hết hạn hoặc không còn hợp lệ. Lập kế hoạch lại.',
  PLAN_BLOCKED: 'Kế hoạch cài đặt còn điều kiện chặn; không thực hiện.',
  INSTALL_NOT_FOUND: 'Không tìm thấy lượt cài đặt.',
  INSTALL_STATE_CONFLICT: 'Lượt cài đặt không ở trạng thái cho phép thao tác này.',
  INSTALL_IN_PROGRESS: 'Module đang có một lượt cài đặt khác.',
  RESTART_PENDING: 'Backend / Frontend đang chạy chưa nạp release mới. Khởi động lại rồi bấm Tiếp tục.',
  INSTALLER_INTERNAL_ERROR: 'Lỗi không xác định của trình cài đặt.',
} as const;
export type InstallerErrorCode = keyof typeof MESSAGES | 'VALIDATION_ERROR';

export class InstallerError extends Error {
  constructor(readonly status: number, readonly code: InstallerErrorCode, readonly details?: { readonly fields?: readonly string[]; readonly blockers?: readonly string[] }) {
    super(code === 'VALIDATION_ERROR' ? 'Yêu cầu không hợp lệ.' : MESSAGES[code]);
    this.name = 'InstallerError';
  }
}

export type CandidateStatus = 'SCANNED' | 'VALIDATING' | 'NEEDS_FIX' | 'READY' | 'INVALIDATED' | 'CANCELLED' | 'ERROR';
export interface CandidateRecord {
  readonly candidateId: string;
  readonly moduleKey: string;
  readonly moduleName: string;
  readonly packageVersion: string;
  readonly folder: string;
  readonly scanId: string;
  readonly sourceHash: string;
  readonly classification: string;
  readonly routes: readonly string[];
  readonly createdBy: string;
  readonly createdAt: string;
  status: CandidateStatus;
  updatedAt: string;
  latestRunId: string | null;
  readyRunId: string | null;
  readyReportHash: string | null;
  history: { at: string; status: CandidateStatus; by: string; note: string }[];
}

export type InstallState = 'PREPARED' | 'BLOCKED' | 'PREPARING' | 'STAGED' | 'PUBLISHING' | 'AWAITING_RESTART' | 'CUTTING_OVER' | 'POSTCHECK'
  | 'INSTALLED_ACTIVE' | 'RECOVERY_REQUIRED' | 'FAILED_SAFE' | 'EXPIRED';
export interface Blocker { readonly code: string; readonly message: string }
export interface InstallStep { readonly key: string; readonly label: string; status: 'PENDING' | 'DONE' | 'SKIPPED' | 'FAILED'; at: string | null; detail: string }
export interface InstallRecord {
  readonly installId: string;
  readonly candidateId: string;
  readonly runId: string;
  readonly reportHash: string;
  readonly moduleKey: string;
  readonly moduleName: string;
  readonly packageVersion: string;
  readonly packageHash: string;
  readonly classification: 'NEW_MODULE' | 'UPGRADE';
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly dryRun: boolean;
  readonly environment: PreflightEnvironment;
  state: InstallState;
  updatedAt: string;
  blockers: Blocker[];
  warnings: string[];
  steps: InstallStep[];
  before: { lock: { packageVersion: string; packageHash: string } | null; activeVersion: string | null; versions: { moduleVersion: string; status: string }[]; moduleId: string | null; draftVersionId: string | null };
  after: { moduleId: string | null; versionId: string | null; versionStatus: string | null; enabled: boolean | null };
  postcheck: { key: string; status: 'PASS' | 'FAIL'; detail: string }[];
  recovery: string[];
  history: { at: string; state: InstallState; by: string; note: string }[];
}

export interface RuntimeRelease { readonly moduleKey: string; readonly packageVersion: string; readonly packageHash: string | null }
// What THIS process runs: the generated registry it was started with, and the module routers it mounted.
export interface InstallerRuntime {
  readonly modules: readonly RuntimeRelease[];
  readonly routers: ReadonlyMap<string, Router>;
}

export interface IamPermissionRow { readonly permissionCode: string; readonly moduleCode: string; readonly resourceCode: string; readonly operation: string; readonly minimumAssuranceLevel: number }
// IAM catalog writes through the IAM Management repository (talo_iam_admin, IAM audit): createPermission() itself
// requires the K05 triple to be in the ACTIVE, hash-intact MIC-07 of the module.
export interface IamCatalog {
  readonly permission: PermissionRef;
  existing(moduleCode: string): Promise<IamPermissionRow[]>;
  // INSERT privilege of the IAM connection on iam.iam_permissions (read-only check, never granted here).
  writable(): Promise<boolean>;
  create(actor: Actor, row: IamPermissionRow & { readonly description: string }): Promise<void>;
}

export interface InstallerDeps {
  readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly db: Pick<FoundationDb, 'query'>;
  readonly registry: ModuleScanRegistry;
  readonly scans: Pick<ModuleScanService, 'stored'>;
  readonly modules: Pick<FoundationService, 'registerModule'>;
  readonly versions: Pick<ModuleVersionService, 'createVersion'>;
  readonly manifests: Pick<ModuleManifestService, 'updateManifest' | 'submit'>;
  readonly lifecycle: Pick<ModuleLifecycleService, 'approve' | 'activate' | 'enable' | 'disable'>;
  readonly navigation: Pick<NavigationService, 'createItem'>;
  readonly iam: IamCatalog | null;
  readonly runtime: InstallerRuntime;
  readonly paths: PreflightPaths;
  readonly store: InstallerStore;
  readonly environment: PreflightEnvironment;
  readonly allowedDatabase: string;
  readonly logger: Logger;
  readonly exec?: Exec;
  readonly now?: () => number;
  readonly planTtlMs?: number;
}

const createBody = z.strictObject({ scanId: z.uuid(), moduleKey: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/) });
const emptyBody = z.strictObject({});
const commitBody = z.strictObject({ planId: z.uuid(), acknowledge: z.literal(true) });
const DENIED_TARGET = 'MODULE_INSTALLER';
const TERMINAL: readonly CandidateStatus[] = ['INVALIDATED', 'CANCELLED'];
const OPEN_INSTALL: readonly InstallState[] = ['PREPARING', 'STAGED', 'PUBLISHING', 'AWAITING_RESTART', 'CUTTING_OVER', 'POSTCHECK', 'RECOVERY_REQUIRED'];
const COMMIT_PERMISSIONS: readonly PermissionRef[] = [MODULE_REGISTRY_CREATE, MODULE_VERSION_CREATE, MODULE_VERSION_UPDATE, MODULE_VERSION_SUBMIT,
  MODULE_VERSION_APPROVE, MODULE_VERSION_ACTIVATE, MODULE_REGISTRY_ENABLE, NAVIGATION_MANAGE];

const STEP_LABELS: readonly (readonly [string, string])[] = [
  ['VERIFY', 'Xác minh candidate READY, hash, bằng chứng và môi trường'],
  ['RELEASE', 'Ghi release bất biến vào module-releases (hash xác minh)'],
  ['REGISTER', 'Đăng ký Module (B01)'],
  ['VERSION', 'Phiên bản B02 (tạo DRAFT hoặc dùng lại DRAFT có sẵn)'],
  ['MIC', 'Ghi MIC với bằng chứng MIC-10 của FMI-02 (server)'],
  ['SUBMIT', 'SUBMIT (MIC validation, B03–B06, B10–B14)'],
  ['APPROVE', 'APPROVE'],
  ['LOCK', 'Cập nhật lock triển khai (module-deployments.json)'],
  ['RESTART', 'Khởi động lại Backend + Frontend (thủ công: chưa có deploy supervisor)'],
  ['ACTIVATE', 'ACTIVATE (Activation Gate)'],
  ['ENABLE', 'ENABLE'],
  ['IAM_CATALOG', 'Danh mục quyền IAM theo MIC-07 (không tự gán quyền)'],
  ['NAVIGATION', 'Menu B09 theo MIC-04 (idempotent)'],
  ['POSTCHECK', 'Hậu kiểm runtime / B02 / IAM / B09 / API'],
];

type Mic = {
  mic01Identity: { moduleKey: string; moduleName: string; moduleVersion: string; micStandard: string };
  mic04Navigation: { routePath?: string; menuLabel: string; functionKey?: string }[];
  mic05Api: { method: string; path: string }[];
  mic07IamMapping: { functionKey: string; actionKey: string; moduleCode: string; resourceCode: string; operation: string; minimumAssuranceLevel: number }[];
  mic10Manifest: { testEvidence: { name: string; result: string; reference: string }[] } & Record<string, unknown>;
} & Record<string, unknown>;

const errorCode = (e: unknown): string => (typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code: unknown }).code === 'string' ? (e as { code: string }).code : 'INTERNAL');
const fileSha = (file: string): string | null => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null);

export class ModuleInstallerService {
  private readonly guard: AccessGuard;
  private readonly now: () => number;
  private readonly ttl: number;
  private preflight: Promise<void> | null = null;
  private readonly moduleLocks = new Set<string>();

  constructor(private readonly deps: InstallerDeps) {
    this.guard = new AccessGuard({ repository: deps.access, logger: deps.logger });
    this.now = deps.now ?? Date.now;
    this.ttl = deps.planTtlMs ?? 15 * 60 * 1000;
    deps.store.init();
  }

  // Test seam: resolves when no preflight run is in progress.
  async whenIdle(): Promise<void> {
    await this.preflight;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private async authorize(actor: Actor, action: string, ...permissions: PermissionRef[]): Promise<void> {
    for (const p of permissions) await this.guard.authorize(actor, p, action, DENIED_TARGET);
  }

  private async allowed(actor: Actor, permission: PermissionRef): Promise<boolean> {
    try {
      return evaluateAccess(await this.deps.access.loadAccessFacts(actor.userAccountId, permission), actor.assuranceLevel).allowed;
    } catch {
      return false;
    }
  }

  private body<T>(schema: z.ZodType<T>, value: unknown): T {
    const r = schema.safeParse(value ?? {});
    if (!r.success) throw new InstallerError(400, 'VALIDATION_ERROR', { fields: [...new Set(r.error.issues.map((i) => (i.code === 'unrecognized_keys' ? 'UNKNOWN_FIELD' : String(i.path[0] ?? 'body'))))].sort() });
    return r.data;
  }

  private candidate(id: unknown): CandidateRecord {
    const c = isStoreId(id) ? this.deps.store.readCandidate<CandidateRecord>(id) : null;
    if (c === null) throw new InstallerError(404, 'CANDIDATE_NOT_FOUND');
    return c;
  }

  private setCandidate(c: CandidateRecord, status: CandidateStatus, by: string, note: string): void {
    c.status = status;
    c.updatedAt = this.iso();
    c.history.push({ at: c.updatedAt, status, by, note });
    this.deps.store.writeCandidate(c.candidateId, c);
  }

  private snapshotDir(c: CandidateRecord): string {
    return join(this.deps.store.packageDir(c.candidateId), c.moduleKey);
  }

  private sourceHash(c: CandidateRecord): string | null {
    const dir = join(this.deps.paths.modulesRoot, c.folder);
    return existsSync(dir) ? hashPackage(dir, walkPackage(dir)).hash : null;
  }

  // ----------------------------------------------------------------------------------------------- candidates
  async createCandidate(actor: Actor, body: unknown): Promise<{ candidate: CandidateRecord; created: boolean }> {
    await this.authorize(actor, 'MODULE_CANDIDATE.CREATE', MODULE_REGISTRY_READ, MODULE_REGISTRY_CREATE);
    const { scanId, moduleKey } = this.body(createBody, body);
    const scan = this.deps.scans.stored(scanId);
    if (scan === null) throw new InstallerError(404, 'SCAN_NOT_FOUND');
    const m: ScannedModule | undefined = scan.modules.find((x) => x.moduleKey === moduleKey);
    if (m === undefined || m.packageVersion === null) throw new InstallerError(404, 'CANDIDATE_SOURCE_NOT_FOUND');
    if (!m.eligibleForPreflight || m.packageHash === null) throw new InstallerError(409, 'CANDIDATE_NOT_ELIGIBLE');
    const open = this.deps.store.listCandidates<CandidateRecord>().filter((c) => c.moduleKey === moduleKey && !TERMINAL.includes(c.status));
    const same = open.find((c) => c.sourceHash === m.packageHash);
    if (same) return { candidate: same, created: false };
    const candidateId = this.deps.store.newId();
    const at = this.iso();
    const c: CandidateRecord = {
      candidateId, moduleKey, moduleName: m.moduleName ?? moduleKey, packageVersion: m.packageVersion, folder: m.folder, scanId, sourceHash: m.packageHash,
      classification: m.classification, routes: m.routes, createdBy: actor.userAccountId, createdAt: at, status: 'SCANNED', updatedAt: at,
      latestRunId: null, readyRunId: null, readyReportHash: null, history: [{ at, status: 'SCANNED', by: actor.userAccountId, note: `scan ${scanId}` }],
    };
    try {
      copyPackage(join(this.deps.paths.modulesRoot, m.folder), this.snapshotDir(c), m.packageHash);
    } catch {
      this.deps.store.remove(candidateId);
      throw new InstallerError(409, 'PACKAGE_CHANGED');
    }
    this.deps.store.writeCandidate(candidateId, c);
    for (const old of open) this.setCandidate(old, 'INVALIDATED', actor.userAccountId, `superseded by candidate ${candidateId} (package hash changed)`);
    this.deps.logger.info('module candidate created', { requestId: actor.requestId, candidateId, moduleKey, packageVersion: c.packageVersion });
    return { candidate: c, created: true };
  }

  async listCandidates(actor: Actor): Promise<CandidateRecord[]> {
    await this.authorize(actor, 'MODULE_CANDIDATE.READ', MODULE_REGISTRY_READ);
    return this.deps.store.listCandidates<CandidateRecord>().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 50);
  }

  async getCandidate(actor: Actor, candidateId: unknown): Promise<CandidateRecord> {
    await this.authorize(actor, 'MODULE_CANDIDATE.READ', MODULE_REGISTRY_READ);
    return this.candidate(candidateId);
  }

  // ----------------------------------------------------------------------------------------------- preflight
  async startPreflight(actor: Actor, candidateId: unknown, body: unknown): Promise<{ runId: string; status: 'RUNNING' }> {
    await this.authorize(actor, 'MODULE_CANDIDATE.PREFLIGHT', MODULE_REGISTRY_READ, MODULE_REGISTRY_CREATE);
    this.body(emptyBody, body);
    const c = this.candidate(candidateId);
    if (TERMINAL.includes(c.status) || c.status === 'VALIDATING') throw new InstallerError(409, 'CANDIDATE_STATE_CONFLICT');
    if (this.preflight !== null) throw new InstallerError(409, 'PREFLIGHT_IN_PROGRESS');
    const runId = this.deps.store.newId();
    const run = newRun({ runId, candidateId: c.candidateId, moduleKey: c.moduleKey, packageVersion: c.packageVersion, packageHash: c.sourceHash,
      environment: this.deps.environment, startedBy: actor.userAccountId, startedAt: this.iso() });
    this.deps.store.writeRun(c.candidateId, runId, run);
    c.latestRunId = runId;
    c.readyRunId = null;
    c.readyReportHash = null;
    this.setCandidate(c, 'VALIDATING', actor.userAccountId, `preflight ${runId}`);
    this.preflight = this.execute(actor, c, run).finally(() => {
      this.preflight = null;
    });
    return { runId, status: 'RUNNING' };
  }

  private async execute(actor: Actor, c: CandidateRecord, run: PreflightRun): Promise<void> {
    const { store } = this.deps;
    try {
      await runPreflight(run, { candidateId: c.candidateId, moduleKey: c.moduleKey, folder: c.folder, sourceHash: c.sourceHash, snapshotDir: this.snapshotDir(c) }, {
        paths: this.deps.paths, registry: this.deps.registry, db: this.deps.db, now: this.now, stagingRoot: join(store.root, 'staging'),
        ...(this.deps.exec ? { exec: this.deps.exec } : {}),
        onProgress: (r) => store.writeRun(c.candidateId, r.runId, r),
        writeLog: (id, content) => {
          store.writeRunFile(c.candidateId, run.runId, `logs/${id}.log`, content);
          return `candidates/${c.candidateId}/runs/${run.runId}/logs/${id}.log`;
        },
      });
      concludeRun(run);
      run.status = 'COMPLETED';
    } catch (error) {
      this.deps.logger.error('preflight engine error', { requestId: actor.requestId, runId: run.runId, errorName: error instanceof Error ? error.name : typeof error });
      concludeRun(run);
      run.status = 'ERROR';
      run.result = 'NEEDS_FIX';
      run.limitations.push('Lỗi engine trong lượt chạy: kết quả không đầy đủ.');
    }
    run.finishedAt = this.iso();
    const status: CandidateStatus = run.status === 'ERROR' ? 'ERROR' : run.result === 'READY' ? 'READY' : run.result === 'INVALIDATED' ? 'INVALIDATED' : 'NEEDS_FIX';
    const ctx = { folder: c.folder, scanId: c.scanId, candidateStatus: status };
    const json = reportJson(run, ctx);
    store.writeRunFile(c.candidateId, run.runId, 'report.json', json);
    store.writeRunFile(c.candidateId, run.runId, 'report.txt', reportTxt(run, ctx));
    run.reportHash = createHash('sha256').update(json, 'utf8').digest('hex');
    store.writeRun(c.candidateId, run.runId, run);
    const fresh = store.readCandidate<CandidateRecord>(c.candidateId) ?? c;
    fresh.latestRunId = run.runId;
    if (status === 'READY') {
      fresh.readyRunId = run.runId;
      fresh.readyReportHash = run.reportHash;
    }
    this.setCandidate(fresh, status, actor.userAccountId, `preflight ${run.runId} ${run.result ?? run.status}`);
    this.deps.logger.info('preflight completed', { requestId: actor.requestId, runId: run.runId, candidateId: c.candidateId, result: run.result, summary: JSON.stringify(run.summary) });
  }

  async getRun(actor: Actor, candidateId: unknown, runId: unknown): Promise<PreflightRun> {
    await this.authorize(actor, 'MODULE_CANDIDATE.READ', MODULE_REGISTRY_READ);
    const c = this.candidate(candidateId);
    const run = isStoreId(runId) ? this.deps.store.readRun<PreflightRun>(c.candidateId, runId) : null;
    if (run === null) throw new InstallerError(404, 'RUN_NOT_FOUND');
    return run;
  }

  async report(actor: Actor, candidateId: unknown, runId: unknown, kind: 'json' | 'txt'): Promise<{ name: string; content: string }> {
    const run = await this.getRun(actor, candidateId, runId);
    if (run.status === 'RUNNING') throw new InstallerError(409, 'REPORT_NOT_READY');
    const content = this.deps.store.readRunFile(run.candidateId, run.runId, `report.${kind}`);
    if (content === null) throw new InstallerError(409, 'REPORT_NOT_READY');
    return { name: `preflight-${run.moduleKey}-${run.packageVersion}-${run.runId.slice(0, 8)}.${kind}`, content };
  }

  // ----------------------------------------------------------------------------------------------- install: prepare
  private lock(): Map<string, { packageVersion: string; packageHash: string }> {
    return parseDeployments(JSON.parse(readFileSync(this.deps.paths.lockFile, 'utf8')));
  }

  private frontendRegistry(): string {
    try {
      return readFileSync(join(this.deps.paths.frontendDir, 'src', 'installed-modules', 'registry.ts'), 'utf8');
    } catch {
      return '';
    }
  }

  // Running backend (this process) and the frontend registry the dev server serves, against the lock.
  runtimeState(): { backend: RuntimeRelease[]; frontend: RuntimeRelease[]; lock: RuntimeRelease[]; matches: boolean } {
    const lock = [...this.lock().entries()].map(([moduleKey, v]) => ({ moduleKey, packageVersion: v.packageVersion, packageHash: v.packageHash })).sort((a, b) => (a.moduleKey < b.moduleKey ? -1 : 1));
    const backend = [...this.deps.runtime.modules].sort((a, b) => (a.moduleKey < b.moduleKey ? -1 : 1));
    const frontend = [...this.frontendRegistry().matchAll(/\{"moduleKey":"([A-Z][A-Z0-9_]*)","name":"(?:[^"\\]|\\.)*","packageVersion":"([0-9.]+)","packageHash":(null|"[0-9a-f]{64}")/g)]
      .map((x) => ({ moduleKey: x[1] ?? '', packageVersion: x[2] ?? '', packageHash: x[3] === 'null' || x[3] === undefined ? null : x[3].slice(1, -1) })).sort((a, b) => (a.moduleKey < b.moduleKey ? -1 : 1));
    const key = (r: RuntimeRelease[]) => JSON.stringify(r.map((x) => [x.moduleKey, x.packageVersion, x.packageHash]));
    return { backend, frontend, lock, matches: key(backend) === key(lock) && key(frontend) === key(lock) };
  }

  async runtimeRelease(actor: Actor): Promise<ReturnType<ModuleInstallerService['runtimeState']> & { environment: PreflightEnvironment; supervisor: 'NONE' }> {
    await this.authorize(actor, 'MODULE_RUNTIME.READ', MODULE_REGISTRY_READ);
    return { ...this.runtimeState(), environment: this.deps.environment, supervisor: 'NONE' };
  }

  private async moduleFacts(moduleKey: string): Promise<{ moduleId: string | null; enabled: boolean | null; versions: { versionId: string; moduleVersion: string; status: string }[] }> {
    const rows = (await this.deps.db.query(`
      SELECT m.module_id::text AS module_id, m.is_enabled, v.version_id::text AS version_id, v.module_version, v.status
        FROM foundation.fnd_modules AS m LEFT JOIN foundation.fnd_module_versions AS v ON v.module_id = m.module_id
       WHERE m.module_key = $1 ORDER BY v.created_at`, [moduleKey])) as { module_id: string; is_enabled: boolean; version_id: string | null; module_version: string | null; status: string | null }[];
    return {
      moduleId: rows[0]?.module_id ?? null, enabled: rows[0]?.is_enabled ?? null,
      versions: rows.flatMap((r) => (r.version_id && r.module_version && r.status ? [{ versionId: r.version_id, moduleVersion: r.module_version, status: r.status }] : [])),
    };
  }

  private async blockersFor(actor: Actor, c: CandidateRecord): Promise<{ blockers: Blocker[]; warnings: string[]; facts: Awaited<ReturnType<ModuleInstallerService['moduleFacts']>>; classification: 'NEW_MODULE' | 'UPGRADE' }> {
    const blockers: Blocker[] = [];
    const warnings: string[] = [];
    const add = (code: string, message: string) => blockers.push({ code, message });
    if (this.deps.environment.database !== this.deps.allowedDatabase) add('WRONG_DB_TARGET', `Database runtime ${this.deps.environment.database} không phải ${this.deps.allowedDatabase}: từ chối mọi tác động.`);
    if (c.status !== 'READY' || c.readyRunId === null || c.readyReportHash === null) add('CANDIDATE_NOT_READY', 'Candidate chưa READY (chạy Kiểm tra & Chạy thử).');
    const src = this.sourceHash(c);
    const snap = hashPackage(this.snapshotDir(c), walkPackage(this.snapshotDir(c))).hash;
    if (src !== c.sourceHash || snap !== c.sourceHash) {
      add('PACKAGE_CHANGED', 'Package nguồn hoặc snapshot đã thay đổi sau preflight: bằng chứng mất hiệu lực.');
      if (!TERMINAL.includes(c.status)) this.setCandidate(c, 'INVALIDATED', actor.userAccountId, 'package changed after preflight');
    }
    if (c.readyRunId !== null) {
      const stored = fileSha(join(this.deps.store.runDir(c.candidateId, c.readyRunId), 'report.json'));
      const run = this.deps.store.readRun<PreflightRun>(c.candidateId, c.readyRunId);
      if (stored === null || stored !== c.readyReportHash || run?.result !== 'READY' || run.packageHash !== c.sourceHash || run.environment.database !== this.deps.environment.database) {
        add('EVIDENCE_INVALID', 'Báo cáo preflight không khớp mã băm / package / môi trường đã lưu.');
      }
    }
    const facts = await this.moduleFacts(c.moduleKey);
    const active = facts.versions.find((v) => v.status === 'ACTIVE');
    const classification = facts.moduleId === null ? 'NEW_MODULE' : 'UPGRADE';
    if (active) add('UPGRADE_RECOVERY_UNAVAILABLE', `${c.moduleKey} đang có ${active.moduleVersion} ACTIVE: ACTIVATE sẽ RETIRE bản này và Foundation chưa có đường RETIRED → ACTIVE đã kiểm thử. Cutover tự động bị chặn.`);
    else if (classification === 'UPGRADE') add('UPGRADE_NOT_SUPPORTED', `${c.moduleKey} đã đăng ký: trình cài đặt hiện chỉ hỗ trợ module mới.`);
    const same = facts.versions.find((v) => v.moduleVersion === c.packageVersion);
    if (same && same.status !== 'DRAFT') add('VERSION_LOCKED', `Phiên bản ${c.packageVersion} đã ${same.status}: không ghi đè; tăng packageVersion.`);
    const lock = this.lock();
    if (lock.has(c.moduleKey)) add('ALREADY_DEPLOYED', `${c.moduleKey} đã có trong lock triển khai (${lock.get(c.moduleKey)?.packageVersion ?? ''}).`);
    const target = releaseDir(this.deps.paths.releasesDir, c.moduleKey, c.packageVersion);
    if (existsSync(target) && hashPackage(target, walkPackage(target)).hash !== c.sourceHash) add('RELEASE_CONFLICT', 'Kho release đã có phiên bản này với nội dung khác.');
    const registry = await this.deps.registry.read().catch(() => null);
    if (registry === null) add('REGISTRY_UNAVAILABLE', 'Không đọc được Foundation Registry.');
    for (const r of c.routes) {
      const holders = (registry?.versions ?? []).filter((v) => v.moduleKey !== c.moduleKey && (v.activeRoutes ?? []).includes(r));
      const on = holders.filter((h) => h.moduleEnabled !== false).map((h) => h.moduleKey);
      const off = holders.filter((h) => h.moduleEnabled === false).map((h) => h.moduleKey);
      if (on.length > 0) add('ROUTE_CONFLICT', `Route ${r} đang thuộc module ACTIVE đang bật ${on.join(', ')}.`);
      if (off.length > 0) warnings.push(`Route ${r} còn trong MIC ACTIVE của module đang TẮT ${off.join(', ')} (không bật lại module đó).`);
    }
    const missing: string[] = [];
    for (const p of COMMIT_PERMISSIONS) if (!(await this.allowed(actor, p))) missing.push(p.permissionCode);
    if (this.deps.iam === null) add('IAM_CATALOG_UNAVAILABLE', 'Kết nối IAM Management không sẵn sàng: không tạo được danh mục quyền (fail closed).');
    else {
      if (!(await this.allowed(actor, this.deps.iam.permission))) missing.push(this.deps.iam.permission.permissionCode);
      if (!(await this.deps.iam.writable().catch(() => false))) add('IAM_DB_GRANT_MISSING', 'Role IAM Management không có quyền INSERT trên iam.iam_permissions: không tạo được danh mục quyền MIC-07. Cần chủ dự án phê duyệt grant (không tự GRANT).');
    }
    if (missing.length > 0) add('ACTOR_PERMISSION_MISSING', `Tài khoản thiếu quyền: ${missing.join(', ')}.`);
    if (!this.runtimeState().matches) add('RUNTIME_RESTART_PENDING', 'Backend / Frontend đang chạy không khớp lock triển khai (một lượt cài đặt khác chờ khởi động lại).');
    const busy = this.deps.store.listInstalls<InstallRecord>().filter((i) => i.moduleKey === c.moduleKey && OPEN_INSTALL.includes(i.state));
    if (busy.length > 0) add('INSTALL_IN_PROGRESS', `Đang có lượt cài đặt ${busy[0]?.installId ?? ''} (${busy[0]?.state ?? ''}).`);
    warnings.push('Chưa có deploy supervisor: sau bước LOCK cần khởi động lại Backend và Frontend thủ công (DEPLOY_RESTART_REQUIRED), rồi bấm Tiếp tục.');
    warnings.push('Quyền IAM chỉ được tạo trong danh mục; gán cho vai trò / tài khoản theo chính sách trong màn hình IAM.');
    return { blockers, warnings, facts, classification };
  }

  async prepare(actor: Actor, candidateId: unknown, body: unknown): Promise<InstallRecord> {
    await this.authorize(actor, 'MODULE_INSTALL.PREPARE', MODULE_REGISTRY_READ, MODULE_VERSION_ACTIVATE);
    this.body(emptyBody, body);
    const c = this.candidate(candidateId);
    const { blockers, warnings, facts, classification } = await this.blockersFor(actor, c);
    const at = this.iso();
    const lockEntry = this.lock().get(c.moduleKey) ?? null;
    const draft = facts.versions.find((v) => v.moduleVersion === c.packageVersion && v.status === 'DRAFT');
    const record: InstallRecord = {
      installId: this.deps.store.newId(), candidateId: c.candidateId, runId: c.readyRunId ?? '', reportHash: c.readyReportHash ?? '', moduleKey: c.moduleKey, moduleName: c.moduleName,
      packageVersion: c.packageVersion, packageHash: c.sourceHash, classification, createdBy: actor.userAccountId, createdAt: at,
      expiresAt: new Date(this.now() + this.ttl).toISOString(), dryRun: true, environment: this.deps.environment, state: blockers.length > 0 ? 'BLOCKED' : 'PREPARED', updatedAt: at,
      blockers, warnings,
      steps: STEP_LABELS.map(([key, label]) => ({ key, label, status: 'PENDING', at: null,
        detail: key === 'VERSION' ? (draft ? `Dùng lại DRAFT ${draft.versionId} (không tạo bản trùng).` : 'Tạo DRAFT mới.') : key === 'REGISTER' && facts.moduleId !== null ? `B01 đã có (${facts.moduleId}).` : '' })),
      before: { lock: lockEntry, activeVersion: facts.versions.find((v) => v.status === 'ACTIVE')?.moduleVersion ?? null, versions: facts.versions.map((v) => ({ moduleVersion: v.moduleVersion, status: v.status })), moduleId: facts.moduleId, draftVersionId: draft?.versionId ?? null },
      after: { moduleId: null, versionId: null, versionStatus: null, enabled: null }, postcheck: [], recovery: [],
      history: [{ at, state: blockers.length > 0 ? 'BLOCKED' : 'PREPARED', by: actor.userAccountId, note: `prepare: ${blockers.length} blocker(s)` }],
    };
    this.deps.store.writeInstall(record.installId, record);
    this.deps.logger.info('module install prepared', { requestId: actor.requestId, installId: record.installId, moduleKey: c.moduleKey, blockers: blockers.map((b) => b.code).join(',') });
    return record;
  }

  // ----------------------------------------------------------------------------------------------- install: commit
  private install(id: unknown): InstallRecord {
    const r = isStoreId(id) ? this.deps.store.readInstall<InstallRecord>(id) : null;
    if (r === null) throw new InstallerError(404, 'INSTALL_NOT_FOUND');
    return r;
  }

  private save(r: InstallRecord, state: InstallState, by: string, note: string): void {
    r.state = state;
    r.updatedAt = this.iso();
    r.history.push({ at: r.updatedAt, state, by, note });
    this.deps.store.writeInstall(r.installId, r);
  }

  private step(r: InstallRecord, key: string, status: InstallStep['status'], detail: string): void {
    const s = r.steps.find((x) => x.key === key);
    if (s) {
      s.status = status;
      s.at = this.iso();
      s.detail = detail;
    }
    this.deps.store.writeInstall(r.installId, r);
  }

  private async withModuleLock<T>(moduleKey: string, fn: () => Promise<T>): Promise<T> {
    if (this.moduleLocks.has(moduleKey)) throw new InstallerError(409, 'INSTALL_IN_PROGRESS');
    this.moduleLocks.add(moduleKey);
    try {
      return await fn();
    } finally {
      this.moduleLocks.delete(moduleKey);
    }
  }

  async commit(actor: Actor, candidateId: unknown, body: unknown): Promise<InstallRecord> {
    await this.authorize(actor, 'MODULE_INSTALL.COMMIT', MODULE_REGISTRY_READ, MODULE_VERSION_ACTIVATE);
    const { planId } = this.body(commitBody, body);
    const c = this.candidate(candidateId);
    const plan = this.deps.store.readInstall<InstallRecord>(planId);
    if (plan === null || plan.candidateId !== c.candidateId) throw new InstallerError(404, 'PLAN_NOT_FOUND');
    if (plan.state === 'BLOCKED') throw new InstallerError(409, 'PLAN_BLOCKED', { blockers: plan.blockers.map((b) => b.code) });
    if (plan.state !== 'PREPARED' || Date.parse(plan.expiresAt) <= this.now() || plan.runId !== c.readyRunId || plan.packageHash !== c.sourceHash) {
      if (plan.state === 'PREPARED') this.save(plan, 'EXPIRED', actor.userAccountId, 'plan no longer valid');
      throw new InstallerError(409, 'PLAN_EXPIRED');
    }
    return this.withModuleLock(c.moduleKey, async () => {
      // The plan is re-evaluated right before any write; a new blocker stops here, nothing written.
      const fresh = await this.blockersFor(actor, c);
      if (fresh.blockers.length > 0) {
        plan.blockers = fresh.blockers;
        this.step(plan, 'VERIFY', 'FAILED', fresh.blockers.map((b) => b.code).join(', '));
        this.save(plan, 'FAILED_SAFE', actor.userAccountId, 'blocked at commit: nothing written');
        throw new InstallerError(409, 'PLAN_BLOCKED', { blockers: fresh.blockers.map((b) => b.code) });
      }
      for (const p of COMMIT_PERMISSIONS) await this.guard.authorize(actor, p, 'MODULE_INSTALL.COMMIT', DENIED_TARGET);
      this.step(plan, 'VERIFY', 'DONE', `Candidate READY, hash ${c.sourceHash.slice(0, 12)}…, báo cáo ${plan.reportHash.slice(0, 12)}…, DB ${this.deps.environment.database}.`);
      this.save(plan, 'PREPARING', actor.userAccountId, `commit acknowledged by ${actor.userAccountId}`);
      let current = 'RELEASE';
      try {
        const rel = writeRelease({ releasesDir: this.deps.paths.releasesDir, moduleKey: c.moduleKey, packageVersion: c.packageVersion, sourceDir: this.snapshotDir(c), expectedHash: c.sourceHash });
        this.step(plan, 'RELEASE', 'DONE', `${rel.created ? 'Đã ghi' : 'Đã có (cùng hash)'} module-releases/${c.moduleKey}/${c.packageVersion}.`);
        this.save(plan, 'STAGED', actor.userAccountId, 'release stored');
        this.save(plan, 'PUBLISHING', actor.userAccountId, 'B01 / B02 / MIC');
        const mic = this.composeMic(c, plan);
        current = 'REGISTER';
        let moduleId = plan.before.moduleId;
        if (moduleId === null) {
          const m = await this.deps.modules.registerModule(actor, { moduleKey: c.moduleKey, moduleName: mic.mic01Identity.moduleName.slice(0, 150), moduleType: 'INTERNAL', description: `Cài đặt bởi Foundation Installer (FMI-03) từ package ${c.packageVersion}.` });
          moduleId = m.moduleId;
          this.step(plan, 'REGISTER', 'DONE', `B01 ${moduleId}.`);
        } else this.step(plan, 'REGISTER', 'SKIPPED', `B01 đã có ${moduleId}.`);
        plan.after.moduleId = moduleId;
        current = 'VERSION';
        const facts = await this.moduleFacts(c.moduleKey);
        const draft = facts.versions.find((v) => v.moduleVersion === c.packageVersion && v.status === 'DRAFT');
        const versionId = draft?.versionId ?? (await this.deps.versions.createVersion(actor, moduleId, { moduleVersion: c.packageVersion, contractVersion: 'MIC-1.0' })).versionId;
        plan.after.versionId = versionId;
        this.step(plan, 'VERSION', draft ? 'SKIPPED' : 'DONE', draft ? `Dùng lại DRAFT ${versionId}.` : `DRAFT ${versionId}.`);
        current = 'MIC';
        const raw = JSON.stringify({ manifest: mic });
        await this.deps.manifests.updateManifest(actor, moduleId, versionId, JSON.parse(raw), raw);
        const expected = canonicalDigest(mic).sha256;
        this.step(plan, 'MIC', 'DONE', `MIC ghi với bằng chứng ${mic.mic10Manifest.testEvidence[0]?.reference ?? ''} (manifest ${expected.slice(0, 12)}…).`);
        current = 'SUBMIT';
        await this.deps.manifests.submit(actor, moduleId, versionId, { expectedManifestHash: expected });
        this.step(plan, 'SUBMIT', 'DONE', 'IN_REVIEW.');
        current = 'APPROVE';
        await this.deps.lifecycle.approve(actor, moduleId, versionId, {});
        this.step(plan, 'APPROVE', 'DONE', 'APPROVED.');
        current = 'LOCK';
        const entries = [...this.lock().entries()].map(([moduleKey, v]) => ({ moduleKey, ...v }));
        writeDeployments(this.deps.paths.lockFile, [...entries.filter((e) => e.moduleKey !== c.moduleKey), { moduleKey: c.moduleKey, packageVersion: c.packageVersion, packageHash: c.sourceHash }]);
        this.step(plan, 'LOCK', 'DONE', `Lock: ${c.moduleKey} ${c.packageVersion} ${c.sourceHash.slice(0, 12)}….`);
        this.step(plan, 'RESTART', 'PENDING', 'DEPLOY_RESTART_REQUIRED: khởi động lại Backend + Frontend (npm run dev / build chạy modules:sync từ kho release), rồi bấm Tiếp tục.');
        this.save(plan, 'AWAITING_RESTART', actor.userAccountId, 'no deploy supervisor: manual restart required');
        return plan;
      } catch (error) {
        const code = errorCode(error);
        this.step(plan, current, 'FAILED', code);
        plan.recovery = current === 'RELEASE'
          ? ['Không có thay đổi Foundation. Kiểm tra kho release rồi lập kế hoạch lại.']
          : ['Không ACTIVATE, không đổi lock: runtime giữ nguyên.', `Bản ghi B01/B02 đã tạo (nếu có) ở trạng thái chưa ACTIVE; xem bước ${current} (${code}).`];
        this.save(plan, 'FAILED_SAFE', actor.userAccountId, `${current} failed: ${code}`);
        this.deps.logger.warn('module install failed safe', { requestId: actor.requestId, installId: plan.installId, step: current, code });
        return plan;
      }
    });
  }

  private composeMic(c: CandidateRecord, plan: InstallRecord): Mic {
    const mic = JSON.parse(readFileSync(join(this.snapshotDir(c), 'mic', 'module.mic.json'), 'utf8')) as Mic;
    // MIC-10 evidence is the server's own preflight run (never the package's declaration): reference = run + report hash.
    mic.mic10Manifest = { ...mic.mic10Manifest, testEvidence: [{ name: `FMI-02 preflight ${plan.runId} (${this.deps.environment.database})`, result: 'PASS', reference: `fmi02:${plan.runId}:${plan.reportHash}` }] };
    return mic;
  }

  // ----------------------------------------------------------------------------------------------- install: continue
  async getInstall(actor: Actor, installId: unknown): Promise<InstallRecord> {
    await this.authorize(actor, 'MODULE_INSTALL.READ', MODULE_REGISTRY_READ);
    return this.install(installId);
  }

  async continueInstall(actor: Actor, installId: unknown, body: unknown): Promise<InstallRecord> {
    await this.authorize(actor, 'MODULE_INSTALL.CONTINUE', MODULE_REGISTRY_READ, MODULE_VERSION_ACTIVATE);
    this.body(emptyBody, body);
    const r = this.install(installId);
    if (r.state !== 'AWAITING_RESTART' && r.state !== 'RECOVERY_REQUIRED') throw new InstallerError(409, 'INSTALL_STATE_CONFLICT');
    if (r.classification !== 'NEW_MODULE' || r.after.moduleId === null || r.after.versionId === null) throw new InstallerError(409, 'INSTALL_STATE_CONFLICT');
    if (this.deps.environment.database !== this.deps.allowedDatabase) throw new InstallerError(409, 'INSTALL_STATE_CONFLICT');
    const rt = this.runtimeState();
    const runs = (list: RuntimeRelease[]) => list.some((m) => m.moduleKey === r.moduleKey && m.packageVersion === r.packageVersion && m.packageHash === r.packageHash);
    if (!runs(rt.backend) || !runs(rt.frontend) || !rt.matches) throw new InstallerError(409, 'RESTART_PENDING');
    const moduleId = r.after.moduleId;
    const versionId = r.after.versionId;
    return this.withModuleLock(r.moduleKey, async () => {
      this.step(r, 'RESTART', 'DONE', `Backend + Frontend chạy ${r.moduleKey} ${r.packageVersion} ${r.packageHash.slice(0, 12)}….`);
      this.save(r, 'CUTTING_OVER', actor.userAccountId, 'runtime release verified');
      const c = this.candidate(r.candidateId);
      const mic = this.composeMic(c, r);
      let current = 'ACTIVATE';
      try {
        const facts = await this.moduleFacts(r.moduleKey);
        const v = facts.versions.find((x) => x.versionId === versionId);
        if (v?.status === 'ACTIVE') this.step(r, 'ACTIVATE', 'SKIPPED', 'Đã ACTIVE.');
        else {
          await this.deps.lifecycle.activate(actor, moduleId, versionId, {});
          this.step(r, 'ACTIVATE', 'DONE', 'ACTIVE (Activation Gate PASS).');
        }
        current = 'ENABLE';
        if (facts.enabled === true) this.step(r, 'ENABLE', 'SKIPPED', 'Đã bật.');
        else {
          await this.deps.lifecycle.enable(actor, moduleId, {});
          this.step(r, 'ENABLE', 'DONE', 'Module đã bật.');
        }
        current = 'IAM_CATALOG';
        const iam = this.deps.iam;
        if (iam === null) throw Object.assign(new Error('iam unavailable'), { code: 'IAM_CATALOG_UNAVAILABLE' });
        const existing = await iam.existing(r.moduleKey);
        let created = 0;
        for (const m of mic.mic07IamMapping) {
          if (existing.some((e) => e.resourceCode === m.resourceCode && e.operation === m.operation)) continue;
          await iam.create(actor, { permissionCode: `${m.moduleCode}.${m.resourceCode}.${m.operation}`.toLowerCase(), moduleCode: m.moduleCode, resourceCode: m.resourceCode, operation: m.operation,
            minimumAssuranceLevel: m.minimumAssuranceLevel, description: `${r.moduleName}: ${m.functionKey}/${m.actionKey} (FMI-03, chưa gán cho ai)` });
          created += 1;
        }
        this.step(r, 'IAM_CATALOG', created > 0 ? 'DONE' : 'SKIPPED', `${created} quyền tạo mới, ${mic.mic07IamMapping.length - created} đã có; không gán cho vai trò / tài khoản nào.`);
        current = 'NAVIGATION';
        this.step(r, 'NAVIGATION', 'DONE', await this.navigation(actor, moduleId, r, mic));
      } catch (error) {
        const code = errorCode(error);
        this.step(r, current, 'FAILED', code);
        return this.recover(actor, r, moduleId, `${current} thất bại (${code})`);
      }
      this.save(r, 'POSTCHECK', actor.userAccountId, 'postcheck');
      r.postcheck = await this.postcheck(r, moduleId, versionId, mic);
      const failed = r.postcheck.filter((p) => p.status === 'FAIL');
      this.step(r, 'POSTCHECK', failed.length === 0 ? 'DONE' : 'FAILED', `${r.postcheck.length - failed.length}/${r.postcheck.length} PASS.`);
      if (failed.length > 0) return this.recover(actor, r, moduleId, `hậu kiểm FAIL: ${failed.map((f) => f.key).join(', ')}`);
      r.recovery = [];
      this.save(r, 'INSTALLED_ACTIVE', actor.userAccountId, 'B02 ACTIVE + runtime + IAM catalog + B09 + postcheck PASS');
      this.deps.logger.info('module installed', { requestId: actor.requestId, installId: r.installId, moduleKey: r.moduleKey, packageVersion: r.packageVersion });
      return r;
    });
  }

  // NEW_MODULE recovery (tested path): the module is DISABLED (reversible, audited) — no route, no menu, no API — and
  // the installation stays RECOVERY_REQUIRED; "Tiếp tục" retries every step idempotently.
  private async recover(actor: Actor, r: InstallRecord, moduleId: string, reason: string): Promise<InstallRecord> {
    const facts = await this.moduleFacts(r.moduleKey).catch(() => null);
    const notes = [`Nguyên nhân: ${reason}.`];
    if (facts?.enabled === true) {
      try {
        await this.deps.lifecycle.disable(actor, moduleId, {});
        notes.push('Đã TẮT module (DISABLE, có audit): không có route / menu / API phục vụ.');
      } catch (error) {
        notes.push(`Không tắt được module (${errorCode(error)}): tắt thủ công trong Quản lý Module.`);
      }
    } else notes.push('Module đang tắt.');
    notes.push('Sửa nguyên nhân rồi bấm Tiếp tục (các bước đã xong được bỏ qua). Không có đường RETIRED → ACTIVE; không xóa B07/B08.');
    r.recovery = notes;
    const after = await this.moduleFacts(r.moduleKey).catch(() => null);
    r.after.enabled = after?.enabled ?? null;
    r.after.versionStatus = after?.versions.find((v) => v.versionId === r.after.versionId)?.status ?? null;
    this.save(r, 'RECOVERY_REQUIRED', actor.userAccountId, reason);
    this.deps.logger.warn('module install needs recovery', { requestId: actor.requestId, installId: r.installId, reason });
    return r;
  }

  // B09 (idempotent): one group for the module (reused when a visible root group of the module exists), one link per
  // MIC-04 function with a route that has no link yet. Nothing is hidden, moved or deleted.
  private async navigation(actor: Actor, moduleId: string, r: InstallRecord, mic: Mic): Promise<string> {
    const rows = (await this.deps.db.query(`
      SELECT n.navigation_id::text AS navigation_id, n.parent_id::text AS parent_id, n.function_id::text AS function_id, n.is_visible, f.function_key
        FROM foundation.fnd_navigation_items AS n LEFT JOIN foundation.fnd_functions AS f ON f.function_id = n.function_id
       WHERE n.module_id = $1::uuid`, [moduleId])) as { navigation_id: string; parent_id: string | null; function_id: string | null; is_visible: boolean; function_key: string | null }[];
    const functions = (await this.deps.db.query(`SELECT function_id::text AS function_id, function_key FROM foundation.fnd_functions WHERE module_id = $1::uuid`, [moduleId])) as { function_id: string; function_key: string }[];
    const routable = mic.mic04Navigation.filter((n) => n.functionKey !== undefined && (n.routePath ?? '').trim() !== '');
    let group = rows.find((x) => x.parent_id === null && x.function_id === null && x.is_visible)?.navigation_id ?? null;
    let added = 0;
    if (group === null && routable.some((n) => !rows.some((x) => x.function_key === n.functionKey))) {
      group = (await this.deps.navigation.createItem(actor, { moduleId, menuTitle: r.moduleName.slice(0, 150), sortOrder: 100 })).navigationId;
      added += 1;
    }
    let order = 10;
    for (const n of routable) {
      const fn = functions.find((f) => f.function_key === n.functionKey);
      if (!fn || rows.some((x) => x.function_id === fn.function_id)) continue;
      await this.deps.navigation.createItem(actor, { parentId: group, moduleId, functionId: fn.function_id, menuTitle: n.menuLabel.slice(0, 150), sortOrder: order });
      order += 10;
      added += 1;
    }
    return added === 0 ? 'Menu đã có đủ liên kết (không tạo trùng).' : `${added} mục menu mới (nhóm + liên kết chức năng).`;
  }

  private async postcheck(r: InstallRecord, moduleId: string, versionId: string, mic: Mic): Promise<InstallRecord['postcheck']> {
    const out: InstallRecord['postcheck'] = [];
    const facts = await this.moduleFacts(r.moduleKey);
    const v = facts.versions.find((x) => x.versionId === versionId);
    r.after.versionStatus = v?.status ?? null;
    r.after.enabled = facts.enabled;
    out.push({ key: 'B02_ACTIVE', status: v?.status === 'ACTIVE' && facts.enabled === true ? 'PASS' : 'FAIL', detail: `B02 ${v?.status ?? 'không có'} · module ${facts.enabled ? 'bật' : 'tắt'}.` });
    const rt = this.runtimeState();
    const runs = (list: RuntimeRelease[]) => list.some((m) => m.moduleKey === r.moduleKey && m.packageVersion === r.packageVersion && m.packageHash === r.packageHash);
    out.push({ key: 'RUNTIME_RELEASE', status: runs(rt.backend) && runs(rt.frontend) && rt.matches ? 'PASS' : 'FAIL', detail: `Backend ${runs(rt.backend) ? 'khớp' : 'lệch'} · Frontend ${runs(rt.frontend) ? 'khớp' : 'lệch'} · lock ${rt.matches ? 'khớp' : 'lệch'}.` });
    const existing = this.deps.iam ? await this.deps.iam.existing(r.moduleKey) : [];
    const bad = mic.mic07IamMapping.filter((m) => existing.filter((e) => e.resourceCode === m.resourceCode && e.operation === m.operation && e.minimumAssuranceLevel === m.minimumAssuranceLevel).length !== 1);
    out.push({ key: 'IAM_CATALOG', status: bad.length === 0 && this.deps.iam !== null ? 'PASS' : 'FAIL', detail: `${mic.mic07IamMapping.length - bad.length}/${mic.mic07IamMapping.length} quyền K05 có đúng một bản ghi.` });
    const links = (await this.deps.db.query(`
      SELECT f.function_key FROM foundation.fnd_navigation_items AS n JOIN foundation.fnd_functions AS f ON f.function_id = n.function_id
        LEFT JOIN foundation.fnd_navigation_items AS p ON p.navigation_id = n.parent_id
       WHERE n.module_id = $1::uuid AND n.is_visible AND (p.navigation_id IS NULL OR p.is_visible)`, [moduleId])) as { function_key: string }[];
    const routable = mic.mic04Navigation.filter((n) => n.functionKey !== undefined && (n.routePath ?? '').trim() !== '');
    const missingLinks = routable.filter((n) => !links.some((l) => l.function_key === n.functionKey));
    out.push({ key: 'NAVIGATION', status: missingLinks.length === 0 ? 'PASS' : 'FAIL', detail: `${routable.length - missingLinks.length}/${routable.length} chức năng có route có liên kết menu hiển thị.` });
    out.push(await this.apiSmoke(r.moduleKey, mic));
    return out;
  }

  // The REAL router of the running module (mounted at start-up), called over HTTP without a session: every MIC-05
  // endpoint must answer 401 with the JSON envelope (mounted, behind the Host session — not 404 / 5xx).
  private async apiSmoke(moduleKey: string, mic: Mic): Promise<InstallRecord['postcheck'][number]> {
    const router = this.deps.runtime.routers.get(moduleKey);
    if (!router) return { key: 'API_SMOKE', status: 'FAIL', detail: 'Router của module không được mount trong tiến trình đang chạy.' };
    const app = express();
    app.use('/api', express.json({ limit: '10kb' }), router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const bad: string[] = [];
    try {
      for (const a of mic.mic05Api) {
        const method = a.method.toUpperCase();
        const res = await fetch(`${base}${a.path.replace(/\{[A-Za-z0-9_]+\}/g, 'x')}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
        const json = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
        if (res.status !== 401 || typeof json?.error?.code !== 'string') bad.push(`${method} ${a.path} → ${res.status}`);
      }
    } finally {
      server.closeAllConnections();
      server.close();
    }
    return { key: 'API_SMOKE', status: bad.length === 0 && mic.mic05Api.length > 0 ? 'PASS' : 'FAIL', detail: bad.length === 0 ? `${mic.mic05Api.length}/${mic.mic05Api.length} API trả 401 khi không có phiên (đã mount, sau session).` : bad.join('; ') };
  }

  async installReport(actor: Actor, installId: unknown): Promise<{ name: string; content: string }> {
    const r = await this.getInstall(actor, installId);
    const l: string[] = ['TALO-MOS-V4 — FMI-03 INSTALL REPORT (Cài đặt & Kích hoạt)', '='.repeat(64),
      `Install ID   : ${r.installId}`, `Module       : ${r.moduleKey} ${r.packageVersion} (${r.classification})`, `Package hash : ${r.packageHash}`,
      `Candidate    : ${r.candidateId}`, `Preflight    : ${r.runId} · report sha256 ${r.reportHash}`, `Môi trường   : ${r.environment.label} · DB ${r.environment.database}`,
      `Trạng thái   : ${r.state}`, `Tạo lúc      : ${r.createdAt} · cập nhật ${r.updatedAt}`, '', 'Điều kiện chặn:', ...(r.blockers.length === 0 ? ['- (không)'] : r.blockers.map((b) => `- ${b.code}: ${b.message}`)),
      '', 'Cảnh báo:', ...r.warnings.map((w) => `- ${w}`), '', 'Các bước:', ...r.steps.map((s) => `- [${s.status}] ${s.key} ${s.label}${s.detail ? ` — ${s.detail}` : ''}${s.at ? ` (${s.at})` : ''}`),
      '', `Trước: lock ${r.before.lock ? `${r.before.lock.packageVersion} ${r.before.lock.packageHash}` : '(không)'} · ACTIVE ${r.before.activeVersion ?? '(không)'}`,
      `Sau  : module ${r.after.moduleId ?? '—'} · version ${r.after.versionId ?? '—'} ${r.after.versionStatus ?? ''} · ${r.after.enabled === null ? '' : r.after.enabled ? 'bật' : 'tắt'}`,
      '', 'Hậu kiểm:', ...(r.postcheck.length === 0 ? ['- (chưa chạy)'] : r.postcheck.map((p) => `- [${p.status}] ${p.key}: ${p.detail}`)),
      '', 'Phục hồi:', ...(r.recovery.length === 0 ? ['- (không cần)'] : r.recovery.map((x) => `- ${x}`)),
      '', 'Lịch sử:', ...r.history.map((h) => `- ${h.at} ${h.state} — ${h.note}`),
      '', 'Không chứa cookie, chuỗi kết nối, mật khẩu hoặc token. INSTALLED_ACTIVE chỉ khi B02 ACTIVE + runtime + IAM + B09 + hậu kiểm đều PASS.'];
    return { name: `install-${r.moduleKey}-${r.packageVersion}-${r.installId.slice(0, 8)}.txt`, content: `${l.join('\n')}\n` };
  }
}
