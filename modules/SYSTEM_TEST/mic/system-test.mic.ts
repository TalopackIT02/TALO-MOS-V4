import { dataInspectorMic } from './data-inspector.mic.js';
// SYSTEM_TEST 1.2.0: unified diagnostics, runner, read-only inspector and recorded-audit viewer.
// Candidate MIC10 = NOT_TESTED; never activate until TEST evidence and Foundation gates pass.
// Validate MIC09.fromVersion against actual version history on TEST before SUBMIT.
export type MicEvidence = readonly { readonly name: string; readonly result: 'PASS' | 'FAIL' | 'NOT_TESTED'; readonly reference: string }[];
const STANDARD = 'MIC-1.0';
const ERRORS = ['FORBIDDEN', 'MODULE_UNAVAILABLE', 'SERVICE_BUSY'];
export const SYSTEM_TEST_DEFAULT_EVIDENCE: MicEvidence = [
  { name: 'SYSTEM_TEST 1.2 merged diagnostics, inspector and audit acceptance on TEST',
    result: 'NOT_TESTED', reference: 'PENDING: real Foundation integration and runtime acceptance' },
];
export function systemTestMic(moduleKey = 'SYSTEM_TEST', testEvidence: MicEvidence = SYSTEM_TEST_DEFAULT_EVIDENCE) {
  const mapping = (functionKey: string, actionKey: string) => ({ functionKey, actionKey, moduleCode: moduleKey,
    resourceCode: functionKey, operation: actionKey, minimumAssuranceLevel: 1 });
  const inspector = dataInspectorMic(moduleKey, []);
  return {
    mic01Identity: { moduleKey, moduleName: 'System Control Center', moduleVersion: '1.2.0', micStandard: STANDARD },
    mic02Functions: [
      { functionKey: 'DIAGNOSTICS', name: 'System Diagnostics', description: 'Chạy các phép kiểm tra chỉ đọc trên Auth, IAM, PostgreSQL, Foundation và module fleet.' },
      { functionKey: 'TEST_RUNNER', name: 'Test Runner & Results', description: 'Xem kết quả kiểm tra nhanh và Full Regression đã chạy từ CLI an toàn của Host.' },
      ...inspector.mic02Functions,
      { functionKey: 'AUDIT_LOG', name: 'System Audit Logs', description: 'Xem audit Foundation/IAM; admin-only, read-only, báo thiếu quyền theo từng nguồn.' },
    ],
    mic03Actions: [
      { functionKey: 'DIAGNOSTICS', actionKey: 'READ', name: 'Xem và chạy kiểm tra chỉ đọc', nature: 'READ' },
      { functionKey: 'TEST_RUNNER', actionKey: 'EXECUTE', name: 'Xem kết quả test/khởi tạo quick check (không chạy CLI qua API)', nature: 'EXECUTE' },
      ...inspector.mic03Actions,
      { functionKey: 'AUDIT_LOG', actionKey: 'READ', name: 'Xem audit sự kiện', nature: 'READ' },
    ],
    mic04Navigation: [
      { menuLabel: 'System Control Center' },
      { menuLabel: 'System Diagnostics', routePath: '/system-test', screenKey: 'system.test', functionKey: 'DIAGNOSTICS' },
      { menuLabel: 'Test Runner & Results', routePath: '/system-test/runner', screenKey: 'system.test', functionKey: 'TEST_RUNNER' },
      { menuLabel: 'Data Inspector', routePath: '/system-test/data', screenKey: 'system.test', functionKey: 'CATALOG' },
      { menuLabel: 'System Logs', routePath: '/system-test/logs', screenKey: 'system.test', functionKey: 'AUDIT_LOG' },
    ],
    mic05Api: [
      { method: 'GET', path: '/api/system-test/health', functionKey: 'DIAGNOSTICS', actionKey: 'READ', errors: ERRORS },
      { method: 'POST', path: '/api/system-test/checks/run', functionKey: 'DIAGNOSTICS', actionKey: 'READ', errors: ['VALIDATION_ERROR', ...ERRORS] },
      { method: 'GET', path: '/api/system-test/results', functionKey: 'TEST_RUNNER', actionKey: 'EXECUTE', errors: ERRORS },
      ...inspector.mic05Api.map(api => ({...api, path: api.path.replace('/api/data-inspector/', '/api/system-test/data/')})),
      { method: 'GET', path: '/api/system-test/audit/logs', functionKey: 'AUDIT_LOG', actionKey: 'READ', errors: ['VALIDATION_ERROR','FORBIDDEN','SERVICE_BUSY'] },
    ],
    mic06DataResources: [
      { resourceKey: 'SYSTEM_STATUS', interfaceKind: 'API',
        columns: [
          { name: 'component', type: 'text', required: true, primaryKey: true },
          { name: 'status', type: 'text', required: true, description: 'PASS / WARN / FAIL / NOT_TESTED / UNAVAILABLE' },
          { name: 'detail', type: 'text', description: 'Kiểm tra thực tế; không chứa dữ liệu dòng hoặc bí mật' },
          { name: 'checked_at', type: 'timestamptz', required: true },
          { name: 'fleet', type: 'jsonb', description: 'Metadata tóm tắt của các module đã đăng ký; không xác nhận code deploy' },
        ], relations: [],
        access: [{ functionKey: 'DIAGNOSTICS', actionKey: 'READ', operation: 'SELECT', approvalMode: 'NOT_REQUIRED' }],
      },
      { resourceKey: 'TEST_RESULTS', interfaceKind: 'API',
        columns: [
          { name: 'run_id', type: 'text', required: true, primaryKey: true },
          { name: 'suite_key', type: 'text', required: true, primaryKey: true },
          { name: 'status', type: 'text', required: true, description: 'PASS / FAIL / TIMEOUT / NOT_RUN' },
          { name: 'exit_code', type: 'integer' },
          { name: 'duration_ms', type: 'integer', required: true },
          { name: 'finished_at', type: 'timestamptz', required: true },
        ], relations: [],
        access: [{ functionKey: 'TEST_RUNNER', actionKey: 'EXECUTE', operation: 'SELECT', approvalMode: 'NOT_REQUIRED' }],
      },
      ...inspector.mic06DataResources,
      { resourceKey: 'AUDIT_EVENTS', interfaceKind: 'API',
        columns: [
          { name: 'event_id', type: 'text', required: true, primaryKey: true },
          { name: 'occurred_at', type: 'timestamptz', required: true },
          { name: 'source', type: 'text', required: true },
          { name: 'action_code', type: 'text', required: true },
          { name: 'outcome', type: 'text', required: true },
          { name: 'actor_account_id', type: 'text' },
          { name: 'target_type', type: 'text', required: true },
        ], relations: [],
        access: [{ functionKey: 'AUDIT_LOG', actionKey: 'READ', operation: 'SELECT', approvalMode: 'NOT_REQUIRED' }],
      },
    ],
    mic07IamMapping: [mapping('DIAGNOSTICS', 'READ'), mapping('TEST_RUNNER', 'EXECUTE'), ...inspector.mic07IamMapping, mapping('AUDIT_LOG', 'READ')],
    mic08EventsAudit: { eventCodes: [], auditActionCodes: ['SYSTEM_TEST.DIAGNOSTICS.READ', 'SYSTEM_TEST.TEST_RUNNER.EXECUTE', 'SYSTEM_TEST.CATALOG.READ', 'SYSTEM_TEST.ROWS.READ', 'SYSTEM_TEST.AUDIT_LOG.READ', 'SYSTEM_TEST.ACCESS_DENIED'] },
    mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.3', changes: [
      'Mở rộng kiểm tra sức khỏe module fleet, PostgreSQL stats, B08 audit, regression; giao diện drawer và ba mức',
      'Hợp nhất chức năng của DATA_INSPECTOR vào SYSTEM_TEST 1.2.0, thêm tab audit Foundation/IAM và xuất báo cáo TXT',
      'Các chức năng/đường dẫn của DATA_INSPECTOR cũ chỉ được retired sau khi bản mới được nghiệm thu',
    ] },
    mic10Manifest: { manifestVersion: STANDARD, hashAlgorithm: 'SHA-256', testEvidence },
  };
}
