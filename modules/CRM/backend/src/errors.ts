// CRM API errors. Only the 11 codes of CM-BE-SPEC-REV01 III.8 plus the Host conventions MODULE_UNAVAILABLE / SERVICE_BUSY
// (OD-08 PENDING: no new public code is created in Gate 3). Messages are fixed texts — never SQL, driver messages or values.
//   OD-18b (PROPOSAL, not approved): a write refused by the SUBMITTED-report trigger (SQLSTATE 55000) → CM_VALIDATION_FAILED.

export const CRM_MESSAGES = {
  CM_VALIDATION_FAILED: 'Dữ liệu không hợp lệ. Vui lòng kiểm tra và nhập lại.',
  CM_IDENTITY_DUPLICATE: 'Định danh pháp lý đã tồn tại.',
  CM_CUSTOMER_NOT_FOUND: 'Không tìm thấy hồ sơ hoặc bạn không có quyền xem hồ sơ này.',
  CM_PERMISSION_DENIED: 'Bạn không có quyền thực hiện thao tác này trên hồ sơ này.',
  CM_INVALID_PROVINCE_WARD: 'Phường/xã không thuộc tỉnh/thành đã chọn.',
  CM_REFERENCE_UNAVAILABLE: 'Danh mục bắt buộc chưa khả dụng.',
  CM_DRAFT_NOT_ELIGIBLE: 'Hồ sơ chưa được xác minh (DRAFT), chưa đủ điều kiện cho thao tác này.',
  CM_APPROVAL_REQUIRED: 'Thay đổi thông tin pháp lý phải qua quy trình đề nghị và phê duyệt.',
  CM_HANDOVER_INVALID_STATE: 'Trạng thái bàn giao không cho phép thao tác này.',
  CM_CONCURRENT_UPDATE: 'Dữ liệu đã thay đổi bởi giao dịch khác. Vui lòng tải lại.',
  CM_FILE_INVALID: 'Loại hoặc dung lượng file không hợp lệ.',
  MODULE_UNAVAILABLE: 'Module chưa ACTIVE hoặc chưa bật.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
} as const;

export type CrmErrorCode = keyof typeof CRM_MESSAGES;

export class CrmError extends Error {
  readonly status: number;
  readonly code: CrmErrorCode;
  // Internal only (never rendered): SQLSTATE of the database error this error was mapped from.
  readonly sqlstate: string | undefined;

  // OD-08 (PENDING: no new public error code): the precise business reason travels as `details.reason` under one of the
  // REV01 codes, so the Gate 1 screens keep their message (ApiCrmAdapter maps reason → the mock's code / text).
  reason: string | undefined;

  constructor(status: number, code: CrmErrorCode, sqlstate?: string) {
    super(CRM_MESSAGES[code]);
    this.name = 'CrmError';
    this.status = status;
    this.code = code;
    this.sqlstate = sqlstate;
    this.reason = undefined;
  }
}

// REV01 code + business reason (ALREADY_VERIFIED, ASSIGNMENT_CONFLICT, GROUP_CODE_EXISTS, LEGAL_CHANGE_PENDING,
// LEGAL_CHANGE_INVALID_STATE, PRIMARY_CONTACT_EXISTS, STORAGE_UNAVAILABLE, NOT_DIFFERENT, EVIDENCE_REQUIRED, …).
export function refuse(status: number, code: CrmErrorCode, reason: string): CrmError {
  const e = new CrmError(status, code);
  e.reason = reason;
  return e;
}

export const notFound = () => new CrmError(404, 'CM_CUSTOMER_NOT_FOUND');
export const invalid = () => new CrmError(422, 'CM_VALIDATION_FAILED');
export const denied = () => new CrmError(403, 'CM_PERMISSION_DENIED');

// A database error of a CRM write (already rolled back by the Host) → safe CRM error. Anything the Host raised itself
// (its FoundationError envelope: FORBIDDEN / SERVICE_BUSY) and CrmError pass through unchanged.
export function mapDbError(sqlstate: string | undefined, error: unknown): unknown {
  if (error instanceof CrmError || sqlstate === undefined) return error;
  if (sqlstate === '23514' || sqlstate === '23503' || sqlstate === '23502' || sqlstate === '23505' || sqlstate === '55000' || sqlstate.startsWith('22')) {
    return new CrmError(422, 'CM_VALIDATION_FAILED', sqlstate);
  }
  if (sqlstate === '40001' || sqlstate === '40P01' || sqlstate === '55P03') return new CrmError(409, 'CM_CONCURRENT_UPDATE', sqlstate);
  return error;
}
