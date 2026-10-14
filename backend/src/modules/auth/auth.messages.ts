// Server-side `error.message` texts (P-11, design/auth-b1/AUTH-B1.3-messages-vi.md). The UI chooses its own text from
// `error.code`; these keep the envelope readable. INVALID_CREDENTIALS has exactly one text for every branch (INV-10).

export const AUTH_MESSAGES = {
  VALIDATION_ERROR: 'Thông tin gửi lên không hợp lệ. Vui lòng kiểm tra và nhập lại.',
  INVALID_CREDENTIALS:
    'Tên đăng nhập hoặc mật khẩu không đúng. Nếu nhập sai nhiều lần, bạn sẽ tạm thời không đăng nhập được trong 15 phút.',
  ACCOUNT_NOT_ALLOWED: 'Tài khoản này hiện không thể đăng nhập. Vui lòng liên hệ quản trị viên.',
  SESSION_INVALID: 'Phiên làm việc đã hết hạn hoặc không còn hiệu lực. Vui lòng đăng nhập lại.',
  PASSWORD_CHANGE_REQUIRED: 'Bạn cần đổi mật khẩu trước khi tiếp tục.',
  NOT_REQUIRED: 'Tài khoản của bạn không cần đổi mật khẩu lần đầu.',
  PASSWORD_POLICY: 'Mật khẩu mới chưa đáp ứng yêu cầu.',
  RATE_LIMITED: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng chờ ít phút rồi thử lại.',
  SERVICE_BUSY: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
} as const;
