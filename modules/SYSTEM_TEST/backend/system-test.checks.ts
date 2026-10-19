import { z } from 'zod';
import type { ModuleAccessDecision as AccessDecision } from './host.js';
import type { DiagnosticsSnapshot } from './system-test.repository.js';

// MOD-TEST-01 — quick read-only checks (TAB 1). Pure evaluation of facts that the service has just read: nothing here
// is assumed. A component is PASS only when its check really ran and succeeded; FAIL when it ran and found a defect;
// UNAVAILABLE when its source could not be read (privilege / database error); NOT_TESTED when a prerequisite is missing.

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_TESTED' | 'UNAVAILABLE';

export const CHECK_COMPONENTS = [
  ['AUTHENTICATION', 'Authentication'],
  ['SESSION', 'Session'],
  ['IAM', 'IAM permission evaluation'],
  ['POSTGRESQL', 'PostgreSQL connectivity'],
  ['REGISTRY', 'Foundation Registry'],
  ['VERSION_MIC', 'Version / MIC'],
  ['FUNCTION_ACTION', 'Function & Action'],
  ['DATA_CONTRACTS', 'Data Contracts'],
  ['COMPATIBILITY', 'Compatibility'],
  ['LIFECYCLE', 'Lifecycle'],
  ['NAVIGATION', 'Navigation'],
  ['MODULE_API', 'Module API'],
] as const;

export type CheckKey = (typeof CHECK_COMPONENTS)[number][0];

export interface CheckResult {
  readonly key: CheckKey;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface IamFact {
  readonly functionKey: string;
  readonly permissionCode: string;
  readonly decision: AccessDecision | { readonly error: unknown };
}

export interface CheckFacts {
  readonly moduleKey: string;
  readonly assuranceLevel: number;
  readonly snapshot: DiagnosticsSnapshot | { readonly error: unknown };
  readonly iam: readonly IamFact[];
  // Route paths of the actor's menu (GET /api/foundation/navigation, already IAM-filtered), or the read failure.
  readonly menuRoutes: readonly string[] | { readonly error: unknown };
  // MOD-TEST-02: Host MIC inspection of the single ACTIVE version (hash integrity, MIC-1.0 schema); null = not inspected.
  readonly manifest: { readonly intact: boolean; readonly micValid: boolean } | null;
}

const failed = <T extends object>(v: T | { readonly error: unknown }): v is { readonly error: unknown } => 'error' in v;
const sorted = (values: readonly string[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
// Only the MIC sections the checks compare (the full MIC-1.0 validation is the Host's, via `inspectManifest`).
const micSections = z.object({
  mic01Identity: z.object({ moduleKey: z.string(), moduleVersion: z.string() }),
  mic02Functions: z.array(z.object({ functionKey: z.string() })),
  mic03Actions: z.array(z.object({ functionKey: z.string(), actionKey: z.string() })),
  mic04Navigation: z.array(z.object({ functionKey: z.string().optional(), routePath: z.string().optional() })),
  mic06DataResources: z.array(z.object({ resourceKey: z.string(), interfaceKind: z.string(), columns: z.array(z.unknown()) })),
});
type Mic = z.infer<typeof micSections>;

function intactMic(snapshot: DiagnosticsSnapshot, moduleKey: string, manifest: CheckFacts['manifest']): { mic: Mic; moduleVersion: string } | string {
  if (snapshot.activeVersions.length !== 1) return `cần đúng một phiên bản ACTIVE, hiện có ${snapshot.activeVersions.length}`;
  const [v] = snapshot.activeVersions;
  if (v === undefined || v.manifestHash === null || v.manifestJson === null) return 'phiên bản ACTIVE không có hồ sơ MIC';
  if (manifest === null) return 'Host chưa kiểm tra hồ sơ MIC của phiên bản ACTIVE';
  if (!manifest.intact) return 'mã băm hồ sơ MIC không khớp manifest_hash';
  const parsed = micSections.safeParse(v.manifestJson);
  if (!manifest.micValid || !parsed.success) return 'hồ sơ MIC không đúng schema MIC-1.0';
  if (parsed.data.mic01Identity.moduleKey !== moduleKey || parsed.data.mic01Identity.moduleVersion !== v.moduleVersion) return 'định danh MIC-01 không khớp B01 / B02';
  return { mic: parsed.data, moduleVersion: v.moduleVersion };
}

export function evaluateChecks(facts: CheckFacts, sqlstate: (error: unknown) => string | undefined = () => undefined): CheckResult[] {
  const reason = (error: unknown) => {
    const state = sqlstate(error);
    return state ? `SQLSTATE ${state}` : 'lỗi không xác định';
  };
  const out = new Map<CheckKey, { status: CheckStatus; detail: string }>();
  const set = (key: CheckKey, status: CheckStatus, detail: string) => out.set(key, { status, detail });

  // Reaching this point means AuthService validated the session and the request passed AccessGuard + lifecycle gate.
  set('AUTHENTICATION', 'PASS', 'Phiên đăng nhập của yêu cầu này đã được AuthService xác thực (AUTHENTICATED).');
  set('SESSION', facts.assuranceLevel >= 1 ? 'PASS' : 'FAIL', `Mức xác thực của phiên: ${facts.assuranceLevel}.`);
  set('MODULE_API', 'PASS', `Yêu cầu đã qua AccessGuard (${facts.moduleKey} / DIAGNOSTICS / READ) và kiểm tra Module ENABLED + phiên bản ACTIVE.`);

  // IAM: every SYSTEM_TEST permission evaluated by the shared evaluator; the evaluator must have answered for all.
  const iamErrors = facts.iam.filter((f) => failed(f.decision));
  const iamText = facts.iam.map((f) => {
    const d = f.decision;
    if (failed(d)) return `${f.functionKey}: lỗi (${reason(d.error)})`;
    return d.allowed ? `${f.functionKey}: ALLOW` : `${f.functionKey}: DENY (${d.reason})`;
  }).join('; ');
  set('IAM', iamErrors.length === 0 && facts.iam.length > 0 ? 'PASS' : 'FAIL', iamText || 'Không có quyền nào để đánh giá.');

  const dependents: CheckKey[] = ['REGISTRY', 'VERSION_MIC', 'FUNCTION_ACTION', 'DATA_CONTRACTS', 'COMPATIBILITY', 'LIFECYCLE'];
  const snapshot = facts.snapshot;
  if (failed(snapshot)) {
    const denied = sqlstate(snapshot.error) === '42501';
    set('POSTGRESQL', denied ? 'UNAVAILABLE' : 'FAIL', denied ? 'Vai trò API không có quyền đọc dữ liệu cần kiểm tra (SQLSTATE 42501).' : `Không đọc được PostgreSQL (${reason(snapshot.error)}).`);
    for (const key of dependents) set(key, 'UNAVAILABLE', 'Không đọc được dữ liệu Foundation.');
  } else {
    const id = snapshot.identity;
    set('POSTGRESQL', 'PASS', `Đã kết nối ${id.databaseName} (PostgreSQL ${id.serverVersion}) bằng vai trò ${id.roleName}, giao dịch READ ONLY.`);
    const m = snapshot.module;
    set('REGISTRY', m ? 'PASS' : 'FAIL', m ? `Module ${facts.moduleKey} có trong B01 (${m.isEnabled ? 'đang bật' : 'đang tắt'}).` : `Không có Module ${facts.moduleKey} trong B01.`);
    set('LIFECYCLE', m && m.isEnabled && m.activeVersions === 1 ? 'PASS' : 'FAIL',
      m ? `is_enabled = ${m.isEnabled}; số phiên bản ACTIVE = ${m.activeVersions}.` : 'Không có Module.');

    const intact = intactMic(snapshot, facts.moduleKey, facts.manifest);
    if (typeof intact === 'string') {
      set('VERSION_MIC', 'FAIL', intact);
      for (const key of ['FUNCTION_ACTION', 'DATA_CONTRACTS', 'COMPATIBILITY'] as const) set(key, 'NOT_TESTED', 'Chưa có hồ sơ MIC hợp lệ của phiên bản ACTIVE để đối chiếu.');
    } else {
      const { mic, moduleVersion } = intact;
      set('VERSION_MIC', 'PASS', `Phiên bản ${moduleVersion} ACTIVE; hồ sơ MIC-1.0 đúng schema, mã băm khớp manifest_hash.`);
      const fns = mic.mic02Functions.map((f) => f.functionKey);
      const acts = mic.mic03Actions.map((a) => `${a.functionKey}.${a.actionKey}`);
      const okRegistry = same(fns, snapshot.functions) && same(acts, snapshot.actions);
      set('FUNCTION_ACTION', okRegistry ? 'PASS' : 'FAIL',
        `B05: ${snapshot.functions.length} Function (MIC-02: ${fns.length}); B06: ${snapshot.actions.length} Action (MIC-03: ${acts.length})${okRegistry ? '' : ' — không khớp'}.`);
      const expected = mic.mic06DataResources.map((r) => `${r.resourceKey}:${r.interfaceKind}:${r.columns.length}`);
      const actual = snapshot.contracts.map((c) => `${c.resourceKey}:${c.interfaceKind}:${c.fields}`);
      const direct = mic.mic06DataResources.some((r) => r.interfaceKind === 'DIRECT_DB');
      const okData = same(expected, actual) && !direct;
      set('DATA_CONTRACTS', okData ? 'PASS' : 'FAIL',
        `B10/B11: ${actual.join(', ') || 'không có'} (MIC-06: ${expected.join(', ') || 'không có'})${direct ? '; có DIRECT_DB' : ''}${okData ? '' : ' — không khớp'}.`);
      const c = snapshot.compatibility;
      const okCompat = c !== null && (c.checkResult === 'PASS' || c.checkResult === 'WARN') && c.blocking === 0;
      set('COMPATIBILITY', okCompat ? 'PASS' : 'FAIL', c ? `B13 gần nhất: ${c.checkResult}; B14 BLOCKING: ${c.blocking}.` : 'Chưa có kết quả B13 cho phiên bản ACTIVE.');

      // Navigation: the actor's filtered menu must offer exactly the routes of the Functions IAM allows.
      const routes = facts.menuRoutes;
      if (failed(routes)) {
        set('NAVIGATION', 'FAIL', `Không đọc được menu Foundation (${reason(routes.error)}).`);
      } else {
        const problems: string[] = [];
        const shown: string[] = [];
        for (const f of facts.iam) {
          const route = mic.mic04Navigation.find((n) => n.functionKey === f.functionKey)?.routePath;
          if (route === undefined) continue;
          const allowed = !failed(f.decision) && f.decision.allowed;
          const present = routes.includes(route);
          if (present) shown.push(route);
          if (allowed && !present) problems.push(`${route} được phép nhưng chưa có trong menu`);
          if (!allowed && present) problems.push(`${route} không được phép nhưng vẫn hiển thị`);
        }
        set('NAVIGATION', problems.length === 0 && shown.length > 0 ? 'PASS' : 'FAIL',
          problems.length > 0 ? problems.join('; ') : shown.length > 0 ? `Menu hiển thị: ${shown.join(', ')}.` : 'Menu không có route nào của Module.');
      }
    }
  }
  if (!out.has('NAVIGATION')) set('NAVIGATION', 'NOT_TESTED', 'Chưa có hồ sơ MIC hợp lệ để biết route của Module.');

  return CHECK_COMPONENTS.map(([key, label]) => {
    const r = out.get(key);
    return { key, label, status: r?.status ?? 'NOT_TESTED', detail: r?.detail ?? 'Chưa kiểm tra.' };
  });
}

export function summarize(results: readonly CheckResult[]): Record<CheckStatus, number> {
  const s: Record<CheckStatus, number> = { PASS: 0, FAIL: 0, NOT_TESTED: 0, UNAVAILABLE: 0 };
  for (const r of results) s[r.status] += 1;
  return s;
}
