// Foundation API errors (FBE-01A). Messages are fixed texts: never SQL, driver messages or request values.

export const FOUNDATION_MESSAGES = {
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  VALIDATION_ERROR: 'Thông tin gửi lên không hợp lệ. Vui lòng kiểm tra và nhập lại.',
  MODULE_KEY_EXISTS: 'Mã module đã tồn tại.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
} as const;

export type FoundationErrorCode = keyof typeof FOUNDATION_MESSAGES;

export interface ValidationDetails {
  readonly fields: readonly string[];
}

export class FoundationError extends Error {
  readonly status: number;
  readonly code: FoundationErrorCode;
  readonly details: ValidationDetails | undefined;

  constructor(status: number, code: FoundationErrorCode, options: { details?: ValidationDetails } = {}) {
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
