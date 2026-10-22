// DATA_INSPECTOR — MIC-1.0 of package 0.1.0 (INITIAL_REGISTRATION), the content of spec v0.2 file 08-MIC-1.0.json. It is
// submitted through the Foundation API (PUT manifest → SUBMIT) by an authorised operator; the runtime never reads this
// file and loading the package registers nothing. `moduleKey` is a parameter only so that tests can build the same MIC
// under a fixture key; the K05 mapping always follows the key (moduleCode = moduleKey, resourceCode = functionKey,
// operation = actionKey). MIC-10 evidence is supplied by the caller: only results of test runs that really passed may be
// recorded as PASS; the default is the spec's NOT_TESTED, which keeps the activation gate closed.
// Self-contained (no Host import); the Host validates it with its own MIC-1.0 validator at PUT / SUBMIT.

const MIC_STANDARD = 'MIC-1.0';

export type MicEvidence = readonly { readonly name: string; readonly result: 'PASS' | 'FAIL' | 'NOT_TESTED'; readonly reference: string }[];

export const DATA_INSPECTOR_DEFAULT_EVIDENCE: MicEvidence = [
  {
    name: 'DATA_INSPECTOR backend IAM-admin gate, PostgreSQL all-schema readonly and menu E2E',
    result: 'NOT_TESTED',
    reference: 'PENDING: no runtime/DB/IAM/menu tests as of 2026-10-22',
  },
];

// DI-02 — MIC-10 CANDIDATE (not PUT / SUBMITTED; owner review pending). Each PASS cites a real run whose filtered log is
// in modules/DATA_INSPECTOR/evidence/<run>/ (commands, time, HEAD, counts in 00-run.txt; hashes in SHA256SUMS).
// Pre-activation tests only: post-activation acceptance (registered lifecycle, B09 menu, AppShell UI, login E2E) cannot
// be PASS before ACTIVATE and is listed in the evidence README, not here. The IAM runtime test on PostgreSQL is required
// BEFORE activation and is not run (IAM provisioning not approved, BL-02): it stays NOT_TESTED, so the Foundation
// activation gate (every result PASS) stays closed — on purpose.
export const DATA_INSPECTOR_EVIDENCE_RUN = 'DI-02-20261022-R2';
const ev = (file: string) => `modules/DATA_INSPECTOR/evidence/${DATA_INSPECTOR_EVIDENCE_RUN}/${file}`;

export const DATA_INSPECTOR_MIC10_CANDIDATE: MicEvidence = [
  { name: 'DI-UNIT module unit and Host-compatibility tests (real Host capabilities, mock database)', result: 'PASS', reference: ev('01-module-unit.log') },
  {
    name: 'DI-DB PostgreSQL TEST read-only (talo_mos_v4_test / talo_app): admin account gate, all-schema catalog, columns, rows, NOT_READABLE, stale and injected keys',
    result: 'PASS', reference: ev('02-module-db.log'),
  },
  { name: 'DI-MASK FIX-01 sensitive data masking (unit canaries + PostgreSQL TEST)', result: 'PASS', reference: ev('03-masking.log') },
  { name: 'DI-MIC MIC-1.0 Foundation validator, MIC-01..10 and module.json consistency with spec v0.2', result: 'PASS', reference: ev('04-mic.log') },
  { name: 'DI-HOST Host loader and multi-module runtime handshake (DI-01)', result: 'PASS', reference: ev('05-host-handshake.log') },
  {
    name: 'DI-TYPECHECK backend (src + test), frontend (app + node), module tests', result: 'PASS',
    reference: `${ev('06-typecheck-backend.log')}; ${ev('07-typecheck-frontend.log')}; ${ev('08-typecheck-module-tests.log')}`,
  },
  { name: 'DI-REGRESSION backend regression suite (npm test)', result: 'PASS', reference: ev('09-backend-regression.log') },
  {
    name: 'DI-IAM-DB IAM runtime on PostgreSQL with provisioned data_inspector.catalog.read / rows.read: direct ALLOW admin only, Direct DENY, non-admin mis-grant 403, B08 DENIED audit',
    result: 'NOT_TESTED', reference: 'BLOCKED: IAM provisioning of data_inspector.* not approved (BL-02); required before activation',
  },
];

const tableKeyColumn =(description: string) => ({ name: 'table_key', type: 'text', required: true, primaryKey: true, description });

export function dataInspectorMic(moduleKey: string = 'DATA_INSPECTOR', testEvidence: MicEvidence = DATA_INSPECTOR_DEFAULT_EVIDENCE) {
  const map = (functionKey: string, actionKey: string) => ({ functionKey, actionKey, moduleCode: moduleKey, resourceCode: functionKey, operation: actionKey, minimumAssuranceLevel: 1 });
  const access = (functionKey: string) => [{ functionKey, actionKey: 'READ', operation: 'SELECT', approvalMode: 'NOT_REQUIRED' }];
  const allSchemas = 'Tên trong toàn bộ schema của database kết nối (không app-only allowlist)';
  return {
    mic01Identity: { moduleKey, moduleName: 'Trình xem PostgreSQL chỉ đọc (admin)', moduleVersion: '0.1.0', micStandard: MIC_STANDARD },
    mic02Functions: [
      { functionKey: 'CATALOG', name: 'Danh sách và cấu trúc bảng', description: 'Liệt kê toàn bộ bảng PostgreSQL mọi schema và tra cứu cột, chỉ đọc' },
      { functionKey: 'ROWS', name: 'Xem nội dung bảng', description: 'Đọc các trang dữ liệu bảng có sẵn SQL SELECT, không thay đổi dữ liệu' },
    ],
    mic03Actions: [
      { functionKey: 'CATALOG', actionKey: 'READ', name: 'Xem danh sách và cột', nature: 'READ' },
      { functionKey: 'ROWS', actionKey: 'READ', name: 'Xem các dòng dữ liệu', nature: 'READ' },
    ],
    mic04Navigation: [
      { menuLabel: 'Trình xem PostgreSQL', routePath: '/data-inspector', screenKey: 'data.inspector', functionKey: 'CATALOG' },
    ],
    mic05Api: [
      { method: 'GET', path: '/api/data-inspector/tables', functionKey: 'CATALOG', actionKey: 'READ', errors: ['SESSION_INVALID', 'FORBIDDEN', 'SERVICE_BUSY', 'QUERY_TIMEOUT'] },
      {
        method: 'GET', path: '/api/data-inspector/tables/{tableKey}/columns', functionKey: 'CATALOG', actionKey: 'READ',
        errors: ['SESSION_INVALID', 'FORBIDDEN', 'TABLE_NOT_FOUND', 'CATALOG_CHANGED', 'SERVICE_BUSY'],
      },
      {
        method: 'GET', path: '/api/data-inspector/tables/{tableKey}/rows', functionKey: 'ROWS', actionKey: 'READ',
        errors: ['SESSION_INVALID', 'FORBIDDEN', 'VALIDATION_ERROR', 'TABLE_NOT_FOUND', 'TABLE_NOT_READABLE', 'CATALOG_CHANGED', 'QUERY_TIMEOUT', 'SERVICE_BUSY'],
      },
    ],
    mic06DataResources: [
      {
        resourceKey: 'TABLE_CATALOG', ownerKey: moduleKey, interfaceKind: 'API',
        columns: [
          tableKeyColumn('Khóa bảng do backend sinh, không phải chứng chỉ quyền truy cập'),
          { name: 'schema_name', type: 'text', required: true, description: allSchemas },
          { name: 'table_name', type: 'text', required: true, description: allSchemas },
          { name: 'read_status', type: 'text', required: true, description: 'Trạng thái khả năng đọc thực tế theo SQL privileges/RLS, không cấp quyền mới' },
        ],
        relations: [],
        access: access('CATALOG'),
      },
      {
        resourceKey: 'COLUMN_CATALOG', ownerKey: moduleKey, interfaceKind: 'API',
        columns: [
          tableKeyColumn('Khóa bảng được kiểm tra lại'),
          { name: 'columns', type: 'jsonb', required: true, description: 'Metadata cột tất cả bảng theo pg_catalog, chỉ đọc' },
        ],
        relations: [],
        access: access('CATALOG'),
      },
      {
        resourceKey: 'TABLE_PAGE', ownerKey: moduleKey, interfaceKind: 'API',
        columns: [
          tableKeyColumn('Khóa bảng được kiểm tra lại'),
          { name: 'page', type: 'integer', required: true, description: 'Trang hiện hành' },
          { name: 'page_size', type: 'integer', required: true, description: 'Mặc định 50; tối đa 100' },
          { name: 'rows', type: 'jsonb', required: true, description: 'Giá trị thực tế có quyền SELECT theo current DB role/RLS; không cấp thêm quyền' },
          { name: 'has_next', type: 'boolean', required: true, description: 'Có bản ghi trong trang tiếp theo' },
          { name: 'ordering', type: 'jsonb', required: true, description: 'Chế độ sắp xếp, cảnh báo tính nhất quán' },
        ],
        relations: [],
        access: access('ROWS'),
      },
    ],
    mic07IamMapping: [map('CATALOG', 'READ'), map('ROWS', 'READ')],
    mic08EventsAudit: { eventCodes: [], auditActionCodes: ['DATA_INSPECTOR.CATALOG.READ', 'DATA_INSPECTOR.ROWS.READ', 'DATA_INSPECTOR.ACCESS_DENIED'] },
    mic09Compatibility: {
      kind: 'INITIAL_REGISTRATION',
      changes: ['DRAFT ban đầu của DATA_INSPECTOR, cập nhật yêu cầu 2026-10-22: hardcode username admin, catalog mọi schema, chỉ SELECT. Chưa đăng ký và chưa xác minh lịch sử B02.'],
    },
    mic10Manifest: { manifestVersion: MIC_STANDARD, hashAlgorithm: 'SHA-256', testEvidence },
  };
}
