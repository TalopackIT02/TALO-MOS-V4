// FBE-02B — a complete, valid MIC-1.0 manifest (P-16) for tests. Every call returns a fresh object.
export function validMic(moduleKey = 'SALES', moduleVersion = '1.0.0') {
  return {
    mic01Identity: { moduleKey, moduleName: 'Bán hàng', moduleVersion, micStandard: 'MIC-1.0' },
    mic02Functions: [
      { functionKey: 'ORDER', name: 'Đơn hàng', description: 'Quản lý đơn hàng bán' },
      { functionKey: 'REPORT', name: 'Báo cáo' },
    ],
    mic03Actions: [
      { functionKey: 'ORDER', actionKey: 'READ', name: 'Xem đơn hàng', nature: 'READ' },
      { functionKey: 'ORDER', actionKey: 'CREATE', name: 'Tạo đơn hàng', nature: 'WRITE' },
      { functionKey: 'REPORT', actionKey: 'READ', name: 'Xem báo cáo', nature: 'READ' },
    ],
    mic04Navigation: [
      { menuLabel: 'Bán hàng' },
      { menuLabel: 'Đơn hàng', routePath: '/sales/orders', screenKey: 'sales.orders', functionKey: 'ORDER' },
    ],
    mic05Api: [
      { method: 'GET', path: '/api/sales/orders', functionKey: 'ORDER', actionKey: 'READ', errors: [] },
      { method: 'POST', path: '/api/sales/orders', functionKey: 'ORDER', actionKey: 'CREATE', errors: ['VALIDATION_ERROR'] },
    ],
    mic06DataResources: [
      { interfaceKind: 'API', columns: [], relations: [] },
      { interfaceKind: 'DIRECT_DB', schema: 'sales', table: 'orders', columns: ['order_id', 'customer_id'], relations: ['customer_id -> crm.customers.customer_id'] },
    ],
    mic07IamMapping: [
      { functionKey: 'ORDER', actionKey: 'READ', moduleCode: moduleKey, resourceCode: 'ORDER', operation: 'READ', minimumAssuranceLevel: 1 },
      { functionKey: 'ORDER', actionKey: 'CREATE', moduleCode: moduleKey, resourceCode: 'ORDER', operation: 'CREATE', minimumAssuranceLevel: 1 },
      { functionKey: 'REPORT', actionKey: 'READ', moduleCode: moduleKey, resourceCode: 'REPORT', operation: 'READ', minimumAssuranceLevel: 1 },
    ],
    mic08EventsAudit: { eventCodes: ['SALES_ORDER_CREATED'], auditActionCodes: ['SALES.ORDER.CREATE'] },
    mic09Compatibility: { kind: 'INITIAL_REGISTRATION', changes: [] },
    mic10Manifest: {
      manifestVersion: 'MIC-1.0',
      hashAlgorithm: 'SHA-256',
      testEvidence: [{ name: 'Unit tests', result: 'PASS', reference: 'CI run 1' }],
    },
  };
}
