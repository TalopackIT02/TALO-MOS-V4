import { PACKAGE_FORMAT, HOST_PROTOCOL } from '../../../scripts/modules-sync.mjs';
import { micSchema, validateMic } from './foundation.mic.js';
import type { MicErrorCode } from './foundation.mic.js';
import { MIC_JSON_PATH } from './foundation.module-scan.files.js';
import type { PackageFacts } from './foundation.module-scan.files.js';
import { CHECK_IDS, RESERVED_PREFIXES, RESERVED_ROUTES } from './foundation.module-scan.types.js';
import type {
  CheckId, CheckStatus, Classification, IssueSeverity, MicFormat, RegistryFacts, ScanCheck, ScanIssue, ScannedModule, ScanStatus, VersionStatus,
} from './foundation.module-scan.types.js';

// FMI-01 — static evaluation of one package (pure: facts already read + registry facts). MS-01…MS-20 of 04_SCAN_RULES.md.
// A check that could not run because a prerequisite failed is FAIL / NOT_EVALUATED (never PASS). MIC-10 is a declaration
// only: NOT_TESTED → WARN TEST_EVIDENCE_PENDING, PASS → WARN TEST_EVIDENCE_UNVERIFIED (verified only by FMI-02).

const K01 = /^[A-Z][A-Z0-9_]{0,79}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LOCKED: readonly VersionStatus[] = ['IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'];
const IDENTITY = new Set<MicErrorCode>(['IDENTITY_MODULE_KEY_MISMATCH', 'IDENTITY_MODULE_VERSION_MISMATCH', 'IDENTITY_MIC_STANDARD_MISMATCH']);
const COMPATIBILITY = new Set<MicErrorCode>(['COMPATIBILITY_KIND_INVALID', 'COMPATIBILITY_FROM_VERSION_INVALID']);

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Values shown to the user: short, single line, never file content beyond the field itself.
const clip = (v: unknown): string => {
  if (v === undefined) return '(thiếu)';
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  const one = s.replace(/\s+/g, ' ');
  return one.length > 120 ? `${one.slice(0, 117)}…` : one;
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface EvaluationContext {
  // null = Registry could not be read (REGISTRY_UNKNOWN, fail closed).
  readonly registry: RegistryFacts | null;
  // route → module keys of the scanned folders that declare it (valid manifests only).
  readonly folderRoutes: ReadonlyMap<string, ReadonlySet<string>>;
}

class Collector {
  readonly checks = new Map<CheckId, ScanCheck>();
  readonly issues: ScanIssue[] = [];

  set(id: CheckId, status: CheckStatus, code: string, message: string, path: string | null = null): void {
    this.checks.set(id, { id, status, code, path, message });
  }

  issue(id: CheckId, status: Exclude<CheckStatus, 'PASS'>, i: Omit<ScanIssue, 'checkId' | 'severity'>): void {
    const severity: IssueSeverity = status === 'FAIL' ? 'ERROR' : status === 'WARN' ? 'WARNING' : 'UNAVAILABLE';
    this.issues.push({ checkId: id, severity, ...i });
  }

  // A FAIL / WARN / UNAVAILABLE check with its issue (same code / message).
  fail(id: CheckId, status: Exclude<CheckStatus, 'PASS'>, code: string, message: string, extra: Omit<ScanIssue, 'checkId' | 'severity' | 'code' | 'message'> = {}): void {
    if (!this.checks.has(id) || this.checks.get(id)?.status === 'PASS') this.set(id, status, code, message, extra.path ?? null);
    this.issue(id, status, { code, message, ...extra });
  }

  notEvaluated(ids: readonly CheckId[], because: string): void {
    for (const id of ids) if (!this.checks.has(id)) this.set(id, 'FAIL', 'NOT_EVALUATED', `Chưa kiểm tra được: ${because}.`);
  }

  list(): ScanCheck[] {
    return CHECK_IDS.map((id) => this.checks.get(id) ?? { id, status: 'FAIL', code: 'NOT_EVALUATED', path: null, message: 'Chưa kiểm tra được.' });
  }
}

function aggregate(checks: readonly ScanCheck[]): ScanStatus {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.status === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (checks.some((c) => c.status === 'WARN')) return 'WARN';
  return 'PASS';
}

// validateManifest() problem text → the check it belongs to.
function manifestCheck(problem: string): CheckId {
  if (problem === 'packageFormat') return 'MS-04';
  if (problem.startsWith('moduleKey')) return 'MS-05';
  if (problem === 'packageVersion') return 'MS-06';
  if (problem.startsWith('hostProtocol')) return 'MS-07';
  if (problem === 'requiredCapabilities' || problem.startsWith('capability not provided')) return 'MS-08';
  if (problem.startsWith('backendEntry')) return 'MS-09';
  if (problem.startsWith('frontendEntry')) return 'MS-10';
  if (problem === 'frontend.screens' || problem.startsWith('screen')) return 'MS-11';
  return 'MS-03';
}

const MANIFEST_CODES: Readonly<Record<string, string>> = {
  'MS-03': 'MODULE_MANIFEST_INVALID', 'MS-04': 'PACKAGE_FORMAT_UNSUPPORTED', 'MS-05': 'MODULE_KEY_MISMATCH', 'MS-06': 'MODULE_VERSION_INVALID',
  'MS-07': 'HOST_PROTOCOL_UNSUPPORTED', 'MS-08': 'CAPABILITY_UNSUPPORTED', 'MS-09': 'MODULE_ENTRY_MISSING', 'MS-10': 'MODULE_ENTRY_MISSING', 'MS-11': 'MODULE_SCREEN_INVALID',
};

export function manifestRoutes(m: unknown): string[] {
  if (!isObject(m) || !isObject(m['frontend']) || !Array.isArray(m['frontend']['screens'])) return [];
  return m['frontend']['screens'].flatMap((s: unknown) => (isObject(s) && Array.isArray(s['tabs'])
    ? s['tabs'].flatMap((t: unknown) => (isObject(t) && typeof t['path'] === 'string' ? [t['path']] : [])) : []));
}

export function evaluatePackage(facts: PackageFacts, ctx: EvaluationContext): ScannedModule {
  const c = new Collector();
  const folder = facts.folder;
  const m = facts.manifest.state === 'OK' && isObject(facts.manifest.value) ? facts.manifest.value : null;
  const manifestOk = m !== null && facts.manifestProblems.length === 0;
  const moduleKey = m && typeof m['moduleKey'] === 'string' && K01.test(m['moduleKey']) ? m['moduleKey'] : null;
  const packageVersion = m && typeof m['packageVersion'] === 'string' && SEMVER.test(m['packageVersion']) ? m['packageVersion'] : null;
  const moduleName = m && typeof m['name'] === 'string' ? clip(m['name']) : null;
  const routes = manifestOk ? manifestRoutes(m) : [];

  // MS-01 / MS-02 — folder and path safety.
  if (facts.unsafeFolder) {
    c.fail('MS-01', 'FAIL', 'PATH_UNSAFE', 'Thư mục package là liên kết / junction hoặc trỏ ra ngoài modules/; không đọc nội dung.', { path: folder, remediation: 'Chép thư mục thật (không dùng liên kết) vào modules/.' });
    c.fail('MS-02', 'FAIL', 'PATH_UNSAFE', 'Không đọc nội dung thư mục không an toàn.', { path: folder });
  } else {
    if (K01.test(folder)) c.set('MS-01', 'PASS', 'FOLDER_READABLE', 'Thư mục package đọc được, tên theo K01.', folder);
    else c.fail('MS-01', 'FAIL', 'MODULE_FOLDER_INVALID', 'Tên thư mục phải theo K01 (chữ in hoa, số, gạch dưới; bắt đầu bằng chữ).', { path: folder, expected: 'K01, ví dụ SALES_ORDER', actual: clip(folder), remediation: 'Đổi tên thư mục bằng đúng moduleKey.' });
    const unsafe = facts.walk?.issues ?? [];
    if (unsafe.length === 0) c.set('MS-02', 'PASS', 'PATH_SAFE', `Không có liên kết, tệp đặc biệt hoặc tệp bí mật (${facts.walk?.files.length ?? 0} tệp).`);
    for (const u of unsafe) {
      if (u.code === 'SCAN_LIMIT_EXCEEDED') continue; // reported by MS-20
      c.fail('MS-02', 'FAIL', u.code, u.message, { path: `${folder}/${u.path}`, remediation: u.code === 'SENSITIVE_FILE' ? 'Xóa tệp bí mật khỏi package.' : 'Thay liên kết bằng tệp / thư mục thật.' });
    }
    if (!c.checks.has('MS-02')) c.set('MS-02', 'PASS', 'PATH_SAFE', 'Không có liên kết hoặc tệp bí mật.');
  }

  // MS-03 … MS-11 — manifest (the Host loader's own validator, pure).
  const manifestIds: CheckId[] = ['MS-04', 'MS-05', 'MS-06', 'MS-07', 'MS-08', 'MS-09', 'MS-10', 'MS-11'];
  if (facts.unsafeFolder) c.notEvaluated(['MS-03', ...manifestIds], 'thư mục không an toàn');
  else if (facts.manifest.state === 'MISSING') {
    c.fail('MS-03', 'FAIL', 'MODULE_MANIFEST_MISSING', 'Thiếu tệp module.json.', { path: `${folder}/module.json`, remediation: 'Thêm module.json theo TALO-MODULE-PACKAGE-1.' });
    c.notEvaluated(manifestIds, 'thiếu module.json');
  } else if (facts.manifest.state === 'INVALID' || m === null) {
    c.fail('MS-03', 'FAIL', 'MODULE_MANIFEST_INVALID', `module.json ${facts.manifest.state === 'INVALID' ? facts.manifest.reason : 'không phải object JSON'}.`, { path: `${folder}/module.json` });
    c.notEvaluated(manifestIds, 'module.json không hợp lệ');
  } else {
    for (const p of facts.manifestProblems) {
      const id = manifestCheck(p);
      const field = p.split(' ')[0] ?? p;
      const expected = id === 'MS-04' ? PACKAGE_FORMAT : id === 'MS-07' ? HOST_PROTOCOL : id === 'MS-05' ? folder : id === 'MS-06' ? 'MAJOR.MINOR.PATCH' : undefined;
      const actual = id === 'MS-04' || id === 'MS-05' || id === 'MS-06' || id === 'MS-07' ? clip(m[field]) : undefined;
      c.fail(id, 'FAIL', MANIFEST_CODES[id] ?? 'MODULE_MANIFEST_INVALID', `module.json: ${p}.`, {
        path: `${folder}/module.json`, field, ...(expected !== undefined ? { expected } : {}), ...(actual !== undefined ? { actual } : {}),
      });
    }
    if (!c.checks.has('MS-03')) c.set('MS-03', 'PASS', 'MANIFEST_VALID', 'module.json đọc được, đúng các trường của TALO-MODULE-PACKAGE-1.', `${folder}/module.json`);
    const okText: Record<string, string> = {
      'MS-04': `packageFormat = ${PACKAGE_FORMAT}.`, 'MS-05': 'moduleKey theo K01, trùng tên thư mục.', 'MS-06': `packageVersion ${packageVersion ?? ''} đúng SemVer.`,
      'MS-07': `hostProtocol = ${HOST_PROTOCOL}.`, 'MS-08': 'Mọi capability đều do Host cung cấp.', 'MS-09': 'backendEntry tồn tại trong package.',
      'MS-10': 'frontendEntry tồn tại trong package.', 'MS-11': 'Màn hình / tab / route đúng cú pháp Host.',
    };
    for (const id of manifestIds) if (!c.checks.has(id)) c.set(id, 'PASS', id === 'MS-11' ? 'SCREENS_VALID' : 'MANIFEST_FIELD_VALID', okText[id] ?? 'Hợp lệ.', `${folder}/module.json`);
    const dup = routes.filter((r, i) => routes.indexOf(r) !== i);
    if (dup.length > 0) c.fail('MS-11', 'FAIL', 'MODULE_ROUTE_CONFLICT', `Route lặp trong chính package: ${[...new Set(dup)].join(', ')}.`, { path: `${folder}/module.json`, field: 'frontend.screens[].tabs[].path' });
  }

  // Registry (MS-17) and classification.
  const registered = moduleKey !== null && ctx.registry !== null ? ctx.registry.versions.filter((v) => v.moduleKey === moduleKey) : [];
  const isRegistered = moduleKey !== null && ctx.registry !== null && ctx.registry.moduleKeys.has(moduleKey);
  const same = packageVersion !== null ? registered.find((v) => v.moduleVersion === packageVersion) : undefined;
  let classification: Classification;
  if (moduleKey === null || packageVersion === null) classification = 'INVALID_PACKAGE';
  else if (ctx.registry === null) classification = 'REGISTRY_UNKNOWN';
  else if (!isRegistered) classification = 'NEW_MODULE';
  else if (same) classification = 'EXISTING_VERSION';
  else {
    const highest = registered.map((v) => v.moduleVersion).sort(compareSemver).at(-1) ?? '0.0.0';
    classification = compareSemver(packageVersion, highest) > 0 ? 'UPGRADE_CANDIDATE' : 'OLDER_PACKAGE';
  }
  const foundationVersionStatus = same?.status ?? null;
  const locked = same !== undefined && LOCKED.includes(same.status);
  if (classification === 'INVALID_PACKAGE') c.notEvaluated(['MS-17'], 'không có moduleKey / packageVersion hợp lệ');
  else if (classification === 'REGISTRY_UNKNOWN') c.fail('MS-17', 'UNAVAILABLE', 'REGISTRY_UNAVAILABLE', 'Không đọc được Foundation Registry; không suy đoán module mới.', { remediation: 'Quét lại khi Registry sẵn sàng.' });
  else if (classification === 'OLDER_PACKAGE') {
    c.fail('MS-17', 'WARN', 'OLDER_PACKAGE', `Phiên bản ${packageVersion} thấp hơn phiên bản cao nhất đã đăng ký.`, { field: 'packageVersion', actual: packageVersion ?? '', expected: `> ${registered.map((v) => v.moduleVersion).sort(compareSemver).at(-1) ?? ''}` });
  } else if (locked) {
    c.fail('MS-17', 'WARN', 'VERSION_ALREADY_LOCKED', `Phiên bản ${packageVersion} đã ở trạng thái ${foundationVersionStatus} trong Foundation: không ghi đè cùng phiên bản.`, {
      field: 'packageVersion', actual: packageVersion ?? '', remediation: 'Tăng packageVersion để tạo bản nâng cấp.',
    });
  } else {
    const text: Record<string, string> = {
      NEW_MODULE: `${moduleKey} chưa đăng ký trong Foundation (module mới).`,
      UPGRADE_CANDIDATE: `${packageVersion} lớn hơn mọi phiên bản đã đăng ký của ${moduleKey}.`,
      EXISTING_VERSION: `${packageVersion} đã có trong Foundation ở trạng thái ${foundationVersionStatus ?? ''}.`,
    };
    c.set('MS-17', 'PASS', classification, text[classification] ?? classification);
  }

  // MS-16 — routes: reserved AppShell paths, other scanned folders, ACTIVE routes of OTHER registered modules.
  if (!manifestOk || moduleKey === null) c.notEvaluated(['MS-16'], 'module.json chưa hợp lệ');
  else {
    for (const r of routes) {
      if (RESERVED_ROUTES.includes(r) || RESERVED_PREFIXES.some((p) => r.startsWith(p))) {
        c.fail('MS-16', 'FAIL', 'MODULE_ROUTE_CONFLICT', `Route ${r} thuộc màn hình quản trị của AppShell.`, { path: `${folder}/module.json`, field: 'frontend.screens[].tabs[].path', actual: r });
        continue;
      }
      const others = [...(ctx.folderRoutes.get(r) ?? [])].filter((k) => k !== moduleKey);
      if (others.length > 0) c.fail('MS-16', 'FAIL', 'MODULE_ROUTE_CONFLICT', `Route ${r} trùng với package ${others.join(', ')}.`, { path: `${folder}/module.json`, actual: r });
      const activeOthers = (ctx.registry?.versions ?? []).filter((v) => v.moduleKey !== moduleKey && (v.activeRoutes ?? []).includes(r)).map((v) => v.moduleKey);
      if (activeOthers.length > 0) c.fail('MS-16', 'FAIL', 'MODULE_ROUTE_CONFLICT', `Route ${r} đang được module ACTIVE ${[...new Set(activeOthers)].join(', ')} sử dụng.`, { path: `${folder}/module.json`, actual: r });
    }
    if (!c.checks.has('MS-16')) c.set('MS-16', 'PASS', 'ROUTES_FREE', routes.length > 0 ? `Không xung đột: ${routes.join(', ')} (route của chính module được phép dùng lại khi nâng cấp).` : 'Package không khai báo route.');
  }

  // MS-12 … MS-15, MS-18, MS-19 — MIC as JSON data.
  let micFormat: MicFormat;
  const micIds: CheckId[] = ['MS-13', 'MS-14', 'MS-15', 'MS-18', 'MS-19'];
  const micPath = `${folder}/${MIC_JSON_PATH}`;
  if (facts.mic.state === 'OK') {
    micFormat = 'JSON';
    c.set('MS-12', 'PASS', 'MIC_JSON_FOUND', 'Đọc được mic/module.mic.json (dữ liệu, không thực thi mã).', micPath);
  } else if (facts.mic.state === 'INVALID') {
    micFormat = 'INVALID';
    c.fail('MS-12', 'FAIL', 'MIC_JSON_INVALID', `mic/module.mic.json ${facts.mic.reason}.`, { path: micPath });
  } else if (facts.legacyMicEntry !== null) {
    micFormat = 'LEGACY_TS';
    if (ctx.registry === null) c.fail('MS-12', 'UNAVAILABLE', 'REGISTRY_UNAVAILABLE', 'MIC chỉ có dạng TypeScript; không xác định được module đã đăng ký hay chưa.', { path: `${folder}/${facts.legacyMicEntry}` });
    else if (isRegistered) {
      c.fail('MS-12', 'WARN', 'LEGACY_MIC_FORMAT', 'MIC chỉ có dạng TypeScript (module đã đăng ký): không import mã để trích MIC; package không đủ điều kiện Preflight.', {
        path: `${folder}/${facts.legacyMicEntry}`, expected: MIC_JSON_PATH, remediation: 'Xuất MIC thành mic/module.mic.json ở phiên bản kế tiếp.',
      });
    } else {
      c.fail('MS-12', 'FAIL', 'MIC_FILE_MISSING', 'Package mới phải có mic/module.mic.json (MIC TypeScript không được thực thi để đọc).', { path: micPath, remediation: 'Thêm mic/module.mic.json.' });
    }
  } else {
    micFormat = 'MISSING';
    c.fail('MS-12', 'FAIL', 'MIC_FILE_MISSING', 'Thiếu mic/module.mic.json.', { path: micPath, remediation: 'Thêm MIC-01…MIC-10 dạng JSON.' });
  }
  if (micFormat === 'LEGACY_TS' && c.checks.get('MS-12')?.status !== 'FAIL') {
    const status = c.checks.get('MS-12')?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'WARN';
    for (const id of micIds) c.set(id, status, 'LEGACY_MIC_FORMAT', 'Không kiểm tra MIC dạng TypeScript (không thực thi mã package).');
  } else if (facts.mic.state === 'OK' && m !== null) {
    const parsed = micSchema.safeParse(facts.mic.value);
    if (!parsed.success) {
      for (const i of parsed.error.issues.slice(0, 10)) {
        c.fail('MS-13', 'FAIL', 'MIC_SCHEMA_INVALID', `MIC sai schema MIC-1.0: ${i.message}.`, { path: micPath, field: i.path.join('.') || '(gốc)' });
      }
      c.notEvaluated(['MS-14', 'MS-15', 'MS-18', 'MS-19'], 'MIC sai schema');
    } else {
      c.set('MS-13', 'PASS', 'MIC_SCHEMA_VALID', 'MIC đúng schema MIC-1.0 (validator Foundation).', micPath);
      const mic = parsed.data;
      const others = registered.filter((v) => v.moduleVersion !== packageVersion).map((v) => ({ moduleVersion: v.moduleVersion, status: v.status }));
      const result = validateMic(facts.mic.value, {
        moduleKey: typeof m['moduleKey'] === 'string' ? m['moduleKey'] : '', moduleVersion: typeof m['packageVersion'] === 'string' ? m['packageVersion'] : '',
        contractVersion: typeof m['contractVersion'] === 'string' ? m['contractVersion'] : '', otherVersions: others,
      });
      const codes = result.ok ? [] : result.errors;
      // MS-14 identity — expected = module.json.
      const pairs: [MicErrorCode, string, unknown, unknown][] = [
        ['IDENTITY_MODULE_KEY_MISMATCH', 'mic01Identity.moduleKey', m['moduleKey'], mic.mic01Identity.moduleKey],
        ['IDENTITY_MODULE_VERSION_MISMATCH', 'mic01Identity.moduleVersion', m['packageVersion'], mic.mic01Identity.moduleVersion],
        ['IDENTITY_MIC_STANDARD_MISMATCH', 'mic01Identity.micStandard', m['contractVersion'], mic.mic01Identity.micStandard],
      ];
      for (const [code, field, expected, actual] of pairs) {
        if (codes.includes(code)) c.fail('MS-14', 'FAIL', 'MIC_IDENTITY_MISMATCH', `${field} không khớp module.json (${code}).`, { path: micPath, field, expected: clip(expected), actual: clip(actual) });
      }
      if (!c.checks.has('MS-14')) c.set('MS-14', 'PASS', 'MIC_IDENTITY_MATCH', 'moduleKey / moduleVersion / micStandard khớp module.json.', micPath);
      const mapping = codes.filter((x) => !IDENTITY.has(x) && !COMPATIBILITY.has(x) && x !== 'MIC_SCHEMA_INVALID');
      for (const code of mapping) {
        c.fail('MS-15', 'FAIL', 'MIC_MAPPING_INVALID', `Liên kết MIC không hợp lệ: ${code}.`, { path: micPath, field: code.startsWith('IAM') ? 'mic07IamMapping' : code.startsWith('DATA') ? 'mic06DataResources' : code.startsWith('API') ? 'mic05Api' : code.startsWith('NAVIGATION') ? 'mic04Navigation' : 'mic02Functions / mic03Actions', actual: code });
      }
      if (!c.checks.has('MS-15')) c.set('MS-15', 'PASS', 'MIC_REFERENCES_VALID', 'Function / Action / API / IAM (K05) / Data liên kết đúng.', micPath);
      // MS-18 compatibility against the real version history (Registry required).
      if (ctx.registry === null) c.fail('MS-18', 'UNAVAILABLE', 'REGISTRY_UNAVAILABLE', 'Không đối chiếu MIC-09 khi không đọc được Registry.', { path: micPath, field: 'mic09Compatibility' });
      else {
        for (const code of codes.filter((x) => COMPATIBILITY.has(x))) {
          c.fail('MS-18', 'FAIL', 'MIC_COMPATIBILITY_INVALID', `MIC-09 không khớp lịch sử phiên bản (${code}).`, {
            path: micPath, field: 'mic09Compatibility', actual: clip(`${mic.mic09Compatibility.kind}${mic.mic09Compatibility.fromVersion ? ` from ${mic.mic09Compatibility.fromVersion}` : ''}`),
            expected: others.some((v) => ['APPROVED', 'ACTIVE', 'RETIRED'].includes(v.status)) ? `CHANGE từ một trong: ${others.map((v) => v.moduleVersion).join(', ')}` : 'INITIAL_REGISTRATION',
          });
        }
        if (!c.checks.has('MS-18')) c.set('MS-18', 'PASS', 'MIC_COMPATIBILITY_VALID', `MIC-09 ${mic.mic09Compatibility.kind} đúng với lịch sử phiên bản.`, micPath);
      }
      // MS-19 MIC-10 — a declaration, never runtime evidence here.
      const evidence = mic.mic10Manifest.testEvidence;
      const notPassed = evidence.filter((e) => e.result !== 'PASS');
      if (notPassed.length > 0) {
        c.fail('MS-19', 'WARN', 'TEST_EVIDENCE_PENDING', `${notPassed.length}/${evidence.length} mục MIC-10 chưa PASS (${[...new Set(notPassed.map((e) => e.result))].join(', ')}).`, { path: micPath, field: 'mic10Manifest.testEvidence' });
      } else {
        c.fail('MS-19', 'WARN', 'TEST_EVIDENCE_UNVERIFIED', `${evidence.length} mục MIC-10 khai báo PASS nhưng chưa được xác minh runtime (FMI-02).`, { path: micPath, field: 'mic10Manifest.testEvidence' });
      }
    }
  } else c.notEvaluated(micIds, micFormat === 'MISSING' ? 'thiếu MIC JSON' : 'MIC JSON / module.json không hợp lệ');

  // MS-20 — package integrity.
  if (facts.unsafeFolder) c.notEvaluated(['MS-20'], 'thư mục không an toàn');
  else if (facts.walk?.limited) c.fail('MS-20', 'FAIL', 'SCAN_LIMIT_EXCEEDED', facts.walk.issues.find((i) => i.code === 'SCAN_LIMIT_EXCEEDED')?.message ?? 'Vượt giới hạn package.', { path: folder });
  else if (facts.changed) c.fail('MS-20', 'FAIL', 'PACKAGE_CHANGED_DURING_SCAN', 'Tệp trong package thay đổi trong lúc quét: không cấp mã băm.', { path: folder, remediation: 'Chờ chép xong rồi quét lại.' });
  else if (facts.hash === null) c.fail('MS-20', 'FAIL', 'PATH_UNSAFE', 'Không tính được mã băm vì package có tệp không an toàn.', { path: folder });
  else if (classification === 'EXISTING_VERSION') {
    c.fail('MS-20', 'WARN', 'INTEGRITY_UNVERIFIED', `SHA-256 ${facts.hash.slice(0, 12)}…: Foundation chưa lưu mã băm package của phiên bản ${packageVersion}, không kết luận mã local trùng bản đã đăng ký.`, { path: folder });
  } else c.set('MS-20', 'PASS', 'PACKAGE_HASH_STABLE', `SHA-256 ổn định trên ${facts.walk?.files.length ?? 0} tệp.`, folder);

  const checks = c.list();
  const scanStatus = aggregate(checks);
  const eligibleForPreflight = !checks.some((x) => x.status === 'FAIL' || x.status === 'UNAVAILABLE') && micFormat === 'JSON' && facts.hash !== null
    && (classification === 'NEW_MODULE' || classification === 'UPGRADE_CANDIDATE' || (classification === 'EXISTING_VERSION' && !locked));
  return {
    folder, moduleKey, moduleName, packageVersion, classification, foundationVersionStatus,
    registeredVersions: registered.map((v) => ({ moduleVersion: v.moduleVersion, status: v.status })).sort((a, b) => compareSemver(a.moduleVersion, b.moduleVersion)),
    scanStatus, eligibleForPreflight, packageHash: facts.changed ? null : facts.hash, micFormat, fileCount: facts.walk?.files.length ?? 0, routes, checks, issues: c.issues,
  };
}
