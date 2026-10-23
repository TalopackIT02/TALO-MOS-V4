// Reusable data declarations imported from DATA_INSPECTOR 0.1.0 (INITIAL_REGISTRATION), the content of spec v0.2 file 08-MIC-1.0.json. It is
// submitted through the Foundation API (PUT manifest → SUBMIT) by an authorised operator; the runtime never reads this
// file and loading the package registers nothing. `moduleKey` is a parameter only so that tests can build the same MIC
// under a fixture key; the K05 mapping always follows the key (moduleCode = moduleKey, resourceCode = functionKey,
// operation = actionKey). MIC-10 evidence is supplied by the caller: only results of test runs that really passed may be
// recorded as PASS; the default is the spec's NOT_TESTED, which keeps the activation gate closed.
// Self-contained (no Host import); the Host validates it with its own MIC-1.0 validator at PUT / SUBMIT.

const MIC_STANDARD = 'MIC-1.0';

export type MicEvidence = readonly { readonly name: string; readonly result: 'PASS' | 'FAIL' | 'NOT_TESTED'; readonly reference: string }[];
const DATA_INSPECTOR_DEFAULT_EVIDENCE: MicEvidence = [];

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
