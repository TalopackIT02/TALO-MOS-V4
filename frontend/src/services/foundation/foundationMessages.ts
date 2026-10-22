import type { ApiFailure } from './foundationApi';

// Vietnamese text for Foundation API failures. Only the error code (and the approved detail codes) is used — never the
// server message, SQL or request data. The reference (requestId) is shown for 503 so support can trace the request.

const BY_CODE: Record<string, string> = {
  VALIDATION_ERROR: 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại các trường đã nhập.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  MODULE_NOT_FOUND: 'Không tìm thấy module.',
  VERSION_NOT_FOUND: 'Không tìm thấy phiên bản của module.',
  NAVIGATION_NOT_FOUND: 'Không tìm thấy mục menu.',
  MODULE_KEY_EXISTS: 'Mã module đã tồn tại.',
  VERSION_EXISTS: 'Phiên bản này đã tồn tại trong module.',
  VERSION_NOT_INCREASING: 'Phiên bản mới phải lớn hơn mọi phiên bản hiện có của module.',
  VERSION_NOT_DRAFT: 'Phiên bản không còn ở trạng thái nháp (DRAFT); hồ sơ MIC không thể sửa.',
  VERSION_STATE_CONFLICT: 'Trạng thái hiện tại của phiên bản không cho phép thao tác này.',
  MODULE_STATE_CONFLICT: 'Module đã ở trạng thái được yêu cầu.',
  MANIFEST_HASH_MISMATCH: 'Mã băm hồ sơ MIC không khớp với nội dung trên hệ thống.',
  MIC_INVALID: 'Hồ sơ MIC chưa hợp lệ để nộp xét duyệt.',
  ACTIVATION_BLOCKED: 'Phiên bản chưa đủ điều kiện để kích hoạt.',
  MODULE_ENABLE_BLOCKED: 'Module chưa đủ điều kiện để bật (cần đúng một phiên bản ACTIVE hợp lệ).',
  NAVIGATION_REFERENCE_INVALID: 'Module, Function hoặc menu cha không hợp lệ cho mục menu này.',
  NAVIGATION_CONFLICT: 'Cấu hình điều hướng đã được thay đổi từ khi bạn mở. Tải lại để xem cấu hình mới nhất; bản nháp chưa được lưu.',
  NAVIGATION_LAYOUT_INVALID: 'Cấu hình điều hướng không hợp lệ; không có thay đổi nào được lưu.',
  SESSION_INVALID: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.',
  PASSWORD_CHANGE_REQUIRED: 'Bạn cần đổi mật khẩu trước khi sử dụng hệ thống.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
  ORIGIN_NOT_ALLOWED: 'Yêu cầu không được chấp nhận từ nguồn này.',
  UNEXPECTED_RESPONSE: 'Phản hồi từ máy chủ không đúng định dạng mong đợi.',
};

const BY_STATUS: Record<number, string> = {
  0: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.',
  400: BY_CODE['VALIDATION_ERROR'] ?? '',
  401: BY_CODE['SESSION_INVALID'] ?? '',
  403: BY_CODE['FORBIDDEN'] ?? '',
  404: 'Không tìm thấy dữ liệu yêu cầu.',
  409: 'Dữ liệu đã thay đổi hoặc xung đột với trạng thái hiện tại.',
  422: 'Nghiệp vụ chưa đủ điều kiện để thực hiện.',
  429: BY_CODE['RATE_LIMITED'] ?? '',
  503: BY_CODE['SERVICE_BUSY'] ?? '',
};

export function describeFailure(failure: ApiFailure): string {
  const base = BY_CODE[failure.code] ?? BY_STATUS[failure.status] ?? 'Đã xảy ra lỗi không xác định.';
  const details = failure.details.length > 0 ? ` (${failure.details.join(', ')})` : '';
  const reference = failure.status >= 500 && failure.requestId ? ` Mã tham chiếu: ${failure.requestId}.` : '';
  return `${base}${details}${reference}`;
}
