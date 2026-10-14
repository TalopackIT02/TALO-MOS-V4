// P-11 copy — single source for the auth screens. Every string must stay identical to
// design/auth-b1/AUTH-B1.3-messages-vi.md (checked by tests/e2e copy check).

export const MESSAGES = {
  'LOGIN.MISSING_FIELDS': 'Vui lòng nhập tên đăng nhập và mật khẩu.',
  'LOGIN.LOADING': 'Đang đăng nhập...',
  'LOGIN.VALIDATION_ERROR': 'Thông tin đăng nhập không hợp lệ. Vui lòng kiểm tra và nhập lại.',
  'LOGIN.INVALID_CREDENTIALS': 'Tên đăng nhập hoặc mật khẩu không đúng. Nếu nhập sai nhiều lần, bạn sẽ tạm thời không đăng nhập được trong 15 phút.',
  'LOGIN.ACCOUNT_NOT_ALLOWED': 'Tài khoản này hiện không thể đăng nhập. Vui lòng liên hệ quản trị viên.',
  'LOGIN.SUCCESS': 'Đăng nhập thành công.',
  'LOGIN.PASSWORD_CHANGE_REQUIRED': 'Bạn cần đổi mật khẩu tạm trước khi sử dụng hệ thống.',
  'LOGIN.FORGOT': 'Vui lòng liên hệ quản trị viên để được hỗ trợ cấp lại mật khẩu.',

  'FC.TITLE': 'ĐỔI MẬT KHẨU LẦN ĐẦU',
  'FC.ACCOUNT': 'Tài khoản: {username}',
  'FC.NEW_PLACEHOLDER': 'Mật khẩu mới',
  'FC.CONFIRM_PLACEHOLDER': 'Xác nhận mật khẩu mới',
  'FC.SHOW': 'Hiện mật khẩu',
  'FC.HIDE': 'Ẩn mật khẩu',
  'FC.HINT_TITLE': 'Yêu cầu mật khẩu:',
  'FC.HINT_LENGTH': '15–128 ký tự, được dùng khoảng trắng.',
  'FC.HINT_STATE_OK': '(đạt)',
  'FC.HINT_STATE_FAIL': '(chưa đạt)',
  'FC.HINT_FREE': 'Không bắt buộc chữ hoa, chữ số hay ký tự đặc biệt.',
  'FC.HINT_AVOID': 'Không dùng mật khẩu phổ biến, tên đăng nhập, mã nhân viên, họ tên hoặc tên công ty.',
  'FC.HINT_DIFFERENT': 'Phải khác mật khẩu tạm đã được cấp.',
  'FC.SUBMIT': 'CẬP NHẬT MẬT KHẨU',
  'FC.SUBMITTING': 'ĐANG CẬP NHẬT...',
  'FC.LOGOUT': 'Đăng xuất',
  'FC.BACK_TO_LOGIN': 'QUAY LẠI ĐĂNG NHẬP',
  'FC.EMPTY_NEW': 'Vui lòng nhập mật khẩu mới.',
  'FC.EMPTY_CONFIRM': 'Vui lòng nhập lại mật khẩu mới để xác nhận.',
  'FC.MISMATCH': 'Mật khẩu xác nhận không khớp với mật khẩu mới.',
  'FC.SUCCESS': 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.',
  'FC.VALIDATION_ERROR': 'Dữ liệu mật khẩu không hợp lệ. Vui lòng nhập lại.',
  'FC.NOT_REQUIRED': 'Tài khoản của bạn không cần đổi mật khẩu lần đầu.',
  'FC.SERVICE_BUSY': 'Hệ thống đang bận, mật khẩu chưa được thay đổi. Vui lòng thử lại sau ít phút.',
  'FC.INTERNAL_ERROR': 'Hệ thống gặp lỗi khi cập nhật mật khẩu. Vui lòng thử lại; nếu vẫn lỗi, hãy đăng nhập lại hoặc liên hệ quản trị viên.',

  'POLICY.TOO_SHORT': 'Mật khẩu mới phải có ít nhất 15 ký tự.',
  'POLICY.TOO_LONG': 'Mật khẩu mới không được vượt quá 128 ký tự.',
  'POLICY.TOO_LONG_BYTES': 'Mật khẩu mới quá dài khi lưu trữ. Vui lòng rút ngắn hoặc bớt biểu tượng, ký tự đặc biệt.',
  'POLICY.CONTROL_CHARACTERS': 'Mật khẩu mới chứa ký tự điều khiển không hợp lệ. Vui lòng nhập lại.',
  'POLICY.BLOCKLISTED': 'Mật khẩu này quá phổ biến hoặc dễ đoán. Vui lòng chọn mật khẩu khác.',
  'POLICY.CONTEXT_MATCH': 'Mật khẩu không được trùng với tên đăng nhập, mã nhân viên, họ tên hoặc tên công ty.',
  'POLICY.SAME_AS_CURRENT': 'Mật khẩu mới phải khác mật khẩu tạm hiện tại.',
  'POLICY.UNKNOWN': 'Mật khẩu mới chưa đáp ứng yêu cầu. Vui lòng chọn mật khẩu khác.',

  'SESSION.ACTIVATION_REMAINING': 'Thời gian còn lại để đổi mật khẩu: {n} phút.',
  'SESSION.ACTIVATION_REMAINING_LT1': 'Thời gian còn lại để đổi mật khẩu: dưới 1 phút.',
  'SESSION.ACTIVATION_EXPIRED': 'Phiên đổi mật khẩu đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.',
  'SESSION.INVALID': 'Phiên đăng nhập đã hết hạn hoặc không còn hiệu lực. Vui lòng đăng nhập lại.',
  'SESSION.PASSWORD_CHANGE_REQUIRED': 'Bạn cần đổi mật khẩu trước khi tiếp tục.',

  'LOGOUT.LOADING': 'Đang đăng xuất...',
  'LOGOUT.DONE': 'Bạn đã đăng xuất.',
  'LOGOUT.FAILED': 'Không xác nhận được việc đăng xuất với máy chủ. Nếu bạn dùng máy tính chung, hãy đóng trình duyệt.',

  'COMMON.RATE_LIMITED': 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng chờ ít phút rồi thử lại.',
  'COMMON.SERVICE_BUSY': 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
  'COMMON.INTERNAL_ERROR': 'Hệ thống gặp lỗi và chưa xử lý được yêu cầu. Vui lòng thử lại sau hoặc liên hệ quản trị viên.',
  'COMMON.REQUEST_INVALID': 'Yêu cầu không hợp lệ. Vui lòng tải lại trang và thử lại.',
  'COMMON.NETWORK': 'Không kết nối được máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.',
  'COMMON.REFERENCE': 'Mã tham chiếu: {requestId}',

  'WELCOME.TITLE': 'ĐĂNG NHẬP THÀNH CÔNG',
  'WELCOME.GREETING': 'Xin chào, {fullName}.',
  'WELCOME.NOTE': 'Bạn đã đăng nhập vào hệ thống TALO-MOS. Các phân hệ nghiệp vụ sẽ được bổ sung ở giai đoạn sau.',
  'WELCOME.LOGOUT': 'ĐĂNG XUẤT',
} as const;

export type MessageId = keyof typeof MESSAGES;

export function t(id: MessageId, vars: Record<string, string | number> = {}): string {
  return MESSAGES[id].replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}
