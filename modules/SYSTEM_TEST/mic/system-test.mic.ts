// SYSTEM_TEST 1.1.0: CHANGE of existing 1.0.0, no data viewer.
// MIC must be reviewed and submitted through Foundation separately; loading the source does not update B02/MIC/B09/IAM.
export type MicEvidence = readonly { readonly name: string; readonly result: 'PASS' | 'FAIL' | 'NOT_TESTED'; readonly reference: string }[];
const STANDARD = 'MIC-1.0';
const ERRORS = ['FORBIDDEN', 'MODULE_UNAVAILABLE', 'SERVICE_BUSY'];
export const SYSTEM_TEST_DEFAULT_EVIDENCE: MicEvidence = [
  { name: 'SYSTEM_TEST 1.1 Host, IAM, navigation, diagnostic runtime and frontend TEST acceptance',
    result: 'NOT_TESTED', reference: 'PENDING: real Foundation integration and runtime acceptance' },
];
export function systemTestMic(moduleKey = 'SYSTEM_TEST', testEvidence: MicEvidence = SYSTEM_TEST_DEFAULT_EVIDENCE) {
  const mapping = (functionKey: string, actionKey: string) => ({ functionKey, actionKey, moduleCode: moduleKey,
    resourceCode: functionKey, operation: actionKey, minimumAssuranceLevel: 1 });
  return {
    mic01Identity: { moduleKey, moduleName: 'System Test & Diagnostics', moduleVersion: '1.1.0', micStandard: STANDARD },
    mic02Functions: [
      { functionKey: 'DIAGNOSTICS', name: 'System Diagnostics', description: 'Chạy các phép kiểm tra chỉ đọc trên Auth, IAM, PostgreSQL, Foundation và module fleet.' },
      { functionKey: 'TEST_RUNNER', name: 'Test Runner & Results', description: 'Xem kết quả kiểm tra nhanh và Full Regression đã chạy từ CLI an toàn của Host.' },
    ],
    mic03Actions: [
      { functionKey: 'DIAGNOSTICS', actionKey: 'READ', name: 'Xem và chạy kiểm tra chỉ đọc', nature: 'READ' },
      { functionKey: 'TEST_RUNNER', actionKey: 'EXECUTE', name: 'Xem kết quả test/khởi tạo quick check (không chạy CLI qua API)', nature: 'EXECUTE' },
    ],
    mic04Navigation: [
      { menuLabel: 'System Test & Diagnostics' },
      { menuLabel: 'System Diagnostics', routePath: '/system-test', screenKey: 'system.test', functionKey: 'DIAGNOSTICS' },
      { menuLabel: 'Test Runner & Results', routePath: '/system-test/runner', screenKey: 'system.test', functionKey: 'TEST_RUNNER' },
    ],
    mic05Api: [
      { method: 'GET', path: '/api/system-test/health', functionKey: 'DIAGNOSTICS', actionKey: 'READ', errors: ERRORS },
      { method: 'POST', path: '/api/system-test/checks/run', functionKey: 'DIAGNOSTICS', actionKey: 'READ', errors: ['VALIDATION_ERROR', ...ERRORS] },
      { method: 'GET', path: '/api/system-test/results', functionKey: 'TEST_RUNNER', actionKey: 'EXECUTE', errors: ERRORS },
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
    ],
    mic07IamMapping: [mapping('DIAGNOSTICS', 'READ'), mapping('TEST_RUNNER', 'EXECUTE')],
    mic08EventsAudit: { eventCodes: [], auditActionCodes: ['SYSTEM_TEST.DIAGNOSTICS.READ', 'SYSTEM_TEST.TEST_RUNNER.EXECUTE'] },
    mic09Compatibility: { kind: 'CHANGE', fromVersion: '1.0.0', changes: [
      'Loại bỏ chức năng DATA_VIEWER và các API bảng; chỉ giữ chẩn đoán và đọc kết quả test',
      'Mở rộng kiểm tra sức khỏe module fleet, PostgreSQL stats, B08 audit, regression; giao diện drawer và ba mức',
    ] },
    mic10Manifest: { manifestVersion: STANDARD, hashAlgorithm: 'SHA-256', testEvidence },
  };
}
