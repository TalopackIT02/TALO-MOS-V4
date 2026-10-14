# AUTH-B1.2 — Thiết kế UI màn “Đổi mật khẩu lần đầu”

**Trạng thái:** Visual UI Review — chấp thuận có điều kiện; **AUTH-B1 Visual Finalization** đã áp dụng M-1 và các MINOR
(§5.1). M-2 (hệ màu chung với Login) chờ quyết định: `AUTH-B1-color-accessibility.md`. Chưa có React component, chưa gọi API thật.
Demo: `first-change-demo.html` (cùng thư mục). Câu chữ: `AUTH-B1.3-messages-vi.md` (P-11).
Hợp đồng API: `backend/src/modules/auth/AUTH-API-v1.md` §3, §5, §6, §7.

## 1. Nguồn và ràng buộc

| Nguồn | Áp dụng |
|---|---|
| Login Phase A (`frontend/TALO-MOS-Login-Demo-Responsive-v2.html`, đã đóng băng) | khung, breakpoint, font Arial/Segoe UI, màu `--green #0fa958` / `--green-hover #0b8e4a` / `--ink #3d2a20` / `--muted #7b8492` / `--line #d8dee6`, input 52 px, nút 56 px, bo góc 6 px, icon SVG |
| Assets gốc `frontend/src/assets/images/` | `talopack-logo.png`, `warehouse-illustration.png` — **tham chiếu trực tiếp, không sao chép, không chỉnh sửa** |
| D-B1-1 | đổi thành công → không cấp phiên, phải đăng nhập lại |
| D-B1-2 | không hỏi lại mật khẩu tạm |
| D-UI-1 | có ô xác nhận, so sánh phía client, API chỉ nhận `newPassword` |
| D-UI-2 | thời gian còn lại dạng chữ, tính từ `expiresAt − serverTime` một lần rồi đếm bằng đồng hồ đơn điệu |
| AD-6 / P-4 | 15–128 code point, ≤ 512 byte UTF-8, NFC, không trim, không luật thành phần, chặn C0/DEL/C1 |

React Login hiện tại **không** bị sửa.

## 2. Bố cục

| Breakpoint | Bố cục (giữ nguyên Login) |
|---|---|
| Desktop `> 1080 px` | khung bo 12 px, cột form **40 %** / ảnh **60 %**, chiều cao theo viewport, tối đa 760 px |
| Tablet `641–1080 px` | **46 % / 54 %**, logo tối đa 245 px |
| Mobile `≤ 640 px` | ảnh `warehouse-illustration.png` làm nền toàn màn, lớp phủ trắng **82 %**, form ở giữa, tối đa 440 px |

Thứ tự trong cột form:

1. Logo TALOPACK.
2. Tiêu đề `ĐỔI MẬT KHẨU LẦN ĐẦU` (style `h1` của Login).
3. Dòng tài khoản: icon người + “Tài khoản: **{username}**” (vị trí và style của subtitle Login). `username` lấy từ
   `account.username` của phản hồi login / session.
4. Ô **Mật khẩu mới** — icon ổ khóa, nút mắt ẩn/hiện riêng, `autocomplete="new-password"`.
5. Ô **Xác nhận mật khẩu mới** — giống ô trên, nút mắt riêng.
6. Khối “Yêu cầu mật khẩu:” — 4 dòng hướng dẫn (`FC.HINT_*`), chữ `#4b5563`; trên mobile khối có nền trắng 96 %
   (như ô nhập). Ký hiệu: xem §3.1.
7. Hộp thời gian còn lại của Activation Session (icon đồng hồ, chữ), nền `#f7f9fa`, **không viền** ở trạng thái thường;
   trạng thái cảnh báo có nền `#fff8ec` và viền `#f0c58a`.
8. Nút chính `CẬP NHẬT MẬT KHẨU` (style nút Login).
9. Vùng thông báo trạng thái (`role="status"`, `aria-live="polite"`, cùng vị trí với Login: ngay dưới nút), luôn
   giữ sẵn chiều cao **một dòng** (`min-height: 1.5em`) để thông báo một dòng không làm xê dịch bố cục.
10. Link `Đăng xuất` (style link “Quên mật khẩu?” của Login).
11. Footer `© 2026 TALOPACK`.

### Khác biệt có chủ đích so với Login (đã chấp thuận có điều kiện, §5)

| Điểm | Lý do |
|---|---|
| Logo nhỏ hơn: desktop/tablet tối đa **120 px** (`clamp(72px, 12vh, 120px)`), mobile `clamp(80px, 14dvh, 150px)`; cùng asset gốc, tỉ lệ giữ bằng `height:auto` + `object-fit:contain` | màn này có thêm ô xác nhận, khối hướng dẫn, hộp thời gian; giữ logo cỡ Login thì 1440×900 bị tràn và cắt logo |
| Cột form: `justify-content:flex-start` + `margin-top:auto` ở phần tử đầu, `margin-bottom:auto` ở phần tử cuối | căn giữa khi đủ chỗ; khi nội dung cao hơn khung (1280×720, 360×640) margin về 0 nên cột cuộn được và không cắt phần đầu. Không dùng từ khóa `safe` (Safari cũ không hỗ trợ) — kỹ thuật auto-margin chạy trên mọi trình duyệt có flexbox |
| Subtitle thay bằng dòng tài khoản | yêu cầu hiển thị username đang đăng nhập; không thêm dòng mới |
| Màu trạng thái: cảnh báo `#8a4b00` trên `#fff8ec` (viền `#f0c58a`); lỗi / chưa đạt `#ad3939`; thành công / đạt `#076b38`; hướng dẫn `#4b5563` | mọi màu chữ riêng của màn này ≥ 4,5:1 trên nền thực tế (đo bằng pixel, `AUTH-B1-color-accessibility.md` §3). `#076b38` thay `#0b8e4a` của Login (4,21:1 — không đạt) |
| Nút loading có vòng xoay đơn giản (border tròn) | biểu thị đang xử lý; tắt animation khi `prefers-reduced-motion` |

Không dùng đường cong CSS phức tạp, không thêm font, không thêm ảnh.

## 3. Hành vi

### 3.1 Nhập liệu và kiểm tra phía client

- Không trim, không chặn dán (paste), không đo độ mạnh, không yêu cầu thành phần.
- Khi bấm `CẬP NHẬT MẬT KHẨU`, client kiểm tra theo thứ tự: trống → ký tự điều khiển C0/DEL/C1 → < 15 → > 128 code
  point → > 512 byte → ô xác nhận trống → không khớp (so sánh sau NFC). Lỗi đầu tiên: ô liên quan có viền đỏ +
  `aria-invalid="true"`, focus vào ô đó, câu thông báo ở vùng trạng thái. Gõ lại thì bỏ viền đỏ.
- Blocklist, contextual, `SAME_AS_CURRENT` chỉ server kiểm tra (client không có danh sách và không có hash).

**Ký hiệu khối hướng dẫn** (ba trạng thái khác nhau cả hình dạng lẫn màu, không chỉ màu):

| Dòng | Ký hiệu | Ý nghĩa |
|---|---|---|
| `FC.HINT_LENGTH` — chưa nhập / đang nhập dưới 15 | vòng tròn rỗng `#4b5563`, chữ `#4b5563` | chưa đánh giá (không báo đỏ khi người dùng mới gõ) |
| `FC.HINT_LENGTH` — 15–128 code point | dấu kiểm `#076b38`, chữ `#076b38` | đạt; screen reader đọc thêm `FC.HINT_STATE_OK` |
| `FC.HINT_LENGTH` — > 128, hoặc < 15 sau khi đã bấm cập nhật | chấm tròn đặc `#ad3939`, chữ `#ad3939` | chưa đạt; screen reader đọc thêm `FC.HINT_STATE_FAIL` |
| 3 dòng còn lại | gạch ngang `#4b5563` | thông tin / do server kiểm tra khi cập nhật — không có trạng thái đạt/chưa đạt phía client |

### 3.2 Gửi và kết quả

| Trạng thái | Hiển thị |
|---|---|
| Đang gửi | nút disabled + vòng xoay + `ĐANG CẬP NHẬT...`; hai ô, hai nút mắt và link Đăng xuất disabled |
| `200 PASSWORD_CHANGED_RELOGIN` | form và link Đăng xuất ẩn; câu `FC.SUCCESS` (xanh) + nút `QUAY LẠI ĐĂNG NHẬP`; giá trị hai ô bị xóa |
| `400 PASSWORD_POLICY` | viền đỏ ô mật khẩu mới, câu `POLICY.<reason>` |
| `401 SESSION_INVALID` | như hết hạn (§3.3) |
| `403 NOT_REQUIRED` | form ẩn, câu `FC.NOT_REQUIRED` + nút `QUAY LẠI ĐĂNG NHẬP` |
| `429` | câu `COMMON.RATE_LIMITED` (màu cảnh báo), form giữ nguyên để thử lại |
| `503` | câu `FC.SERVICE_BUSY` (cảnh báo) + “Mã tham chiếu” |
| `500` | câu `FC.INTERNAL_ERROR` (đỏ) + “Mã tham chiếu” |
| Không có phản hồi | câu `COMMON.NETWORK` |
| Mã khác | câu `COMMON.REQUEST_INVALID` |

Mapping đầy đủ: `AUTH-B1.3-messages-vi.md` §7. Vùng trạng thái luôn được cuộn vào tầm nhìn khi có câu mới.

### 3.3 Thời gian còn lại (D-UI-2)

- `remaining = expiresAt − serverTime` (từ phản hồi login hoặc `GET /api/auth/session`, chỉ gọi một lần — không
  poll), sau đó trừ dần bằng `performance.now()`; không dùng đồng hồ hệ thống.
- Hiển thị theo phút nguyên: “Thời gian còn lại để đổi mật khẩu: 14 phút.”; dưới 1 phút: “… dưới 1 phút.”.
- Còn ≤ 2 phút: hộp chuyển màu cảnh báo (câu không đổi).
- Về 0: form ẩn, câu `SESSION.ACTIVATION_EXPIRED` + nút `QUAY LẠI ĐĂNG NHẬP`. Server vẫn là bên quyết định hết hạn;
  nếu server trả `401 SESSION_INVALID` trước đó thì hiển thị y hệt.

### 3.4 Đăng xuất

Link `Đăng xuất` → `POST /api/auth/logout` (luôn 204) → `LOGOUT.LOADING` trên link, sau đó form ẩn, câu `LOGOUT.DONE`
+ nút `QUAY LẠI ĐĂNG NHẬP`. Lỗi `403/415/500/mạng` → `LOGOUT.FAILED`.

### 3.5 Bảo mật phía client

- Không lưu mật khẩu, token hay session id vào `localStorage` / `sessionStorage`; cookie `talo_sid` là HttpOnly.
- Xóa giá trị hai ô khi kết thúc luồng (thành công, hết hạn, đăng xuất).
- Không hiển thị mật khẩu tạm, không hiển thị mục blocklist bị trùng, không hiển thị `error.message` thô.

### 3.6 Khả năng truy cập

`aria-label` cho ô (trùng placeholder), `aria-pressed` + nhãn “Hiện/Ẩn mật khẩu” cho nút mắt, `aria-describedby` nối ô
mật khẩu mới với khối hướng dẫn, `aria-invalid` khi lỗi, vùng trạng thái `aria-live="polite"`, hộp thời gian
`role="timer"` với `aria-live="off"` (không đọc mỗi phút), focus-visible giữ viền xanh `#a0e6c5` như Login.

**Cuộn trên màn hình thấp (quyết định 5):** thứ tự Tab cố định: mật khẩu mới → nút mắt 1 → xác nhận → nút mắt 2 →
`CẬP NHẬT MẬT KHẨU` → `Đăng xuất` (trạng thái kết thúc: chỉ `QUAY LẠI ĐĂNG NHẬP`). Phần tử nhận focus được trình duyệt
cuộn vào tầm nhìn trong cột form; mỗi câu thông báo mới được `scrollIntoView({ block: 'nearest' })`; khi lỗi phía
client, focus chuyển vào ô lỗi với `preventScroll` để vùng thông báo vẫn hiện.

## 4. Ma trận trạng thái của demo

Mở `first-change-demo.html?state=<id>`; thêm `&demo=off` để ẩn bảng chọn trạng thái (bảng này chỉ phục vụ demo).

| `state` | Nội dung |
|---|---|
| `default` | form trống, còn 14 phút |
| `typing` | đã nhập, dòng độ dài xanh |
| `empty-submit`, `too-short`, `control-char`, `mismatch` | validation phía client |
| `loading` | đang gửi |
| `blocklisted`, `context-match`, `same-as-current` | lỗi policy từ server (mô phỏng) |
| `rate-limited`, `service-busy`, `system-error`, `network-error` | lỗi dịch vụ |
| `success` | đổi thành công → đăng nhập lại |
| `expiring`, `expired`, `session-invalid` | thời gian còn lại ≤ 2 phút, hết hạn phía client, 401 từ server |
| `logged-out` | sau khi đăng xuất |

Demo cũng chạy tương tác: nhập tay, bấm nút; server được mô phỏng (blocklist/contextual/mật khẩu tạm là dữ liệu giả
trong file, không phải dữ liệu thật). Nút `QUAY LẠI ĐĂNG NHẬP` mở demo Login Phase A.

## 5. Quyết định tại UI Design Acceptance (chấp thuận có điều kiện)

| # | Quyết định | Ghi nhận tại |
|---|---|---|
| 1 | Logo tối đa 120 px trên desktop; giữ nguyên asset và tỉ lệ | §2 |
| 2 | Màu cảnh báo `#8a4b00` trên nền `#fff8ec` cho thời gian còn ≤ 2 phút và lỗi 429/503 | §2, §3.2, §3.3 |
| 3 | “Mã tham chiếu” chỉ cho 500/503; không bao giờ ở lỗi đăng nhập 401 | §3.2; B1.3 §0.4 |
| 4 | Câu 401 chung có cảnh báo giới hạn đăng nhập sai, giống nhau với mọi tài khoản | B1.3 §2 |
| 5 | Cột form được cuộn trên màn hình thấp; focus, bàn phím và thông báo luôn được đưa vào tầm nhìn | §2, §3.6 |
| 6 | Audit `TRANSIENT_DB_ERROR`: INSERT một lần sau rollback, không retry; thất bại → vẫn 503 + một structured log tối thiểu (`requestId`, action, reason, SQLSTATE); không secrets, SQL text, driver error | `AUTH-API-v1.md` §11, §13.1 |

### 5.1 Visual Finalization (sau Visual UI Review)

| ID | Nội dung đã áp dụng |
|---|---|
| M-1 | Chữ hướng dẫn `#4b5563`; nền trắng 96 % cho khối hướng dẫn trên mobile; “đạt” `#076b38`, “chưa đạt” `#ad3939`; đo lại bằng pixel: mọi chữ riêng của màn này ≥ 4,5:1 |
| m-1 / m-2 | Vùng thông báo giữ sẵn một dòng; vị trí không đổi (dưới nút, như Login) |
| m-4 | Ký hiệu ba trạng thái cho dòng độ dài, gạch ngang cho các dòng còn lại (§3.1) |
| m-5 | `FC.HINT_LENGTH` rút gọn: “15–128 ký tự, được dùng khoảng trắng.” (đồng bộ P-11) |
| m-6 | Hộp thời gian bỏ viền ở trạng thái thường |
| Khác | Mã tham chiếu `#929aa5` → `#4b5563`; thông báo thành công `#0b8e4a` → `#076b38` (đều để đạt 4,5:1) |

Không đổi: bố cục, font, cỡ chữ, cấu trúc form, logo, assets, vị trí thông báo.

## 6. Kiểm chứng và giới hạn

- Đã chạy (Chromium headless của Playwright 1.63): ma trận 19 trạng thái × 6 viewport; luồng tương tác bằng bàn phím;
  thứ tự Tab + phần tử focus nằm trong tầm nhìn + có chỉ báo focus ở 360×640, 390×844, 1280×720, 1440×900;
  đối chiếu câu chữ với B1.3 và `AUTH-API-v1.yaml`.
- **Chưa thực hiện:** Safari/WebKit (cũ và mới), Firefox, Edge, trình duyệt di động thật (iOS Safari, Chrome Android);
  screen reader (NVDA, JAWS, VoiceOver, TalkBack); zoom 200 % / reflow 320 px CSS; Windows High Contrast / forced
  colors; kiểm thử với người dùng. Tương phản được đo bằng script pixel trên Chromium (không phải công cụ kiểm định
  độc lập như axe / Colour Contrast Analyser).

## 7. Quyết định cho React migration (ghi nhận, chưa triển khai)

| # | Quyết định |
|---|---|
| RM-1 | First Change dùng **stylesheet riêng**, mọi selector scope dưới `.auth-first-change-page` (cùng cách Login dùng `.auth-login-page`). |
| RM-2 | **Không** sửa `frontend/src/styles/auth-login.css`, `LoginPage.tsx` hay stylesheet Login trong task này. Chấp nhận trùng lặp có kiểm soát các rule layout; việc tách layout chung (hoặc áp hệ màu M-2) cần quyết định riêng vì Login đã đóng băng. |
| RM-3 | Dùng lại **assets gốc** qua import của Vite (`talopack-logo.png`, `warehouse-illustration.png`), không sao chép, không chỉnh sửa. |
| RM-4 | **Không** mang sang React: thao tác DOM trực tiếp (`replaceChildren`, `textContent`, `hidden` thủ công), bảng chọn trạng thái demo, `simulatedServer`, dữ liệu `DEMO`, inline style của link quay lại. |
| RM-5 | React quản lý bằng state/lifecycle: trạng thái form và thông báo là state; focus và `scrollIntoView` qua ref trong effect sau render; bộ đếm thời gian (monotonic) trong effect có cleanup, chịu được StrictMode chạy effect hai lần; huỷ request/timer khi unmount; xoá giá trị mật khẩu khi kết thúc luồng. |
| RM-6 | Căn giữa bằng auto-margin dựa vào phần tử con đầu/cuối của cột form: footer phải luôn là phần tử cuối dù các khối khác render có điều kiện. |
| RM-7 | Câu chữ lấy từ một module duy nhất theo mã P-11 (AUTH-B1.3); giữ kiểm tra tự động “chuỗi UI ↔ bảng P-11”. |
