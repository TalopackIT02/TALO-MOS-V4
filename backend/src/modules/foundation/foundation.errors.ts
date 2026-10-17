// Foundation API errors (FBE-01A). Messages are fixed texts: never SQL, driver messages or request values.

export const FOUNDATION_MESSAGES = {
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  VALIDATION_ERROR: 'Thông tin gửi lên không hợp lệ. Vui lòng kiểm tra và nhập lại.',
  MODULE_KEY_EXISTS: 'Mã module đã tồn tại.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
  // FBE-02A — Module Version.
  MODULE_NOT_FOUND: 'Không tìm thấy module.',
  VERSION_NOT_FOUND: 'Không tìm thấy phiên bản của module.',
  VERSION_EXISTS: 'Phiên bản này đã tồn tại trong module.',
  VERSION_NOT_INCREASING: 'Phiên bản mới phải lớn hơn mọi phiên bản hiện có của module.',
  // FBE-02B — MIC manifest / SUBMIT.
  VERSION_NOT_DRAFT: 'Phiên bản không còn ở trạng thái nháp (DRAFT).',
  MIC_INVALID: 'Hồ sơ MIC chưa hợp lệ để nộp xét duyệt.',
  MANIFEST_HASH_MISMATCH: 'Mã băm hồ sơ MIC không khớp với nội dung trên hệ thống.',
} as const;

export type FoundationErrorCode = keyof typeof FOUNDATION_MESSAGES;

export interface ValidationDetails {
  readonly fields: readonly string[];
}

// MIC_INVALID (422): the approved validation error codes only — never MIC content.
export interface MicErrorDetails {
  readonly errors: readonly string[];
}

export type ErrorDetails = ValidationDetails | MicErrorDetails;

export class FoundationError extends Error {
  readonly status: number;
  readonly code: FoundationErrorCode;
  readonly details: ErrorDetails | undefined;

  constructor(status: number, code: FoundationErrorCode, options: { details?: ErrorDetails } = {}) {
    super(FOUNDATION_MESSAGES[code]);
    this.name = 'FoundationError';
    this.status = status;
    this.code = code;
    this.details = options.details;
  }
}

export const forbidden = () => new FoundationError(403, 'FORBIDDEN');
export const serviceBusy = () => new FoundationError(503, 'SERVICE_BUSY');

// Raised inside the register transaction when INSERT B01 hits uq_fnd_modules_module_key (23505); the transaction
// is rolled back by the throw and the router answers 409.
export class DuplicateModuleKeyError extends Error {
  constructor() {
    super('module_key already exists');
    this.name = 'DuplicateModuleKeyError';
  }
}
