// FMI-01 — Manual Module Scan: response contract v1 (documents/development/FMI-01-Manual-Module-Scan/03_API_CONTRACT.md).

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNAVAILABLE';
export type ScanStatus = CheckStatus;
export type IssueSeverity = 'WARNING' | 'ERROR' | 'UNAVAILABLE';
export type Classification = 'NEW_MODULE' | 'UPGRADE_CANDIDATE' | 'EXISTING_VERSION' | 'OLDER_PACKAGE' | 'INVALID_PACKAGE' | 'REGISTRY_UNKNOWN';
export type MicFormat = 'JSON' | 'LEGACY_TS' | 'MISSING' | 'INVALID';
export type VersionStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ACTIVE' | 'RETIRED' | 'REJECTED';

export const CHECK_IDS = [
  'MS-01', 'MS-02', 'MS-03', 'MS-04', 'MS-05', 'MS-06', 'MS-07', 'MS-08', 'MS-09', 'MS-10',
  'MS-11', 'MS-12', 'MS-13', 'MS-14', 'MS-15', 'MS-16', 'MS-17', 'MS-18', 'MS-19', 'MS-20',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const CHECK_LABELS: Readonly<Record<CheckId, string>> = {
  'MS-01': 'Thư mục package', 'MS-02': 'An toàn đường dẫn', 'MS-03': 'Tệp module.json', 'MS-04': 'Định dạng package', 'MS-05': 'Mã module (K01)',
  'MS-06': 'Phiên bản (SemVer)', 'MS-07': 'Giao thức Host', 'MS-08': 'Capability', 'MS-09': 'Backend entry', 'MS-10': 'Frontend entry',
  'MS-11': 'Màn hình frontend', 'MS-12': 'Tệp MIC JSON', 'MS-13': 'Schema MIC', 'MS-14': 'Định danh MIC', 'MS-15': 'Liên kết MIC (Function/Action/API/IAM)',
  'MS-16': 'Xung đột route', 'MS-17': 'Đối chiếu Registry', 'MS-18': 'Tương thích MIC-09', 'MS-19': 'Bằng chứng MIC-10', 'MS-20': 'Toàn vẹn package (SHA-256)',
};

export interface ScanCheck {
  readonly id: CheckId;
  readonly status: CheckStatus;
  readonly code: string;
  readonly path: string | null;
  readonly message: string;
}

export interface ScanIssue {
  readonly checkId: CheckId;
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly path?: string;
  readonly field?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly remediation?: string;
}

export interface ScannedModule {
  readonly folder: string;
  readonly moduleKey: string | null;
  readonly moduleName: string | null;
  readonly packageVersion: string | null;
  readonly classification: Classification;
  readonly foundationVersionStatus: VersionStatus | null;
  readonly registeredVersions: readonly { readonly moduleVersion: string; readonly status: VersionStatus }[];
  readonly scanStatus: ScanStatus;
  readonly eligibleForPreflight: boolean;
  readonly packageHash: string | null;
  readonly micFormat: MicFormat;
  readonly fileCount: number;
  readonly routes: readonly string[];
  readonly checks: readonly ScanCheck[];
  readonly issues: readonly ScanIssue[];
}

export interface ScanSummary {
  readonly total: number;
  readonly passed: number;
  readonly warnings: number;
  readonly failed: number;
  readonly unavailable: number;
}

export interface ScanReport {
  readonly scanId: string;
  readonly status: 'COMPLETED';
  readonly scannedAt: string;
  readonly durationMs: number;
  readonly registryAvailable: boolean;
  readonly summary: ScanSummary;
  readonly modules: readonly ScannedModule[];
}

// Registry facts (B01 + B02, SELECT only). `routes` = MIC-04 routes of the ACTIVE version (null when unreadable).
export interface RegisteredVersion {
  readonly moduleKey: string;
  readonly moduleVersion: string;
  readonly status: VersionStatus;
  readonly activeRoutes: readonly string[] | null;
}

export interface RegistryFacts {
  readonly moduleKeys: ReadonlySet<string>; // B01 (a module may be registered without any version)
  readonly versions: readonly RegisteredVersion[];
}

export interface ModuleScanRegistry {
  read(): Promise<RegistryFacts>;
}

// AppShell administration / authentication routes (frontend/src/routes/shellScreens.ts + App.tsx): a package route may
// not take one of them, nor a path below the account workspace. A unit test keeps this list equal to the frontend.
export const RESERVED_ROUTES: readonly string[] = ['/', '/login', '/first-change', '/foundation/modules', '/foundation/navigation', '/iam/accounts', '/iam/roles'];
export const RESERVED_PREFIXES: readonly string[] = ['/iam/accounts/'];
