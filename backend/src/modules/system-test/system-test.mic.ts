import { MIC_STANDARD } from '../foundation/foundation.mic.js';
import type { Mic } from '../foundation/foundation.mic.js';

// MOD-TEST-01 — MIC-1.0 of SYSTEM_TEST 1.0.0 (INITIAL_REGISTRATION). It is submitted through the Foundation API (PUT
// manifest → SUBMIT); the runtime never reads this file — diagnostics read the stored manifest of the ACTIVE version.
// `moduleKey` is a parameter only so that integration tests can register the same MIC under a fixture key; the K05
// mapping always follows the key (moduleCode = moduleKey, resourceCode = functionKey, operation = actionKey).
// MIC-10 evidence is supplied by the caller: only results of test runs that really passed may be recorded as PASS.

export type MicEvidence = Mic['mic10Manifest']['testEvidence'];

const ERRORS = ['FORBIDDEN', 'MODULE_UNAVAILABLE', 'SERVICE_BUSY'];

export function systemTestMic(moduleKey: string, testEvidence: MicEvidence): Mic {
  const map = (functionKey: string, actionKey: string) => ({ functionKey, actionKey, moduleCode: moduleKey, resourceCode: functionKey, operation: actionKey, minimumAssuranceLevel: 1 });
  return {
    mic01Identity: { moduleKey, moduleName: 'System Test & Diagnostics', moduleVersion: '1.0.0', micStandard: MIC_STANDARD },
    mic02Functions: [
      { functionKey: 'DIAGNOSTICS', name: 'Kiểm tra hệ thống', description: 'Xem trạng thái hệ thống và chạy kiểm tra nhanh chỉ đọc.' },
      { functionKey: 'DATA_VIEWER', name: 'Xem bảng dữ liệu', description: 'Xem danh sách bảng Foundation B01–B14 và dữ liệu chỉ đọc theo danh sách cho phép.' },
      { functionKey: 'TEST_RUNNER', name: 'Chạy test & xem kết quả', description: 'Xem kết quả kiểm tra nhanh và Full Regression do runner TEST cục bộ ghi lại.' },
    ],
    mic03Actions: [
      { functionKey: 'DIAGNOSTICS', actionKey: 'READ', name: 'Xem chẩn đoán', nature: 'READ' },
      { functionKey: 'DATA_VIEWER', actionKey: 'READ', name: 'Xem dữ liệu', nature: 'READ' },
      { functionKey: 'TEST_RUNNER', actionKey: 'EXECUTE', name: 'Chạy và xem kết quả kiểm thử', nature: 'EXECUTE' },
    ],
    mic04Navigation: [
      { menuLabel: 'System Test & Diagnostics' },
      { menuLabel: 'Kiểm tra hệ thống', routePath: '/system-test', screenKey: 'system.test', functionKey: 'DIAGNOSTICS' },
      { menuLabel: 'Xem bảng dữ liệu', routePath: '/system-test/data', screenKey: 'system.test.data', functionKey: 'DATA_VIEWER' },
      { menuLabel: 'Chạy test & xem kết quả', routePath: '/system-test/runner', screenKey: 'system.test.runner', functionKey: 'TEST_RUNNER' },
    ],
    mic05Api: [
      { method: 'GET', path: '/api/system-test/health', functionKey: 'DIAGNOSTICS', actionKey: 'READ', errors: ERRORS },
      { method: 'POST', path: '/api/system-test/checks/run', functionKey: 'DIAGNOSTICS', actionKey: 'READ', errors: ['VALIDATION_ERROR', ...ERRORS] },
      { method: 'GET', path: '/api/system-test/tables', functionKey: 'DATA_VIEWER', actionKey: 'READ', errors: ERRORS },
      {
        method: 'GET', path: '/api/system-test/tables/{tableKey}/rows', functionKey: 'DATA_VIEWER', actionKey: 'READ',
        errors: ['VALIDATION_ERROR', 'TABLE_NOT_FOUND', 'TABLE_NOT_READABLE', ...ERRORS],
      },
      { method: 'GET', path: '/api/system-test/results', functionKey: 'TEST_RUNNER', actionKey: 'EXECUTE', errors: ERRORS },
    ],
    mic06DataResources: [
      {
        resourceKey: 'SYSTEM_STATUS', interfaceKind: 'API',
        columns: [
          { name: 'component', type: 'text', required: true, primaryKey: true, description: 'Thành phần được kiểm tra' },
          { name: 'status', type: 'text', required: true, description: 'PASS / FAIL / NOT_TESTED / UNAVAILABLE' },
          { name: 'detail', type: 'text', description: 'Kết quả thực tế của phép kiểm tra' },
          { name: 'checked_at', type: 'timestamptz', required: true },
        ],
        relations: [],
        access: [{ functionKey: 'DIAGNOSTICS', actionKey: 'READ', operation: 'SELECT', approvalMode: 'NOT_REQUIRED' }],
      },
      {
        resourceKey: 'TABLE_PREVIEW', interfaceKind: 'API',
        columns: [
          { name: 'table_key', type: 'text', required: true, primaryKey: true, description: 'B01…B14, theo danh sách cho phép phía máy chủ' },
          { name: 'page', type: 'integer', required: true },
          { name: 'page_size', type: 'integer', required: true, description: 'Mặc định 50, tối đa 100' },
          { name: 'total_rows', type: 'integer', required: true },
          { name: 'rows', type: 'jsonb', required: true, description: 'Giá trị các cột được phép, dạng văn bản' },
        ],
        relations: [],
        access: [{ functionKey: 'DATA_VIEWER', actionKey: 'READ', operation: 'SELECT', approvalMode: 'NOT_REQUIRED' }],
      },
      {
        resourceKey: 'TEST_RESULTS', interfaceKind: 'API',
        columns: [
          { name: 'run_id', type: 'text', required: true, primaryKey: true },
          { name: 'suite_key', type: 'text', required: true, primaryKey: true },
          { name: 'status', type: 'text', required: true, description: 'PASS / FAIL / TIMEOUT / NOT_RUN' },
          { name: 'exit_code', type: 'integer' },
          { name: 'duration_ms', type: 'integer', required: true },
          { name: 'finished_at', type: 'timestamptz', required: true },
        ],
        relations: [],
        access: [{ functionKey: 'TEST_RUNNER', actionKey: 'EXECUTE', operation: 'SELECT', approvalMode: 'NOT_REQUIRED' }],
      },
    ],
    mic07IamMapping: [map('DIAGNOSTICS', 'READ'), map('DATA_VIEWER', 'READ'), map('TEST_RUNNER', 'EXECUTE')],
    mic08EventsAudit: { eventCodes: [], auditActionCodes: ['SYSTEM_TEST.DIAGNOSTICS.READ', 'SYSTEM_TEST.DATA_VIEWER.READ', 'SYSTEM_TEST.TEST_RUNNER.EXECUTE'] },
    mic09Compatibility: { kind: 'INITIAL_REGISTRATION', changes: ['Đăng ký lần đầu Module SYSTEM_TEST 1.0.0'] },
    mic10Manifest: { manifestVersion: MIC_STANDARD, hashAlgorithm: 'SHA-256', testEvidence },
  };
}
