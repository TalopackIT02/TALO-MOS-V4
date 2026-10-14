# AUTH-B1.3 — Bảng câu chữ tiếng Việt (P-11) và mapping mã lỗi API → thông báo UI

**Trạng thái:** đã chấp thuận có điều kiện tại UI Design Acceptance (quyết định 2–4: màu cảnh báo cho 429/503, “Mã
tham chiếu” chỉ cho 500/503, câu 401 chung có cảnh báo giới hạn); chờ Visual UI Review. Nguồn hợp đồng: `backend/src/modules/auth/AUTH-API-v1.md`
và `AUTH-API-v1.yaml` (AUTH-B1.1 đã nghiệm thu). Bảng này là nguồn câu chữ duy nhất cho Login, Đổi mật khẩu lần đầu,
phiên làm việc và Đăng xuất; demo `first-change-demo.html` dùng nguyên văn các chuỗi có mã `FC.*`, `POLICY.*`,
`SESSION.*`, `LOGOUT.*`, `COMMON.*` bên dưới.

## 0. Nguyên tắc

1. **Không tiết lộ trạng thái nội bộ khi chưa xác thực.** Mọi thất bại `401 INVALID_CREDENTIALS` dùng **một** câu duy
   nhất (INV-10): không nói tài khoản có tồn tại, bị khóa, hết lượt hay chưa có mật khẩu.
2. `403 ACCOUNT_NOT_ALLOWED` chỉ xảy ra sau khi mật khẩu đúng (SC-7), nhưng câu chữ **không** nêu lý do Account /
   Membership (đã nghỉ việc, vô hiệu hóa, khóa, ngày nghỉ…): chỉ hướng dẫn liên hệ quản trị viên.
3. UI chọn câu theo `error.code` (và `details.reason` với `PASSWORD_POLICY`). `error.message` của server không hiển thị
   trực tiếp; mã lý do audit không bao giờ tới client.
4. `requestId` chỉ hiển thị dạng “Mã tham chiếu” cho `INTERNAL_ERROR` và `SERVICE_BUSY` (giúp hỗ trợ kỹ thuật); không
   hiển thị cho lỗi đăng nhập để giao diện các nhánh 401 hoàn toàn giống nhau.
5. Không đưa thời gian chờ cụ thể vào `RATE_LIMITED` (API không có `Retry-After`, ngưỡng production còn PENDING).
6. Câu ngắn, xưng “bạn”, kết thúc bằng dấu chấm; tiêu đề/nút viết HOA như màn Login Phase A.
7. Màu chữ trạng thái trên màn Đổi mật khẩu lần đầu (đo tương phản thực tế, xem `AUTH-B1-color-accessibility.md`):
   lỗi / chưa đạt `#ad3939`; cảnh báo `#8a4b00` trên nền `#fff8ec` cho `429`, `503` và thời gian còn lại ≤ 2 phút;
   thành công / đạt `#076b38`; hướng dẫn, thông tin, mã tham chiếu `#4b5563`. Mọi màu này ≥ 4,5:1 trên nền thực tế.

## 1. Nhãn giao diện — Đổi mật khẩu lần đầu

| Mã | Câu chữ |
|---|---|
| `FC.TITLE` | ĐỔI MẬT KHẨU LẦN ĐẦU |
| `FC.ACCOUNT` | Tài khoản: {username} |
| `FC.NEW_PLACEHOLDER` | Mật khẩu mới |
| `FC.CONFIRM_PLACEHOLDER` | Xác nhận mật khẩu mới |
| `FC.SHOW` / `FC.HIDE` | Hiện mật khẩu / Ẩn mật khẩu (aria-label của nút mắt) |
| `FC.HINT_TITLE` | Yêu cầu mật khẩu: |
| `FC.HINT_LENGTH` | 15–128 ký tự, được dùng khoảng trắng. |
| `FC.HINT_FREE` | Không bắt buộc chữ hoa, chữ số hay ký tự đặc biệt. |
| `FC.HINT_AVOID` | Không dùng mật khẩu phổ biến, tên đăng nhập, mã nhân viên, họ tên hoặc tên công ty. |
| `FC.HINT_DIFFERENT` | Phải khác mật khẩu tạm đã được cấp. |
| `FC.HINT_STATE_OK` | (đạt) |
| `FC.HINT_STATE_FAIL` | (chưa đạt) |
| `FC.SUBMIT` | CẬP NHẬT MẬT KHẨU |
| `FC.SUBMITTING` | ĐANG CẬP NHẬT... |
| `FC.LOGOUT` | Đăng xuất |
| `FC.BACK_TO_LOGIN` | QUAY LẠI ĐĂNG NHẬP |

`FC.HINT_STATE_OK` / `FC.HINT_STATE_FAIL` chỉ dành cho screen reader (ẩn trên màn hình), nối sau `FC.HINT_LENGTH`;
trên màn hình trạng thái thể hiện bằng ký hiệu và màu (AUTH-B1.2 §3.1).

## 2. Đăng nhập (`POST /api/auth/login`)

| Mã | Khi nào | Câu chữ |
|---|---|---|
| `LOGIN.MISSING_FIELDS` | client: thiếu tên đăng nhập hoặc mật khẩu (giữ nguyên câu của Phase A) | Vui lòng nhập tên đăng nhập và mật khẩu. |
| `LOGIN.LOADING` | đang gửi | Đang đăng nhập... |
| `LOGIN.VALIDATION_ERROR` | `400 VALIDATION_ERROR` (độ dài, ký tự điều khiển, sai kiểu) | Thông tin đăng nhập không hợp lệ. Vui lòng kiểm tra và nhập lại. |
| `LOGIN.INVALID_CREDENTIALS` | `401 INVALID_CREDENTIALS` — **mọi** nhánh (sai tên, sai mật khẩu, đang tạm khóa, hết lượt…) | Tên đăng nhập hoặc mật khẩu không đúng. Nếu nhập sai nhiều lần, bạn sẽ tạm thời không đăng nhập được trong 15 phút. |
| `LOGIN.ACCOUNT_NOT_ALLOWED` | `403 ACCOUNT_NOT_ALLOWED` | Tài khoản này hiện không thể đăng nhập. Vui lòng liên hệ quản trị viên. |
| `LOGIN.SUCCESS` | `200 AUTHENTICATED` (AD-9 N1: trạng thái thử nghiệm, ở lại màn Login) | Đăng nhập thành công. |
| `LOGIN.PASSWORD_CHANGE_REQUIRED` | `200 PASSWORD_CHANGE_REQUIRED` → chuyển sang màn Đổi mật khẩu lần đầu | Bạn cần đổi mật khẩu tạm trước khi sử dụng hệ thống. |
| `LOGIN.FORGOT` | nhấn “Quên mật khẩu?” (AD-8 F1) | Vui lòng liên hệ quản trị viên để được hỗ trợ cấp lại mật khẩu. |

Câu `LOGIN.INVALID_CREDENTIALS` chỉ nêu chính sách chung (AD-5), giống hệt nhau cho mọi tài khoản — không tiết lộ tài
khoản nào đang bị khóa.

## 3. Đổi mật khẩu lần đầu (`POST /api/auth/password/first-change`)

### 3.1 Kiểm tra phía client (trước khi gửi)

| Mã | Điều kiện | Câu chữ |
|---|---|---|
| `FC.EMPTY_NEW` | ô mật khẩu mới trống | Vui lòng nhập mật khẩu mới. |
| `FC.EMPTY_CONFIRM` | ô xác nhận trống | Vui lòng nhập lại mật khẩu mới để xác nhận. |
| `FC.MISMATCH` | hai ô khác nhau sau NFC (D-UI-1) | Mật khẩu xác nhận không khớp với mật khẩu mới. |

Client cũng kiểm tra trước các luật **không cần dữ liệu server** (độ dài code point sau NFC, số byte UTF-8, ký tự điều
khiển) và dùng đúng câu `POLICY.*` tương ứng. Blocklist, contextual và `SAME_AS_CURRENT` chỉ server kiểm tra.

### 3.2 Lỗi chính sách mật khẩu — `400 PASSWORD_POLICY`, theo `details.reason`

| `details.reason` | Mã | Câu chữ |
|---|---|---|
| `TOO_SHORT` | `POLICY.TOO_SHORT` | Mật khẩu mới phải có ít nhất 15 ký tự. |
| `TOO_LONG` | `POLICY.TOO_LONG` | Mật khẩu mới không được vượt quá 128 ký tự. |
| `TOO_LONG_BYTES` | `POLICY.TOO_LONG_BYTES` | Mật khẩu mới quá dài khi lưu trữ. Vui lòng rút ngắn hoặc bớt biểu tượng, ký tự đặc biệt. |
| `CONTROL_CHARACTERS` | `POLICY.CONTROL_CHARACTERS` | Mật khẩu mới chứa ký tự điều khiển không hợp lệ. Vui lòng nhập lại. |
| `BLOCKLISTED` | `POLICY.BLOCKLISTED` | Mật khẩu này quá phổ biến hoặc dễ đoán. Vui lòng chọn mật khẩu khác. |
| `CONTEXT_MATCH` | `POLICY.CONTEXT_MATCH` | Mật khẩu không được trùng với tên đăng nhập, mã nhân viên, họ tên hoặc tên công ty. |
| `SAME_AS_CURRENT` | `POLICY.SAME_AS_CURRENT` | Mật khẩu mới phải khác mật khẩu tạm hiện tại. |
| (reason không xác định) | `POLICY.UNKNOWN` | Mật khẩu mới chưa đáp ứng yêu cầu. Vui lòng chọn mật khẩu khác. |

Không câu nào nêu mục blocklist bị trùng (AUTH-API-v1 §5.3).

### 3.3 Kết quả và lỗi khác

| Mã | HTTP / code | Câu chữ |
|---|---|---|
| `FC.SUCCESS` | `200 PASSWORD_CHANGED_RELOGIN` (D-B1-1: phải đăng nhập lại) | Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới. |
| `FC.VALIDATION_ERROR` | `400 VALIDATION_ERROR` | Dữ liệu mật khẩu không hợp lệ. Vui lòng nhập lại. |
| `FC.NOT_REQUIRED` | `403 NOT_REQUIRED` | Tài khoản của bạn không cần đổi mật khẩu lần đầu. |
| `FC.SERVICE_BUSY` | `503 SERVICE_BUSY` (hàng đợi hash hoặc hết lượt retry — mật khẩu chưa đổi) | Hệ thống đang bận, mật khẩu chưa được thay đổi. Vui lòng thử lại sau ít phút. |
| `FC.INTERNAL_ERROR` | `500 INTERNAL_ERROR` | Hệ thống gặp lỗi khi cập nhật mật khẩu. Vui lòng thử lại; nếu vẫn lỗi, hãy đăng nhập lại hoặc liên hệ quản trị viên. |
| `SESSION.ACTIVATION_EXPIRED` | `401 SESSION_INVALID` | (xem §4) |

## 4. Phiên làm việc

| Mã | Khi nào | Câu chữ |
|---|---|---|
| `SESSION.ACTIVATION_REMAINING` | Activation Session, còn ≥ 1 phút (D-UI-2: `expiresAt − serverTime`, đếm bằng đồng hồ đơn điệu) | Thời gian còn lại để đổi mật khẩu: {n} phút. |
| `SESSION.ACTIVATION_REMAINING_LT1` | còn dưới 1 phút | Thời gian còn lại để đổi mật khẩu: dưới 1 phút. |
| `SESSION.ACTIVATION_EXPIRED` | đồng hồ client về 0, hoặc server trả `401 SESSION_INVALID` | Phiên đổi mật khẩu đã hết hạn. Vui lòng đăng nhập lại để tiếp tục. |
| `SESSION.INVALID` | Authenticated Session: `401 SESSION_INVALID` (hết 10 giờ, rảnh 60 phút, bị thu hồi, mất điều kiện) | Phiên đăng nhập đã hết hạn hoặc không còn hiệu lực. Vui lòng đăng nhập lại. |
| `SESSION.PASSWORD_CHANGE_REQUIRED` | `403 PASSWORD_CHANGE_REQUIRED` (Activation Session gọi endpoint ngoài allowlist) | Bạn cần đổi mật khẩu trước khi tiếp tục. |

Số phút hiển thị = phần nguyên của số phút còn lại (ví dụ còn 14 phút 30 giây → “14 phút”). Khi còn ≤ 2 phút, câu giữ
nguyên nhưng hiển thị màu cảnh báo. Đồng hồ client chỉ phục vụ hiển thị; server quyết định hết hạn.

## 4b. Màn chào mừng tối giản (AUTH-IMPLEMENTATION-E2E)

Chỉ để xác nhận Authenticated Session; không phải AppShell.

| Mã | Câu chữ |
|---|---|
| `WELCOME.TITLE` | ĐĂNG NHẬP THÀNH CÔNG |
| `WELCOME.GREETING` | Xin chào, {fullName}. |
| `WELCOME.NOTE` | Bạn đã đăng nhập vào hệ thống TALO-MOS. Các phân hệ nghiệp vụ sẽ được bổ sung ở giai đoạn sau. |
| `WELCOME.LOGOUT` | ĐĂNG XUẤT |

## 5. Đăng xuất (`POST /api/auth/logout`)

| Mã | Khi nào | Câu chữ |
|---|---|---|
| `LOGOUT.LOADING` | đang gửi | Đang đăng xuất... |
| `LOGOUT.DONE` | `204` (luôn luôn, kể cả không có phiên) | Bạn đã đăng xuất. |
| `LOGOUT.FAILED` | `403` / `415` / `500` / lỗi mạng | Không xác nhận được việc đăng xuất với máy chủ. Nếu bạn dùng máy tính chung, hãy đóng trình duyệt. |

## 6. Dùng chung

| Mã | Khi nào | Câu chữ |
|---|---|---|
| `COMMON.RATE_LIMITED` | `429 RATE_LIMITED` (mọi endpoint) | Bạn đã gửi quá nhiều yêu cầu. Vui lòng chờ ít phút rồi thử lại. |
| `COMMON.SERVICE_BUSY` | `503 SERVICE_BUSY` trên login | Hệ thống đang bận. Vui lòng thử lại sau ít phút. |
| `COMMON.INTERNAL_ERROR` | `500 INTERNAL_ERROR` trên login / session | Hệ thống gặp lỗi và chưa xử lý được yêu cầu. Vui lòng thử lại sau hoặc liên hệ quản trị viên. |
| `COMMON.REQUEST_INVALID` | `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `ORIGIN_NOT_ALLOWED`, `NOT_FOUND`, mã không xác định | Yêu cầu không hợp lệ. Vui lòng tải lại trang và thử lại. |
| `COMMON.NETWORK` | không nhận được phản hồi (mất mạng, timeout) | Không kết nối được máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại. |
| `COMMON.REFERENCE` | nối sau `COMMON.SERVICE_BUSY`, `COMMON.INTERNAL_ERROR`, `FC.SERVICE_BUSY`, `FC.INTERNAL_ERROR` | Mã tham chiếu: {requestId} |

## 7. Mapping đầy đủ `error.code` → thông báo theo endpoint

| HTTP | `error.code` | login | first-change | session | logout |
|---|---|---|---|---|---|
| 400 | `VALIDATION_ERROR` | `LOGIN.VALIDATION_ERROR` | `FC.VALIDATION_ERROR` | — | — |
| 400 | `INVALID_JSON` | `COMMON.REQUEST_INVALID` | `COMMON.REQUEST_INVALID` | — | — |
| 400 | `PASSWORD_POLICY` | — | `POLICY.<details.reason>` | — | — |
| 401 | `INVALID_CREDENTIALS` | `LOGIN.INVALID_CREDENTIALS` | — | — | — |
| 401 | `SESSION_INVALID` | — | `SESSION.ACTIVATION_EXPIRED` | `SESSION.INVALID` (Authenticated) / `SESSION.ACTIVATION_EXPIRED` (Activation) | — |
| 403 | `ACCOUNT_NOT_ALLOWED` | `LOGIN.ACCOUNT_NOT_ALLOWED` | — | — | — |
| 403 | `PASSWORD_CHANGE_REQUIRED` | — | — | — | — (các endpoint sau Phase B: `SESSION.PASSWORD_CHANGE_REQUIRED`) |
| 403 | `NOT_REQUIRED` | — | `FC.NOT_REQUIRED` | — | — |
| 403 | `ORIGIN_NOT_ALLOWED` | `COMMON.REQUEST_INVALID` | `COMMON.REQUEST_INVALID` | — | `LOGOUT.FAILED` |
| 404 | `NOT_FOUND` | `COMMON.REQUEST_INVALID` | `COMMON.REQUEST_INVALID` | `COMMON.REQUEST_INVALID` | `COMMON.REQUEST_INVALID` |
| 413 | `PAYLOAD_TOO_LARGE` | `COMMON.REQUEST_INVALID` | `COMMON.REQUEST_INVALID` | — | — |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `COMMON.REQUEST_INVALID` | `COMMON.REQUEST_INVALID` | — | `LOGOUT.FAILED` |
| 429 | `RATE_LIMITED` | `COMMON.RATE_LIMITED` | `COMMON.RATE_LIMITED` | — | — |
| 500 | `INTERNAL_ERROR` | `COMMON.INTERNAL_ERROR` | `FC.INTERNAL_ERROR` | `COMMON.INTERNAL_ERROR` | `LOGOUT.FAILED` |
| 503 | `SERVICE_BUSY` | `COMMON.SERVICE_BUSY` | `FC.SERVICE_BUSY` | — | — |
| — | (không có phản hồi) | `COMMON.NETWORK` | `COMMON.NETWORK` | `COMMON.NETWORK` | `LOGOUT.FAILED` |

“—” = status không có trong `AUTH-API-v1.yaml` cho endpoint đó; nếu vẫn nhận được, UI dùng `COMMON.REQUEST_INVALID`.

## 8. Ghi chú đối chiếu Phase A

Màn Login React (Phase A, đã đóng băng) hiện còn hai câu demo: “Chức năng quên mật khẩu chưa được tích hợp trong bản
demo.” và “Đây là bản demo giao diện, chưa kết nối hệ thống đăng nhập.”. Bảng này **không** sửa React Login; khi tích
hợp API (giai đoạn sau, cần phê duyệt riêng) hai câu đó được thay bằng `LOGIN.FORGOT` và các câu ở §2.
