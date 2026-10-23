import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Logger } from '../../core/logging/logger.js';
import { AccessGuard } from './foundation.access.js';
import type { Actor } from './foundation.access.js';
import { FoundationError } from './foundation.errors.js';
import { listPackageFolders, readPackage, ScanLimitError, ScanRootUnavailableError } from './foundation.module-scan.files.js';
import type { PackageFacts } from './foundation.module-scan.files.js';
import { evaluatePackage, manifestRoutes } from './foundation.module-scan.validation.js';
import type { ModuleScanRegistry, RegisteredVersion, RegistryFacts, ScanReport, VersionStatus } from './foundation.module-scan.types.js';
import { MODULE_REGISTRY_CREATE, MODULE_REGISTRY_READ } from './foundation.permissions.js';
import type { FoundationDb, FoundationRepository } from './foundation.repository.js';

// FMI-01 — Manual Module Scan. Triggered ONLY by POST /api/foundation/module-packages/scan (the "Quét Module" button):
// nothing scans at start-up, login, page load or on a timer. Requires BOTH foundation.module_registry.read and .create
// (AccessGuard: IAM evaluator, assurance, B08 DENIED audit on refusal — the only write of a refused request). An authorised
// scan reads the trusted modules root (server configuration) and SELECTs B01 / B02; it writes nothing (no B08 SUCCESS:
// Foundation defines no audit action for a read-only preview). One scan at a time per process; results are kept in RAM
// (10 snapshots, 10 minutes) and read back by GET …/scans/:scanId without scanning again.

export const SCAN_ACTION = 'MODULE_PACKAGE.SCAN';
export const SCAN_READ_ACTION = 'MODULE_PACKAGE.SCAN_READ';
const DENIED_TARGET = 'MODULE_PACKAGE';
export const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
export const MAX_SNAPSHOTS = 10;

// Trusted default: <repo>/modules, from this file's own location (src/… and dist/… have the same depth).
export const DEFAULT_MODULES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../modules');

export const MODULE_SCAN_MESSAGES = {
  SCAN_IN_PROGRESS: 'Đang có lượt quét khác. Vui lòng chờ lượt đó hoàn tất rồi bấm Quét Module lại.',
  SCAN_NOT_FOUND: 'Không tìm thấy kết quả quét (đã hết hạn 10 phút hoặc không tồn tại). Bấm Quét Module để quét lại.',
  SCAN_LIMIT_EXCEEDED: 'Thư mục modules có quá nhiều package (tối đa 250).',
  SCAN_ROOT_UNAVAILABLE: 'Không đọc được thư mục modules của hệ thống.',
  SCAN_INTERNAL_ERROR: 'Lỗi không xác định khi quét module.',
} as const;
export type ModuleScanErrorCode = keyof typeof MODULE_SCAN_MESSAGES;

export class ModuleScanError extends Error {
  constructor(readonly status: number, readonly code: ModuleScanErrorCode) {
    super(MODULE_SCAN_MESSAGES[code]);
    this.name = 'ModuleScanError';
  }
}

// ------------------------------------------------------------------------------------------------- Registry (SELECT)
export const MODULE_SCAN_SQL = {
  registry: `
    SELECT m.module_key, m.is_enabled, v.module_version, v.status,
           CASE WHEN v.status = 'ACTIVE' THEN v.manifest_json -> 'mic04Navigation' END AS navigation
      FROM foundation.fnd_modules AS m
      LEFT JOIN foundation.fnd_module_versions AS v ON v.module_id = m.module_id
     ORDER BY m.module_key, v.module_version`,
} as const;

const STATUSES: readonly VersionStatus[] = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'];
const registryRow = z.object({ module_key: z.string(), is_enabled: z.boolean(), module_version: z.string().nullable(), status: z.string().nullable(), navigation: z.unknown() });

function routesOf(navigation: unknown): string[] | null {
  if (navigation === null || navigation === undefined) return null;
  if (!Array.isArray(navigation)) return null;
  return navigation.flatMap((n: unknown) => (typeof n === 'object' && n !== null && 'routePath' in n && typeof n.routePath === 'string' ? [n.routePath] : []));
}

export class SqlModuleScanRegistry implements ModuleScanRegistry {
  constructor(private readonly db: Pick<FoundationDb, 'query'>) {}

  async read(): Promise<RegistryFacts> {
    const rows = (await this.db.query(MODULE_SCAN_SQL.registry, [])).map((r) => registryRow.parse(r));
    const moduleKeys = new Set(rows.map((r) => r.module_key));
    const versions: RegisteredVersion[] = [];
    for (const r of rows) {
      if (r.module_version === null || r.status === null) continue;
      const status = STATUSES.find((s) => s === r.status);
      if (status === undefined) throw new Error('unknown version status');
      versions.push({ moduleKey: r.module_key, moduleVersion: r.module_version, status, activeRoutes: status === 'ACTIVE' ? routesOf(r.navigation) : null, moduleEnabled: r.is_enabled });
    }
    return { moduleKeys, versions };
  }
}

// ------------------------------------------------------------------------------------------------- service
export interface ModuleScanServiceDeps {
  readonly access: Pick<FoundationRepository, 'loadAccessFacts' | 'insertAudit'>;
  readonly registry: ModuleScanRegistry;
  readonly logger: Logger;
  readonly modulesRoot?: string;
  readonly now?: () => number;
  // Test seam: the package reader (e.g. to simulate a change during the scan).
  readonly readPackage?: (root: string, folder: string, unsafe: boolean) => PackageFacts;
}

const emptyBody = z.strictObject({});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class ModuleScanService {
  private readonly guard: AccessGuard;
  private readonly registry: ModuleScanRegistry;
  private readonly logger: Logger;
  private readonly root: string;
  private readonly now: () => number;
  private readonly read: (root: string, folder: string, unsafe: boolean) => PackageFacts;
  private readonly snapshots = new Map<string, { readonly expires: number; readonly report: ScanReport }>();
  private running = false;

  constructor(deps: ModuleScanServiceDeps) {
    this.guard = new AccessGuard({ repository: deps.access, logger: deps.logger });
    this.registry = deps.registry;
    this.logger = deps.logger;
    this.root = deps.modulesRoot ?? DEFAULT_MODULES_ROOT;
    this.now = deps.now ?? Date.now;
    this.read = deps.readPackage ?? readPackage;
  }

  private async authorize(actor: Actor, actionCode: string): Promise<void> {
    await this.guard.authorize(actor, MODULE_REGISTRY_READ, actionCode, DENIED_TARGET);
    await this.guard.authorize(actor, MODULE_REGISTRY_CREATE, actionCode, DENIED_TARGET);
  }

  async scan(actor: Actor, body: unknown): Promise<ScanReport> {
    await this.authorize(actor, SCAN_ACTION);
    if (!emptyBody.safeParse(body ?? null).success) throw new FoundationError(400, 'VALIDATION_ERROR', { details: { fields: ['body'] } });
    if (this.running) throw new ModuleScanError(409, 'SCAN_IN_PROGRESS');
    this.running = true;
    const started = this.now();
    try {
      const report = await this.run(actor, started);
      this.store(report);
      this.logger.info('module package scan completed', {
        requestId: actor.requestId, scanId: report.scanId, total: report.summary.total, passed: report.summary.passed, warnings: report.summary.warnings,
        failed: report.summary.failed, unavailable: report.summary.unavailable, registryAvailable: report.registryAvailable, durationMs: report.durationMs,
      });
      return report;
    } catch (error) {
      if (error instanceof ScanRootUnavailableError) throw new ModuleScanError(503, 'SCAN_ROOT_UNAVAILABLE');
      if (error instanceof ScanLimitError) throw new ModuleScanError(413, 'SCAN_LIMIT_EXCEEDED');
      this.guard.logFailure('module package scan failed', actor, error);
      throw new ModuleScanError(500, 'SCAN_INTERNAL_ERROR');
    } finally {
      this.running = false;
    }
  }

  async snapshot(actor: Actor, scanId: unknown): Promise<ScanReport> {
    await this.authorize(actor, SCAN_READ_ACTION);
    if (typeof scanId !== 'string' || !UUID.test(scanId)) throw new FoundationError(400, 'VALIDATION_ERROR', { details: { fields: ['scanId'] } });
    this.prune();
    const found = this.snapshots.get(scanId);
    if (!found) throw new ModuleScanError(404, 'SCAN_NOT_FOUND');
    return found.report;
  }

  // FMI-02: the stored snapshot for the installer service, which authorises its own request first (never scans).
  stored(scanId: string): ScanReport | null {
    this.prune();
    return this.snapshots.get(scanId)?.report ?? null;
  }

  private async run(actor: Actor, started: number): Promise<ScanReport> {
    const folders = listPackageFolders(this.root);
    let registry: RegistryFacts | null;
    try {
      registry = await this.registry.read();
    } catch (error) {
      this.guard.logFailure('module scan: registry unavailable (REGISTRY_UNKNOWN)', actor, error);
      registry = null;
    }
    const facts = folders.map(({ name, unsafe }) => {
      try {
        return this.read(this.root, name, unsafe);
      } catch {
        return this.read(this.root, name, true); // unreadable folder: reported as unsafe, never read
      }
    });
    const folderRoutes = new Map<string, Set<string>>();
    for (const f of facts) {
      if (f.manifest.state !== 'OK' || f.manifestProblems.length > 0) continue;
      const value = f.manifest.value;
      const key = typeof value === 'object' && value !== null && 'moduleKey' in value && typeof value.moduleKey === 'string' ? value.moduleKey : f.folder;
      for (const r of manifestRoutes(value)) folderRoutes.set(r, new Set([...(folderRoutes.get(r) ?? []), key]));
    }
    const modules = facts.map((f) => evaluatePackage(f, { registry, folderRoutes }));
    const count = (s: string) => modules.filter((x) => x.scanStatus === s).length;
    return {
      scanId: randomUUID(), status: 'COMPLETED', scannedAt: new Date(started).toISOString(), durationMs: Math.max(0, this.now() - started),
      registryAvailable: registry !== null,
      summary: { total: modules.length, passed: count('PASS'), warnings: count('WARN'), failed: count('FAIL'), unavailable: count('UNAVAILABLE') },
      modules,
    };
  }

  private prune(): void {
    const now = this.now();
    for (const [id, s] of this.snapshots) if (s.expires <= now) this.snapshots.delete(id);
  }

  private store(report: ScanReport): void {
    this.prune();
    this.snapshots.set(report.scanId, { expires: this.now() + SNAPSHOT_TTL_MS, report });
    while (this.snapshots.size > MAX_SNAPSHOTS) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.snapshots.delete(oldest);
    }
  }
}
