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
import { isDeveloperFunction } from './foundation.navigation.builder.js';
import type { Draft } from './foundation.navigation.builder.js';
import type { NavigationService } from './foundation.navigation.service.js';
import {
  MODULE_REGISTRY_CREATE, MODULE_REGISTRY_ENABLE, MODULE_REGISTRY_READ, MODULE_VERSION_ACTIVATE, MODULE_VERSION_APPROVE, MODULE_VERSION_CREATE,
  MODULE_VERSION_RETIRE, MODULE_VERSION_SUBMIT, MODULE_VERSION_UPDATE, NAVIGATION_MANAGE, evaluateAccess,
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
//   FOUNDATION-REV-01: a registered module WITHOUT an ACTIVE version installs like a new one (B01 reused, a DRAFT of the
//   version reused with compare-and-swap on its stored MIC — DRAFT_CHANGED_EXTERNALLY — and a fresh read back after the
//   PUT); B09 is written through the Navigation Builder (layout → draft → apply: AREA → MENU → FUNCTION, one transaction,
//   revision check); the postcheck separates IAM_CATALOG / IAM_POLICY / ACCESS_VERIFIED: without an authenticated allowed
//   call the result is POSTCHECK_INCOMPLETE, never INSTALLED_ACTIVE.
//   REV01-D1 upgrade of a module that has an ACTIVE version: allowed only when a recovery point exists — the running lock
//   entry is the ACTIVE version and its immutable release (same hash) is in the store, and the actor may also RETIRE —
//   otherwise BLOCKED (UPGRADE_RECOVERY_UNAVAILABLE). commit snapshots B01 / B02 (ACTIVE id, MIC hash) / lock / IAM
//   catalog / B09 revision; continue journals the activation (intent, then the activated_at + retired id returned).
//   Any failure after the restart (ACTIVATE, ENABLE, IAM, B09, postcheck FAIL) → controlled rollback: Lifecycle
//   recoverUpgrade (proof = journal, re-checked under the module lock; B07 RETIRE + ROLLBACK, B08) → B01 enable flag
//   restored → B09 links added by this install hidden (Builder) → the old lock entry restored after re-hashing the old
//   release → RECOVERY_AWAITING_RESTART; after the restart the old runtime / B02 / B01 / B09 / API are verified before
//   RECOVERED. No proof (e.g. ACTIVE without a journalled activation) → RECOVERY_REQUIRED, manual: nothing guessed.
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
  UPGRADE_RECOVERY_UNAVAILABLE: 'Module đang có phiên bản ACTIVE khác nhưng không có điểm phục hồi hợp lệ: cutover bị chặn.',
  UPGRADE_STATE_MISMATCH: 'Trạng thái B02 không khớp điểm phục hồi / nhật ký của lượt cài đặt: không tiếp tục, không đoán.',
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
  // REV-01 A16: the last installation (plan / journal) of this candidate, reopened by the Workspace after any restart.
  latestInstallId?: string | null;
  history: { at: string; status: CandidateStatus; by: string; note: string }[];
}

export type InstallState = 'PREPARED' | 'BLOCKED' | 'PREPARING' | 'STAGED' | 'PUBLISHING' | 'AWAITING_RESTART' | 'CUTTING_OVER' | 'POSTCHECK'
  | 'INSTALLED_ACTIVE' | 'POSTCHECK_INCOMPLETE' | 'RECOVERY_REQUIRED' | 'RECOVERY_AWAITING_RESTART' | 'RECOVERED' | 'FAILED_SAFE' | 'EXPIRED';
export interface Blocker { readonly code: string; readonly message: string }
// One MIC section, stored DRAFT vs the Candidate MIC the installer will write (count = array length / 1 for an object).
export interface MicDiffRow { readonly section: string; readonly draft: number | null; readonly candidate: number; readonly changed: boolean }
// Where B09 links will be placed (shown in the plan, applied through the Navigation Builder after ENABLE).
export interface NavigationPlan { readonly area: string; readonly menu: string; readonly links: readonly { readonly functionKey: string; readonly title: string; readonly developer: boolean }[] }
// The operator's own request (cookie + user agent), forwarded in-process to the module router for ACCESS_VERIFIED.
export interface AccessProbe { readonly cookie?: string | undefined; readonly userAgent?: string | undefined }
export type PostcheckStatus = 'PASS' | 'FAIL' | 'NOT_TESTED';
// REV01-D1: what an upgrade restores (taken at commit, before any write).
export interface RecoveryPoint {
  readonly at: string;
  readonly moduleId: string;
  readonly activeVersionId: string;
  readonly activeVersion: string;
  readonly activeManifestHash: string;
  readonly enabled: boolean;
  readonly lock: { readonly packageVersion: string; readonly packageHash: string };
  readonly iamPermissions: readonly string[];
  readonly navigationRevision: string;
}
export type RollbackStatus = 'PENDING' | 'DONE' | 'NOT_NEEDED' | 'UNPROVEN';
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
  before: { lock: { packageVersion: string; packageHash: string } | null; activeVersion: string | null; versions: { moduleVersion: string; status: string }[]; moduleId: string | null; draftVersionId: string | null; draftManifestHash: string | null };
  after: { moduleId: string | null; versionId: string | null; versionStatus: string | null; enabled: boolean | null };
  micDiff: MicDiffRow[];
  navigationPlan: NavigationPlan | null;
  postcheck: { key: string; status: PostcheckStatus; detail: string }[];
  nextActions: string[];
  recovery: string[];
  history: { at: string; state: InstallState; by: string; note: string }[];
  recoveryPoint?: RecoveryPoint | null;
  // Journal of THIS install's activation: intent written before the call, result (activated_at, retired id) after it.
  activation?: { versionId: string; intentAt: string; activatedAt: string | null; retiredVersionId: string | null } | null;
  // B09 function links added or re-shown by this install (hidden again by a rollback).
  navigationAdded?: string[];
  rollback?: { reason: string; b02: RollbackStatus; b01: RollbackStatus; navigation: RollbackStatus; lock: RollbackStatus } | null;
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
  // Role / direct ALLOW assignments of the module's permissions (IAM policy applied by an administrator; never by us).
  assignments(moduleCode: string): Promise<number>;
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
  readonly lifecycle: Pick<ModuleLifecycleService, 'approve' | 'activate' | 'enable' | 'disable' | 'recoverUpgrade'>;
  readonly navigation: Pick<NavigationService, 'layout' | 'apply'>;
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
const OPEN_INSTALL: readonly InstallState[] = ['PREPARING', 'STAGED', 'PUBLISHING', 'AWAITING_RESTART', 'CUTTING_OVER', 'POSTCHECK', 'POSTCHECK_INCOMPLETE', 'RECOVERY_REQUIRED', 'RECOVERY_AWAITING_RESTART'];
const MIC_SECTIONS = ['mic01Identity', 'mic02Functions', 'mic03Actions', 'mic04Navigation', 'mic05Api', 'mic06DataResources', 'mic07IamMapping', 'mic08EventsAudit', 'mic09Compatibility', 'mic10Manifest'];
const norm = (t: string) => t.trim().toLocaleLowerCase('vi');
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
  ['POSTCHECK', 'Hậu kiểm runtime / B02 / IAM (danh mục, chính sách, truy cập) / B09 / API'],
];

type Mic = {
  mic01Identity: { moduleKey: string; moduleName: string; moduleVersion: string; micStandard: string };
  mic02Functions: { functionKey: string; name: string }[];
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

  // Stored MIC of a version (fresh read; canonical digest = Foundation's own manifest hash definition).
  private async storedMic(versionId: string): Promise<{ manifest: unknown; status: string | null; hash: string | null }> {
    const [row] = (await this.deps.db.query('SELECT v.manifest_json, v.status FROM foundation.fnd_module_versions AS v WHERE v.version_id = $1::uuid', [versionId])) as { manifest_json: unknown; status: string }[];
    if (!row) return { manifest: null, status: null, hash: null };
    return { manifest: row.manifest_json ?? null, status: row.status, hash: row.manifest_json === null || row.manifest_json === undefined ? null : canonicalDigest(row.manifest_json).sha256 };
  }

  private async blockersFor(actor: Actor, c: CandidateRecord, plan?: InstallRecord): Promise<{ blockers: Blocker[]; warnings: string[]; facts: Awaited<ReturnType<ModuleInstallerService['moduleFacts']>>; classification: 'NEW_MODULE' | 'UPGRADE' }> {
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
    if (active) {
      const why = this.recoveryUnavailable(c.moduleKey, active.moduleVersion);
      if (why !== null) add('UPGRADE_RECOVERY_UNAVAILABLE', `${c.moduleKey} đang có ${active.moduleVersion} ACTIVE nhưng không có điểm phục hồi: ${why} Cutover bị chặn.`);
      else warnings.push(`Nâng cấp ${active.moduleVersion} → ${c.packageVersion}: nếu một bước sau khởi động lại thất bại, trình cài đặt phục hồi ${active.moduleVersion} (B02 ROLLBACK có kiểm chứng + lock cũ) và yêu cầu khởi động lại lần nữa.`);
    }
    const same = facts.versions.find((v) => v.moduleVersion === c.packageVersion);
    if (same && same.status !== 'DRAFT') add('VERSION_LOCKED', `Phiên bản ${c.packageVersion} đã ${same.status}: không ghi đè; tăng packageVersion.`);
    if (same?.status === 'DRAFT') {
      const stored = await this.storedMic(same.versionId);
      if (plan !== undefined && (plan.before.draftVersionId !== same.versionId || plan.before.draftManifestHash !== stored.hash)) {
        add('DRAFT_CHANGED_EXTERNALLY', `DRAFT ${c.packageVersion} đã thay đổi sau khi lập kế hoạch (ngoài trình cài đặt): không ghi đè, lập kế hoạch lại và xem lại khác biệt MIC.`);
      }
      if (stored.manifest !== null) warnings.push(`DRAFT ${c.packageVersion} đang có MIC (hash ${(stored.hash ?? '').slice(0, 12)}…) khác Candidate: sẽ được thay bằng MIC của Candidate (xem bảng khác biệt).`);
    }
    if (plan !== undefined && plan.before.draftVersionId !== null && same === undefined) add('DRAFT_CHANGED_EXTERNALLY', 'DRAFT trong kế hoạch không còn tồn tại.');
    const target = releaseDir(this.deps.paths.releasesDir, c.moduleKey, c.packageVersion);
    if (existsSync(target) && hashPackage(target, walkPackage(target)).hash !== c.sourceHash) add('RELEASE_CONFLICT', 'Kho release đã có phiên bản này với nội dung khác.');
    const registry = await this.deps.registry.read().catch(() => null);
    if (registry === null) add('REGISTRY_UNAVAILABLE', 'Không đọc được Foundation Registry.');
    for (const r of c.routes) {
      const holders = (registry?.versions ?? []).filter((v) => v.moduleKey !== c.moduleKey && (v.activeRoutes ?? []).includes(r));
      const on = holders.filter((h) => h.moduleEnabled !== false).map((h) => h.moduleKey);
      const off = holders.filter((h) => h.moduleEnabled === false).map((h) => h.moduleKey);
      // REV01-D3: same rule and code as the Lifecycle ENABLE guard, which re-checks it under the route lock at the ENABLE step.
      if (on.length > 0) add('MODULE_ROUTE_CONFLICT', `Route ${r} đang thuộc module ACTIVE đang bật ${on.join(', ')}.`);
      if (off.length > 0) warnings.push(`Route ${r} còn trong MIC ACTIVE của module đang TẮT ${off.join(', ')}: sau khi cài, Lifecycle sẽ từ chối bật lại module đó (MODULE_ROUTE_CONFLICT).`);
    }
    const missing: string[] = [];
    for (const p of COMMIT_PERMISSIONS) if (!(await this.allowed(actor, p))) missing.push(p.permissionCode);
    if (this.deps.iam === null) add('IAM_CATALOG_UNAVAILABLE', 'Kết nối IAM Management không sẵn sàng: không tạo được danh mục quyền (fail closed).');
    else {
      if (!(await this.allowed(actor, this.deps.iam.permission))) missing.push(this.deps.iam.permission.permissionCode);
      if (!(await this.deps.iam.writable().catch(() => false))) add('IAM_DB_GRANT_MISSING', 'Role IAM Management không có quyền INSERT trên iam.iam_permissions: không tạo được danh mục quyền MIC-07. Cần chủ dự án phê duyệt grant (không tự GRANT).');
    }
    if (active && !(await this.allowed(actor, MODULE_VERSION_RETIRE))) missing.push(MODULE_VERSION_RETIRE.permissionCode);
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
    const stored = draft ? await this.storedMic(draft.versionId) : null;
    const mic = c.readyRunId !== null ? this.composeMicFor(c, c.readyRunId, c.readyReportHash ?? '') : null;
    const record: InstallRecord = {
      installId: this.deps.store.newId(), candidateId: c.candidateId, runId: c.readyRunId ?? '', reportHash: c.readyReportHash ?? '', moduleKey: c.moduleKey, moduleName: c.moduleName,
      packageVersion: c.packageVersion, packageHash: c.sourceHash, classification, createdBy: actor.userAccountId, createdAt: at,
      expiresAt: new Date(this.now() + this.ttl).toISOString(), dryRun: true, environment: this.deps.environment, state: blockers.length > 0 ? 'BLOCKED' : 'PREPARED', updatedAt: at,
      blockers, warnings,
      steps: STEP_LABELS.map(([key, label]) => ({ key, label, status: 'PENDING', at: null,
        detail: key === 'VERSION' ? (draft ? `Dùng lại DRAFT ${draft.versionId} (không tạo bản trùng).` : 'Tạo DRAFT mới.') : key === 'REGISTER' && facts.moduleId !== null ? `B01 đã có (${facts.moduleId}).` : '' })),
      before: { lock: lockEntry, activeVersion: facts.versions.find((v) => v.status === 'ACTIVE')?.moduleVersion ?? null, versions: facts.versions.map((v) => ({ moduleVersion: v.moduleVersion, status: v.status })), moduleId: facts.moduleId, draftVersionId: draft?.versionId ?? null, draftManifestHash: stored?.hash ?? null },
      after: { moduleId: null, versionId: null, versionStatus: null, enabled: null }, postcheck: [], recovery: [], nextActions: [], recoveryPoint: null, activation: null, navigationAdded: [], rollback: null,
      micDiff: mic === null ? [] : micDiff(stored?.manifest ?? null, mic, draft !== undefined),
      navigationPlan: mic === null ? null : navigationPlanOf(c.moduleKey, mic),
      history: [{ at, state: blockers.length > 0 ? 'BLOCKED' : 'PREPARED', by: actor.userAccountId, note: `prepare: ${blockers.length} blocker(s)` }],
    };
    this.deps.store.writeInstall(record.installId, record);
    this.deps.store.writeCandidate(c.candidateId, { ...(this.deps.store.readCandidate<CandidateRecord>(c.candidateId) ?? c), latestInstallId: record.installId });
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
      const fresh = await this.blockersFor(actor, c, plan);
      if (fresh.blockers.length > 0) {
        plan.blockers = fresh.blockers;
        this.step(plan, 'VERIFY', 'FAILED', fresh.blockers.map((b) => b.code).join(', '));
        this.save(plan, 'FAILED_SAFE', actor.userAccountId, 'blocked at commit: nothing written');
        throw new InstallerError(409, 'PLAN_BLOCKED', { blockers: fresh.blockers.map((b) => b.code) });
      }
      for (const p of COMMIT_PERMISSIONS) await this.guard.authorize(actor, p, 'MODULE_INSTALL.COMMIT', DENIED_TARGET);
      const activeNow = fresh.facts.versions.find((v) => v.status === 'ACTIVE');
      if (activeNow && fresh.facts.moduleId !== null) {
        await this.guard.authorize(actor, MODULE_VERSION_RETIRE, 'MODULE_INSTALL.COMMIT', DENIED_TARGET);
        plan.recoveryPoint = await this.recoveryPointOf(actor, c.moduleKey, fresh.facts.moduleId, fresh.facts.enabled === true, activeNow);
      }
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
        // Compare-and-swap: the DRAFT must still hold what the plan showed (no silent overwrite of someone's edit).
        if (draft && (await this.storedMic(versionId)).hash !== plan.before.draftManifestHash) throw Object.assign(new Error('draft changed'), { code: 'DRAFT_CHANGED_EXTERNALLY' });
        const raw = JSON.stringify({ manifest: mic });
        await this.deps.manifests.updateManifest(actor, moduleId, versionId, JSON.parse(raw), raw);
        const expected = canonicalDigest(mic).sha256;
        const readBack = await this.storedMic(versionId);
        if (readBack.hash !== expected || readBack.status !== 'DRAFT') throw Object.assign(new Error('read back'), { code: 'MIC_READBACK_MISMATCH' });
        this.step(plan, 'MIC', 'DONE', `MIC của Candidate ghi với bằng chứng ${mic.mic10Manifest.testEvidence[0]?.reference ?? ''}; đọc lại khớp (hash ${expected.slice(0, 12)}…).`);
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
    return this.composeMicFor(c, plan.runId, plan.reportHash);
  }

  // The ONLY MIC the installer writes: the Candidate snapshot's mic/module.mic.json, MIC-10 replaced by the server's own
  // preflight evidence (never the package's declaration, never a template): reference = run + report hash.
  private composeMicFor(c: CandidateRecord, runId: string, reportHash: string): Mic {
    const mic = JSON.parse(readFileSync(join(this.snapshotDir(c), 'mic', 'module.mic.json'), 'utf8')) as Mic;
    mic.mic10Manifest = { ...mic.mic10Manifest, testEvidence: [{ name: `FMI-02 preflight ${runId} (${this.deps.environment.database})`, result: 'PASS', reference: `fmi02:${runId}:${reportHash}` }] };
    return mic;
  }

  // ----------------------------------------------------------------------------------------------- install: continue
  async getInstall(actor: Actor, installId: unknown): Promise<InstallRecord> {
    await this.authorize(actor, 'MODULE_INSTALL.READ', MODULE_REGISTRY_READ);
    return this.install(installId);
  }

  async continueInstall(actor: Actor, installId: unknown, body: unknown, probe: AccessProbe = {}): Promise<InstallRecord> {
    await this.authorize(actor, 'MODULE_INSTALL.CONTINUE', MODULE_REGISTRY_READ, MODULE_VERSION_ACTIVATE);
    this.body(emptyBody, body);
    const r = this.install(installId);
    const rp = r.recoveryPoint ?? null;
    // Every branch re-reads the journal INSIDE the module lock: a concurrent continue that finished first wins (no replay).
    const unchanged = () => { if (this.install(r.installId).updatedAt !== r.updatedAt) throw new InstallerError(409, 'INSTALL_STATE_CONFLICT'); };
    if (r.state === 'RECOVERY_AWAITING_RESTART' && rp) return this.withModuleLock(r.moduleKey, () => { unchanged(); return this.verifyRecovered(actor, r, rp); });
    if (r.state === 'RECOVERY_REQUIRED' && rp && r.rollback) {
      const reason = r.rollback.reason;
      return this.withModuleLock(r.moduleKey, () => { unchanged(); return this.rollbackUpgrade(actor, r, rp, reason); });
    }
    if (r.state !== 'AWAITING_RESTART' && r.state !== 'RECOVERY_REQUIRED' && r.state !== 'POSTCHECK_INCOMPLETE') throw new InstallerError(409, 'INSTALL_STATE_CONFLICT');
    if (r.after.moduleId === null || r.after.versionId === null) throw new InstallerError(409, 'INSTALL_STATE_CONFLICT');
    // Another ACTIVE version: allowed only as the upgrade's own recovery point, before this install activated anything.
    const current = await this.moduleFacts(r.moduleKey);
    const others = current.versions.filter((v) => v.status === 'ACTIVE' && v.versionId !== r.after.versionId);
    if (others.length > 0) {
      if (!rp) throw new InstallerError(409, 'UPGRADE_RECOVERY_UNAVAILABLE');
      if (others.length !== 1 || others[0]?.versionId !== rp.activeVersionId || (r.activation?.activatedAt ?? null) !== null) throw new InstallerError(409, 'UPGRADE_STATE_MISMATCH');
    }
    if (this.deps.environment.database !== this.deps.allowedDatabase) throw new InstallerError(409, 'INSTALL_STATE_CONFLICT');
    const rt = this.runtimeState();
    const runs = (list: RuntimeRelease[]) => list.some((m) => m.moduleKey === r.moduleKey && m.packageVersion === r.packageVersion && m.packageHash === r.packageHash);
    if (!runs(rt.backend) || !runs(rt.frontend) || !rt.matches) throw new InstallerError(409, 'RESTART_PENDING');
    const moduleId = r.after.moduleId;
    const versionId = r.after.versionId;
    return this.withModuleLock(r.moduleKey, async () => {
      unchanged();
      this.step(r, 'RESTART', 'DONE', `Backend + Frontend chạy ${r.moduleKey} ${r.packageVersion} ${r.packageHash.slice(0, 12)}….`);
      this.save(r, 'CUTTING_OVER', actor.userAccountId, 'runtime release verified');
      const c = this.candidate(r.candidateId);
      const mic = this.composeMic(c, r);
      let current = 'ACTIVATE';
      try {
        const facts = await this.moduleFacts(r.moduleKey);
        const v = facts.versions.find((x) => x.versionId === versionId);
        if (v?.status === 'ACTIVE') {
          // An upgrade's ACTIVE target must be THIS install's journalled activation; otherwise nothing is provable.
          if (rp && (r.activation?.activatedAt ?? null) === null) throw Object.assign(new Error('activation not journalled'), { code: 'ACTIVATION_UNPROVEN' });
          this.step(r, 'ACTIVATE', 'SKIPPED', 'Đã ACTIVE.');
        } else {
          if (rp) {
            r.activation = { versionId, intentAt: this.iso(), activatedAt: null, retiredVersionId: null };
            this.deps.store.writeInstall(r.installId, r);
          }
          const result = await this.deps.lifecycle.activate(actor, moduleId, versionId, {});
          if (rp) {
            r.activation = { versionId, intentAt: r.activation?.intentAt ?? this.iso(), activatedAt: result.version.activatedAt, retiredVersionId: result.retired?.versionId ?? null };
            this.deps.store.writeInstall(r.installId, r);
          }
          this.step(r, 'ACTIVATE', 'DONE', rp ? `ACTIVE (Activation Gate PASS); ${rp.activeVersion} RETIRED bởi lượt này (nhật ký phục hồi đã ghi).` : 'ACTIVE (Activation Gate PASS).');
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
        if (rp) return this.rollbackUpgrade(actor, r, rp, `${current} thất bại (${code})`);
        return this.recover(actor, r, moduleId, `${current} thất bại (${code})`);
      }
      this.save(r, 'POSTCHECK', actor.userAccountId, 'postcheck');
      r.postcheck = await this.postcheck(actor, r, moduleId, versionId, mic, probe);
      const failed = r.postcheck.filter((p) => p.status === 'FAIL');
      const open = r.postcheck.filter((p) => p.status === 'NOT_TESTED');
      const passed = r.postcheck.filter((p) => p.status === 'PASS').length;
      this.step(r, 'POSTCHECK', failed.length > 0 ? 'FAILED' : open.length > 0 ? 'PENDING' : 'DONE', `${passed}/${r.postcheck.length} PASS${open.length > 0 ? `, ${open.length} chưa kiểm được` : ''}.`);
      if (failed.length > 0) {
        const reason = `hậu kiểm FAIL: ${failed.map((f) => f.key).join(', ')}`;
        return rp ? this.rollbackUpgrade(actor, r, rp, reason) : this.recover(actor, r, moduleId, reason);
      }
      r.recovery = [];
      if (open.length > 0) {
        // Installed and served, but access is not proven: an administrator assigns the permissions (IAM policy), then
        // "Tiếp tục" runs the postcheck again with the operator's own session. Never reported as INSTALLED_ACTIVE.
        r.nextActions = [
          ...(open.some((o) => o.key === 'IAM_POLICY') ? ['Chưa gán quyền module: mở IAM › Vai trò và quyền, gán quyền theo chính sách đã duyệt (trình cài đặt không tự gán).'] : []),
          'Hậu kiểm truy cập cần một phiên được cấp quyền module: tài khoản có quyền bấm Tiếp tục để chạy lại hậu kiểm.',
        ];
        this.save(r, 'POSTCHECK_INCOMPLETE', actor.userAccountId, `postcheck incomplete: ${open.map((o) => o.key).join(', ')}`);
        return r;
      }
      r.nextActions = [];
      this.save(r, 'INSTALLED_ACTIVE', actor.userAccountId, 'B02 ACTIVE + runtime + IAM catalog / policy / access + B09 + postcheck PASS');
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

  // ----------------------------------------------------------------------------------------------- REV01-D1 recovery
  // null = a recovery point exists: the lock runs the ACTIVE version and its immutable release (same hash) is stored.
  private recoveryUnavailable(moduleKey: string, activeVersion: string): string | null {
    const entry = this.lock().get(moduleKey);
    if (!entry) return 'lock triển khai không có module này (không biết release đang chạy).';
    if (entry.packageVersion !== activeVersion) return `lock chạy ${entry.packageVersion}, B02 ACTIVE là ${activeVersion}.`;
    const dir = releaseDir(this.deps.paths.releasesDir, moduleKey, entry.packageVersion);
    if (!existsSync(dir)) return `kho release không có ${moduleKey} ${entry.packageVersion}.`;
    if (hashPackage(dir, walkPackage(dir)).hash !== entry.packageHash) return `release ${entry.packageVersion} trong kho khác hash lock.`;
    return null;
  }

  private async recoveryPointOf(actor: Actor, moduleKey: string, moduleId: string, enabled: boolean, active: { versionId: string; moduleVersion: string }): Promise<RecoveryPoint> {
    const why = this.recoveryUnavailable(moduleKey, active.moduleVersion);
    const entry = this.lock().get(moduleKey);
    const stored = await this.storedMic(active.versionId);
    if (why !== null || !entry || stored.hash === null || stored.status !== 'ACTIVE') throw new InstallerError(409, 'PLAN_BLOCKED', { blockers: ['UPGRADE_RECOVERY_UNAVAILABLE'] });
    const iam = this.deps.iam ? (await this.deps.iam.existing(moduleKey)).map((p) => p.permissionCode).sort() : [];
    const layout = await this.deps.navigation.layout(actor);
    return { at: this.iso(), moduleId, activeVersionId: active.versionId, activeVersion: active.moduleVersion, activeManifestHash: stored.hash, enabled,
      lock: { packageVersion: entry.packageVersion, packageHash: entry.packageHash }, iamPermissions: iam, navigationRevision: layout.revision };
  }

  // Idempotent, step-tracked rollback of ONE upgrade. Order: B02 (security first) → B01 flag → B09 → lock. Each step
  // re-reads the state; a mismatch with the journal / recovery point stops as UNPROVEN (manual), never guessed.
  private async rollbackUpgrade(actor: Actor, r: InstallRecord, rp: RecoveryPoint, reason: string): Promise<InstallRecord> {
    const rb = r.rollback ?? { reason, b02: 'PENDING', b01: 'PENDING', navigation: 'PENDING', lock: 'PENDING' };
    r.rollback = rb;
    const notes = [`Nguyên nhân: ${reason}.`];
    const stop = (status: InstallState, why: string): InstallRecord => {
      r.recovery = [...notes, why];
      this.save(r, status, actor.userAccountId, `upgrade rollback: ${why}`);
      this.deps.logger.warn('module upgrade rollback stopped', { requestId: actor.requestId, installId: r.installId, b02: rb.b02, b01: rb.b01, navigation: rb.navigation, lock: rb.lock });
      return r;
    };
    let current = 'B02';
    try {
      if (rb.b02 === 'PENDING' || rb.b02 === 'UNPROVEN') {
        const facts = await this.moduleFacts(r.moduleKey);
        const target = facts.versions.find((v) => v.versionId === r.after.versionId);
        const restore = facts.versions.find((v) => v.versionId === rp.activeVersionId);
        const actives = facts.versions.filter((v) => v.status === 'ACTIVE');
        const restoreMic = await this.storedMic(rp.activeVersionId);
        if (restoreMic.hash !== rp.activeManifestHash) {
          rb.b02 = 'UNPROVEN';
          return stop('RECOVERY_REQUIRED', `MIC của ${rp.activeVersion} đã khác điểm phục hồi: không phục hồi (cần chủ dự án xử lý).`);
        }
        if (target?.status === 'ACTIVE' && actives.length === 1) {
          const a = r.activation;
          if (!a || a.activatedAt === null || a.versionId !== r.after.versionId || a.retiredVersionId !== rp.activeVersionId || restore?.status !== 'RETIRED') {
            rb.b02 = 'UNPROVEN';
            return stop('RECOVERY_REQUIRED', `${r.packageVersion} đang ACTIVE nhưng nhật ký kích hoạt không chứng minh lượt này đã RETIRE ${rp.activeVersion}: không phục hồi tự động.`);
          }
          await this.deps.lifecycle.recoverUpgrade(actor, { moduleId: rp.moduleId, failedVersionId: a.versionId, restoreVersionId: rp.activeVersionId, failedActivatedAt: a.activatedAt, installId: r.installId });
          rb.b02 = 'DONE';
          notes.push(`B02: ${r.packageVersion} RETIRED, ${rp.activeVersion} ACTIVE lại (Lifecycle ROLLBACK, B07 + B08).`);
        } else if (restore?.status === 'ACTIVE' && actives.length === 1) {
          rb.b02 = 'NOT_NEEDED';
          notes.push(`B02: ${rp.activeVersion} vẫn ACTIVE (lượt này chưa kích hoạt bản mới).`);
        } else {
          rb.b02 = 'UNPROVEN';
          return stop('RECOVERY_REQUIRED', `B02 không ở trạng thái của lượt cài đặt (${actives.length} ACTIVE): không phục hồi tự động.`);
        }
        this.deps.store.writeInstall(r.installId, r);
      }
      current = 'B01';
      if (rb.b01 === 'PENDING') {
        const facts = await this.moduleFacts(r.moduleKey);
        if (facts.enabled === true && !rp.enabled) {
          await this.deps.lifecycle.disable(actor, rp.moduleId, {});
          rb.b01 = 'DONE';
          notes.push('B01: module TẮT lại như trước khi cài.');
        } else rb.b01 = 'NOT_NEEDED';
        this.deps.store.writeInstall(r.installId, r);
      }
      current = 'NAVIGATION';
      if (rb.navigation === 'PENDING') {
        const added = new Set(r.navigationAdded ?? []);
        const layout = await this.deps.navigation.layout(actor);
        let hidden = 0;
        const draft: Draft = {
          revision: layout.revision,
          areas: layout.areas.map((a) => ({ id: a.id, title: a.title, visible: a.visible, develop: a.develop,
            menus: a.menus.map((m) => ({ id: m.id, title: m.title, visible: m.visible, items: m.items.map((l) => {
              const hide = l.visible && added.has(l.functionId);
              if (hide) hidden += 1;
              return { id: l.id, functionId: l.functionId, title: l.title, visible: hide ? false : l.visible };
            }) })) })),
          legacy: layout.legacy.map((l) => ({ id: l.id, visible: l.visible })),
        };
        if (hidden > 0) await this.deps.navigation.apply(actor, draft);
        rb.navigation = hidden > 0 ? 'DONE' : 'NOT_NEEDED';
        if (hidden > 0) notes.push(`B09: ẩn ${hidden} liên kết do lượt này thêm (Navigation Builder, không xóa).`);
        this.deps.store.writeInstall(r.installId, r);
      }
      current = 'LOCK';
      if (rb.lock === 'PENDING') {
        const dir = releaseDir(this.deps.paths.releasesDir, r.moduleKey, rp.lock.packageVersion);
        if (!existsSync(dir) || hashPackage(dir, walkPackage(dir)).hash !== rp.lock.packageHash) {
          rb.lock = 'UNPROVEN';
          return stop('RECOVERY_REQUIRED', `Release ${rp.lock.packageVersion} trong kho không còn khớp hash điểm phục hồi: không ghi lock.`);
        }
        const entries = [...this.lock().entries()].map(([moduleKey, v]) => ({ moduleKey, ...v }));
        writeDeployments(this.deps.paths.lockFile, [...entries.filter((e) => e.moduleKey !== r.moduleKey), { moduleKey: r.moduleKey, ...rp.lock }]);
        rb.lock = 'DONE';
        notes.push(`Lock: ${r.moduleKey} ${rp.lock.packageVersion} ${rp.lock.packageHash.slice(0, 12)}… (release cũ, hash xác minh).`);
      }
    } catch (error) {
      return stop('RECOVERY_REQUIRED', `Phục hồi dừng ở bước ${current} (${errorCode(error)}); bấm Tiếp tục để thử lại các bước còn lại.`);
    }
    if (rb.lock !== 'DONE') return stop('RECOVERY_REQUIRED', 'Lock chưa được phục hồi.');
    const iamNew = this.deps.iam ? (await this.deps.iam.existing(r.moduleKey).catch(() => [])).map((p) => p.permissionCode).filter((p) => !rp.iamPermissions.includes(p)) : [];
    if (iamNew.length > 0) notes.push(`IAM: ${iamNew.length} quyền danh mục tạo bởi lượt này được giữ (không DELETE, chưa gán cho ai): ${iamNew.join(', ')}.`);
    notes.push(`DEPLOY_RESTART_REQUIRED: khởi động lại Backend + Frontend để chạy lại ${rp.lock.packageVersion}, rồi bấm Tiếp tục để xác minh (chưa phải RECOVERED).`);
    r.recovery = notes;
    r.nextActions = ['Khởi động lại Backend + Frontend (release cũ), rồi bấm Tiếp tục để xác minh phục hồi.'];
    this.save(r, 'RECOVERY_AWAITING_RESTART', actor.userAccountId, `upgrade rolled back (${reason}); restart required`);
    this.deps.logger.warn('module upgrade rolled back', { requestId: actor.requestId, installId: r.installId, reason });
    return r;
  }

  // RECOVERED only with proof: the running Backend + Frontend + lock are the old release, B02 has exactly the old version
  // ACTIVE (MIC hash unchanged), B01 flag as before, no link of this install visible, the old router answers its API.
  private async verifyRecovered(actor: Actor, r: InstallRecord, rp: RecoveryPoint): Promise<InstallRecord> {
    const rt = this.runtimeState();
    const runsOld = (list: RuntimeRelease[]) => list.some((m) => m.moduleKey === r.moduleKey && m.packageVersion === rp.lock.packageVersion && m.packageHash === rp.lock.packageHash);
    if (!runsOld(rt.backend) || !runsOld(rt.frontend) || !rt.matches) throw new InstallerError(409, 'RESTART_PENDING');
    const out: InstallRecord['postcheck'] = [];
    out.push({ key: 'RECOVERY_RUNTIME', status: 'PASS', detail: `Backend + Frontend + lock chạy ${rp.lock.packageVersion} ${rp.lock.packageHash.slice(0, 12)}….` });
    const facts = await this.moduleFacts(r.moduleKey);
    const actives = facts.versions.filter((v) => v.status === 'ACTIVE');
    const restore = await this.storedMic(rp.activeVersionId);
    out.push({ key: 'RECOVERY_B02', status: actives.length === 1 && actives[0]?.versionId === rp.activeVersionId && restore.hash === rp.activeManifestHash ? 'PASS' : 'FAIL',
      detail: `ACTIVE: ${actives.map((v) => v.moduleVersion).join(', ') || '(không)'} · ${r.packageVersion} ${facts.versions.find((v) => v.versionId === r.after.versionId)?.status ?? '—'} · MIC ${restore.hash === rp.activeManifestHash ? 'khớp' : 'lệch'} điểm phục hồi.` });
    out.push({ key: 'RECOVERY_B01', status: facts.enabled === rp.enabled ? 'PASS' : 'FAIL', detail: `Module ${facts.enabled ? 'bật' : 'tắt'} (trước khi cài: ${rp.enabled ? 'bật' : 'tắt'}).` });
    const layout = await this.deps.navigation.layout(actor);
    const added = new Set(r.navigationAdded ?? []);
    const visible = layout.areas.flatMap((a) => a.menus.flatMap((m) => m.items.filter((l) => l.visible && added.has(l.functionId)))).length;
    out.push({ key: 'RECOVERY_NAVIGATION', status: visible === 0 ? 'PASS' : 'FAIL', detail: `${visible} liên kết của lượt này còn hiển thị.` });
    const oldMic = restore.manifest as Mic | null;
    out.push(oldMic === null ? { key: 'API_SMOKE', status: 'FAIL', detail: 'Không đọc được MIC phiên bản phục hồi.' }
      : oldMic.mic05Api.length === 0 ? { key: 'API_SMOKE', status: 'PASS', detail: 'MIC phục hồi không khai báo API.' } : await this.apiSmoke(r.moduleKey, oldMic));
    r.postcheck = out;
    r.after.versionStatus = facts.versions.find((v) => v.versionId === r.after.versionId)?.status ?? null;
    r.after.enabled = facts.enabled;
    const failed = out.filter((p) => p.status !== 'PASS');
    if (failed.length > 0) {
      if (r.rollback) r.rollback = { ...r.rollback, b02: actives[0]?.versionId === rp.activeVersionId ? r.rollback.b02 : 'PENDING' };
      r.recovery = [...r.recovery, `Xác minh phục hồi FAIL: ${failed.map((f) => f.key).join(', ')} — chưa RECOVERED.`];
      this.save(r, 'RECOVERY_REQUIRED', actor.userAccountId, `recovery verification failed: ${failed.map((f) => f.key).join(', ')}`);
      return r;
    }
    r.nextActions = [];
    this.save(r, 'RECOVERED', actor.userAccountId, `${rp.activeVersion} restored and verified (runtime, B02, B01, B09, API)`);
    this.deps.logger.info('module upgrade recovered', { requestId: actor.requestId, installId: r.installId, moduleKey: r.moduleKey, restored: rp.activeVersion });
    return r;
  }

  // B09 through the Navigation Builder contract (REV-01 A14): the stored layout → a draft keeping every row as it is →
  // for each MIC-04 function with a route that has no VISIBLE link in a visible MENU of a visible AREA: re-show a hidden
  // link of that menu, else add one (AREA = module name, MENU = MIC-04 group label; a Developer Function goes to the
  // Develop area) → ONE apply (validateDraft / planDraft, revision check, one transaction, one B08 row). Nothing is
  // hidden, moved or deleted; a rerun with every function linked writes nothing.
  private async navigation(actor: Actor, moduleId: string, r: InstallRecord, mic: Mic): Promise<string> {
    const layout = await this.deps.navigation.layout(actor);
    const functions = (await this.deps.db.query(`SELECT function_id::text AS function_id, function_key FROM foundation.fnd_functions WHERE module_id = $1::uuid`, [moduleId])) as { function_id: string; function_key: string }[];
    const plan = r.navigationPlan ?? navigationPlanOf(r.moduleKey, mic);
    const draft: Draft = {
      revision: layout.revision,
      areas: layout.areas.map((a) => ({ id: a.id, title: a.title, visible: a.visible, develop: a.develop,
        menus: a.menus.map((m) => ({ id: m.id, title: m.title, visible: m.visible, items: m.items.map((l) => ({ id: l.id, functionId: l.functionId, title: l.title, visible: l.visible })) })) })),
      legacy: layout.legacy.map((l) => ({ id: l.id, visible: l.visible })),
    };
    const linked = (functionId: string) => draft.areas.some((a) => a.visible && a.menus.some((m) => m.visible && m.items.some((l) => l.visible && l.functionId === functionId)));
    const placed: string[] = [];
    const added: string[] = [];
    for (const link of plan.links) {
      const fn = functions.find((f) => f.function_key === link.functionKey);
      if (!fn) throw Object.assign(new Error('function missing'), { code: 'NAVIGATION_FUNCTION_MISSING' });
      if (linked(fn.function_id)) continue;
      let area = link.developer ? draft.areas.find((a) => a.develop) : draft.areas.find((a) => !a.develop && a.visible && norm(a.title) === norm(plan.area));
      if (!area) {
        if (link.developer) throw Object.assign(new Error('develop missing'), { code: 'NAVIGATION_DEVELOP_MISSING' });
        area = { id: null, title: plan.area, visible: true, develop: false, menus: [] };
        draft.areas.push(area);
      }
      const menuTitle = link.developer ? plan.area : plan.menu;
      let menu = area.menus.find((m) => m.visible && norm(m.title) === norm(menuTitle));
      if (!menu) {
        menu = { id: null, title: menuTitle, visible: true, items: [] };
        area.menus.push(menu);
      }
      const hidden = menu.items.find((l) => l.functionId === fn.function_id && !l.visible);
      if (hidden) hidden.visible = true;
      else menu.items.push({ id: null, functionId: fn.function_id, title: link.title.slice(0, 150), visible: true });
      added.push(fn.function_id);
      placed.push(`${area.title} › ${menu.title} › ${link.title}${hidden ? ' (hiện lại)' : ''}`);
    }
    if (placed.length === 0) return 'Menu đã có đủ liên kết hiển thị (không ghi gì).';
    await this.deps.navigation.apply(actor, draft);
    r.navigationAdded = [...new Set([...(r.navigationAdded ?? []), ...added])];
    this.deps.store.writeInstall(r.installId, r);
    return `${placed.length} liên kết qua Navigation Builder (một lần lưu): ${placed.join('; ')}.`;
  }

  private async postcheck(actor: Actor, r: InstallRecord, moduleId: string, versionId: string, mic: Mic, probe: AccessProbe): Promise<InstallRecord['postcheck']> {
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
    out.push({ key: 'IAM_CATALOG', status: bad.length === 0 && this.deps.iam !== null ? 'PASS' : 'FAIL', detail: `CATALOG_READY: ${mic.mic07IamMapping.length - bad.length}/${mic.mic07IamMapping.length} quyền K05 có đúng một bản ghi.` });
    const assigned = this.deps.iam ? await this.deps.iam.assignments(r.moduleKey).catch(() => -1) : -1;
    out.push(assigned > 0 ? { key: 'IAM_POLICY', status: 'PASS', detail: `POLICY_READY: ${assigned} phân quyền (vai trò / trực tiếp) cho quyền của module.` }
      : { key: 'IAM_POLICY', status: 'NOT_TESTED', detail: assigned === 0 ? 'Chưa gán quyền module cho vai trò / tài khoản nào (trình cài đặt không tự gán).' : 'Không đọc được phân quyền IAM.' });
    const layout = await this.deps.navigation.layout(actor);
    const functions = (await this.deps.db.query(`SELECT function_id::text AS function_id, function_key FROM foundation.fnd_functions WHERE module_id = $1::uuid`, [moduleId])) as { function_id: string; function_key: string }[];
    const shown = new Set(layout.areas.filter((a) => a.visible).flatMap((a) => a.menus.filter((m) => m.visible).flatMap((m) => m.items.filter((l) => l.visible).map((l) => l.functionId))));
    const routable = mic.mic04Navigation.filter((n) => n.functionKey !== undefined && (n.routePath ?? '').trim() !== '');
    const missingLinks = routable.filter((n) => !shown.has(functions.find((f) => f.function_key === n.functionKey)?.function_id ?? ''));
    const legacy = layout.legacy.filter((l) => l.moduleId === moduleId && l.visible).length;
    out.push({ key: 'NAVIGATION', status: missingLinks.length === 0 && legacy === 0 ? 'PASS' : 'FAIL',
      detail: `${routable.length - missingLinks.length}/${routable.length} chức năng có liên kết hiển thị AREA → MENU → FUNCTION; ${legacy} mục legacy hiển thị của module.` });
    out.push(await this.apiSmoke(r.moduleKey, mic));
    out.push(await this.accessCheck(r.moduleKey, mic, probe));
    return out;
  }

  // ACCESS_VERIFIED: the operator's OWN session (the cookie of the "Tiếp tục" request, forwarded in-process, never stored
  // or logged) on every MIC-05 GET without a path parameter of the REAL module router: 200 + JSON object without an error
  // envelope = allowed and served. 403 = this principal has no module permission → NOT_TESTED (not a success). Anything
  // else (5xx, non-JSON, 200 with an error) → FAIL. POST / parameterised routes are not called (side effects / data).
  private async accessCheck(moduleKey: string, mic: Mic, probe: AccessProbe): Promise<InstallRecord['postcheck'][number]> {
    const router = this.deps.runtime.routers.get(moduleKey);
    const gets = mic.mic05Api.filter((a) => a.method.toUpperCase() === 'GET' && !/\{[A-Za-z0-9_]+\}/.test(a.path));
    if (!router || probe.cookie === undefined || probe.cookie === '') return { key: 'ACCESS_VERIFIED', status: 'NOT_TESTED', detail: 'Không có phiên của người thao tác để kiểm tra truy cập thật.' };
    if (gets.length === 0) return { key: 'ACCESS_VERIFIED', status: 'NOT_TESTED', detail: 'MIC-05 không có API GET không tham số để kiểm tra an toàn.' };
    const app = express();
    app.use('/api', express.json({ limit: '10kb' }), router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const results: string[] = [];
    let ok = 0;
    let denied = 0;
    try {
      for (const a of gets) {
        const res = await fetch(`${base}${a.path}`, { headers: { Accept: 'application/json', Cookie: probe.cookie, ...(probe.userAgent ? { 'User-Agent': probe.userAgent } : {}) } });
        const json = (await res.json().catch(() => undefined)) as unknown;
        const object = typeof json === 'object' && json !== null && !Array.isArray(json);
        if (res.status === 200 && object && !('error' in json)) ok += 1;
        else if (res.status === 403) denied += 1;
        results.push(`GET ${a.path} → ${res.status}${res.status === 200 && !object ? ' (không phải JSON object)' : ''}`);
      }
    } finally {
      server.closeAllConnections();
      server.close();
    }
    if (ok === gets.length) return { key: 'ACCESS_VERIFIED', status: 'PASS', detail: `${ok}/${gets.length} API GET trả 200 JSON với phiên được cấp quyền (chưa kiểm schema chi tiết từng trường). 401 không phiên: xem API_SMOKE.` };
    if (ok + denied === gets.length) return { key: 'ACCESS_VERIFIED', status: 'NOT_TESTED', detail: `Phiên đang thao tác bị từ chối 403 (${denied}/${gets.length}): chưa có principal được cấp quyền để chứng minh truy cập.` };
    return { key: 'ACCESS_VERIFIED', status: 'FAIL', detail: results.join('; ') };
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
      '', 'Khác biệt MIC (DRAFT → Candidate):', ...(r.micDiff.length === 0 ? ['- (không có)'] : r.micDiff.map((d) => `- ${d.section}: ${d.draft ?? '—'} → ${d.candidate}${d.changed ? ' (thay đổi)' : ''}`)),
      '', `Vị trí menu B09: ${r.navigationPlan ? `${r.navigationPlan.area} › ${r.navigationPlan.menu} — ${r.navigationPlan.links.map((l) => `${l.title}${l.developer ? ' (Develop)' : ''}`).join(', ')}` : '(không có)'}`,
      '', 'Hậu kiểm:', ...(r.postcheck.length === 0 ? ['- (chưa chạy)'] : r.postcheck.map((p) => `- [${p.status}] ${p.key}: ${p.detail}`)),
      '', 'Việc cần làm tiếp:', ...(r.nextActions.length === 0 ? ['- (không)'] : r.nextActions.map((x) => `- ${x}`)),
      ...(r.recoveryPoint ? ['', `Điểm phục hồi: ${r.recoveryPoint.activeVersion} (${r.recoveryPoint.activeVersionId}) MIC ${r.recoveryPoint.activeManifestHash} · lock ${r.recoveryPoint.lock.packageVersion} ${r.recoveryPoint.lock.packageHash} · B09 revision ${r.recoveryPoint.navigationRevision} · ${r.recoveryPoint.iamPermissions.length} quyền IAM · ${r.recoveryPoint.enabled ? 'bật' : 'tắt'}`,
        `Nhật ký kích hoạt: ${r.activation ? `${r.activation.versionId} intent ${r.activation.intentAt} · activated_at ${r.activation.activatedAt ?? '(chưa)'} · retired ${r.activation.retiredVersionId ?? '—'}` : '(không)'}`,
        `Rollback: ${r.rollback ? `B02 ${r.rollback.b02} · B01 ${r.rollback.b01} · B09 ${r.rollback.navigation} · lock ${r.rollback.lock}` : '(không)'}`] : []),
      '', 'Phục hồi:', ...(r.recovery.length === 0 ? ['- (không cần)'] : r.recovery.map((x) => `- ${x}`)),
      '', 'Lịch sử:', ...r.history.map((h) => `- ${h.at} ${h.state} — ${h.note}`),
      '', 'Không chứa cookie, chuỗi kết nối, mật khẩu hoặc token. INSTALLED_ACTIVE chỉ khi B02 ACTIVE + runtime + IAM + B09 + hậu kiểm đều PASS.'];
    return { name: `install-${r.moduleKey}-${r.packageVersion}-${r.installId.slice(0, 8)}.txt`, content: `${l.join('\n')}\n` };
  }
}

// MIC sections: stored DRAFT (null = no DRAFT / no manifest) vs the Candidate MIC (canonical digests compared).
export function micDiff(draft: unknown, candidate: Mic, hasDraft: boolean): MicDiffRow[] {
  const d = typeof draft === 'object' && draft !== null ? (draft as Record<string, unknown>) : null;
  const count = (v: unknown) => (Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : 1);
  const digest = (v: unknown) => (v === undefined ? '' : canonicalDigest(v).sha256);
  return MIC_SECTIONS.map((section) => ({
    section, draft: hasDraft ? (d === null ? 0 : count(d[section])) : null, candidate: count(candidate[section]),
    changed: d === null || digest(d[section]) !== digest(candidate[section]),
  }));
}

// B09 placement proposed by the plan: AREA = MIC-01 module name, MENU = the MIC-04 group label (entry without function)
// or the module name; one link per MIC-04 function with a route; Developer Functions (DEVELOPER_FUNCTIONS) → Develop.
export function navigationPlanOf(moduleKey: string, mic: Mic): NavigationPlan {
  const area = mic.mic01Identity.moduleName.trim().slice(0, 150);
  const group = mic.mic04Navigation.find((n) => n.functionKey === undefined)?.menuLabel.trim();
  return {
    area, menu: (group && group !== '' ? group : area).slice(0, 150),
    links: mic.mic04Navigation.filter((n) => n.functionKey !== undefined && (n.routePath ?? '').trim() !== '')
      .map((n) => ({ functionKey: n.functionKey ?? '', title: n.menuLabel, developer: isDeveloperFunction(moduleKey, n.functionKey ?? '') })),
  };
}
