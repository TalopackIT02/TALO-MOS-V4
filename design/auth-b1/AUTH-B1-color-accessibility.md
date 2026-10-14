# AUTH-B1 — Phân tích màu theo WCAG 2.2 AA (M-2)

**Trạng thái:** chỉ phân tích và đề xuất. **Chưa sửa** Login Phase A (`frontend/src/styles/auth-login.css`,
`LoginPage.tsx`, demo HTML Login) hay assets. Các màu riêng của First Change đã được sửa trong M-1 (§3).

## 1. Phương pháp

- Script Playwright (Chromium headless) lấy màu chữ đã tính (`getComputedStyle`) của từng đoạn chữ hiển thị, ẩn toàn
  bộ chữ, chụp ảnh và lấy **mọi pixel nền thực tế** dưới từng đoạn chữ; tỉ lệ ghi nhận là **trường hợp xấu nhất**
  (gồm ảnh nhà kho phía sau lớp phủ 82 % trên mobile). Viewport: 1440×900, 1024×768, 390×844, 360×640; cột form cuộn
  lên đầu và xuống cuối.
- Ngưỡng: chữ thường **4,5:1** (WCAG 1.4.3); chữ lớn (≥ 24 px, hoặc ≥ 18,66 px đậm) 3:1; thành phần giao diện và chỉ báo
  focus **3:1** (WCAG 1.4.11). Màu đề xuất tính bằng cùng công thức độ chói tương đối của WCAG.
- Nền xấu nhất đo được trên mobile cho chữ nằm trực tiếp trên lớp phủ: khoảng `#e1e1e1`.

## 2. Bảng so sánh

| Phần tử | Màu hiện tại | Nền thực tế (xấu nhất) | Tỉ lệ | Màu đề xuất | Tỉ lệ mới | Ảnh hưởng Login | Ảnh hưởng First Change |
|---|---|---|---|---|---|---|---|
| Chữ trắng trên nút chính | `#ffffff` / nền `#0fa958` | `#0fa958` | **3,07** ✗ | nền `#0b8043`, hover `#086d37` | 5,02 / 6,46 | nút ĐĂNG NHẬP | nút CẬP NHẬT MẬT KHẨU, QUAY LẠI ĐĂNG NHẬP |
| Link xanh | `#0fa958` | `#e4eae9` (mobile) | **2,52** ✗ | `#076b38` | 6,63 trắng / 5,07 mobile | “Quên mật khẩu?” | “Đăng xuất” |
| Placeholder | `#9099a8` | `#fefefe` | **2,85** ✗ | `#6b7280` | 4,83 | 2 ô | 2 ô |
| Subtitle / dòng tài khoản (`--muted`) | `#7b8492` | `#e3e3e3` (mobile) | **2,94** ✗ | `#4b5563` | 7,56 trắng / 5,78 mobile | slogan dưới tiêu đề | “Tài khoản: …” |
| Footer | `#929aa5` | `#e1e1e1` (mobile) | **2,17** ✗ | `#5d6571` (hoặc `#4b5563`) | 5,89 trắng / **4,50** mobile (biên mỏng) — `#4b5563`: 5,78 | © 2026 TALOPACK | như Login |
| Thông báo thành công Login (React `MESSAGE_COLOR.success`) | `#0b8e4a` | trắng / mobile | **4,21 / 3,22** ✗ | `#076b38` | 6,63 / 5,07 | thông báo thành công | (đã dùng `#076b38`) |
| Viền ô nhập (1.4.11) | `#d8dee6` | `#ffffff` | **1,35** ✗ | `#8a94a3` | 3,07 | 2 ô — ô nhìn đậm viền hơn rõ | 2 ô |
| Chỉ báo focus nút/link (`outline`) | `#a0e6c5` | `#ffffff` | **1,44** ✗ | `#0b8043` | 5,02 | nút, link, nút mắt | như Login |
| Viền focus ô nhập | `#0fa958` | `#ffffff` | 3,07 ✓ | giữ | — | — | — |
| Icon trong ô | `#6b7788` | `#ffffff` | 4,55 ✓ | giữ | — | — | — |
| Nút mắt | `#657386` | `#ffffff` | 4,83 ✓ | giữ | — | — | — |
| Tiêu đề | `#3d2a20` | `#e2e2e2` | 10,46 ✓ | giữ | — | — | — |
| Chữ “Ghi nhớ đăng nhập” | `#171e2c` | `#e6e5e2` | 13,25 ✓ | giữ | — | — | — |
| Lỗi | `#ad3939` | `#e1e1e1` | 4,69 ✓ (biên mỏng trên mobile) | giữ | — | thông báo lỗi | lỗi, “chưa đạt” |

Ghi chú: tỉ lệ của “Đăng xuất” đo trên First Change là 2,80, của “Quên mật khẩu?” trên Login là 2,52 (nền ảnh khác
nhau); cùng một style `.forgot`.

## 3. Màu riêng của First Change đã sửa trong M-1 (đo lại sau sửa)

| Phần tử | Trước | Sau | Tỉ lệ xấu nhất sau sửa |
|---|---|---|---|
| Chữ hướng dẫn mật khẩu | `#7b8492` (3,78 trắng; ≈ 3,25 mobile) | `#4b5563`; mobile có nền trắng 96 % | 7,49 |
| Dòng độ dài “đạt” | `#0b8e4a` (4,21) | `#076b38` | 6,57 |
| Dòng độ dài “chưa đạt” | — | `#ad3939` | 6,09 |
| Thông báo thành công / đã đăng xuất | `#0b8e4a` / `#4b5563` | `#076b38` / `#4b5563` | 5,07 / 5,86 |
| Mã tham chiếu (500) | `#929aa5` | `#4b5563` | 6,08 |
| Hộp thời gian (thường / cảnh báo) | `#4b5563` / `#8a4b00` | giữ | 7,09 / 6,39 |
| Thông báo 429/503 | `#8a4b00` trên `#fff8ec` | giữ | 6,44 |

Ký hiệu trạng thái (WCAG 1.4.11, 3:1): vòng rỗng `#4b5563` 7,56; dấu kiểm `#076b38` 6,63; chấm đặc `#ad3939` 6,14;
gạch `#4b5563` 7,56. Ba trạng thái khác nhau cả về **hình dạng**, không chỉ về màu (WCAG 1.4.1).

## 4. Đề xuất hệ màu chung cho Login và First Change

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--brand-green` | `#0fa958` (giữ) | nhận diện, viền focus ô nhập, `accent-color` checkbox — không dùng cho chữ nhỏ |
| `--action` / `--action-hover` | `#0b8043` / `#086d37` | nền nút chính (chữ trắng) |
| `--text-link`, `--text-success` | `#076b38` | link, thông báo thành công, trạng thái “đạt” |
| `--text` | `#1f2937` | chữ nhập |
| `--ink` | `#3d2a20` (giữ) | tiêu đề |
| `--text-secondary` | `#4b5563` | subtitle, dòng tài khoản, hướng dẫn, hộp thời gian, mã tham chiếu |
| `--text-subtle` | **`#4b5563`** (DECIDED at AUTH-B1 design acceptance) | footer |
| `--placeholder` | `#6b7280` | placeholder |
| `--border-input` | `#8a94a3` | viền ô nhập |
| `--focus-ring` | `#0b8043` | outline focus của nút, link, nút mắt |
| `--error` | `#ad3939` (giữ) | lỗi, “chưa đạt” |
| `--warning-fg` / `--warning-bg` / `--warning-border` | `#8a4b00` / `#fff8ec` / `#f0c58a` (giữ) | 429, 503, thời gian ≤ 2 phút |

**Tác động thị giác:** nút chính và link xanh đậm hơn rõ so với màu logo; viền ô nhập đậm hơn; slogan, placeholder,
footer tối hơn. Bố cục, font, kích thước không đổi.

## 5. Cần User quyết định

1. Có áp dụng hệ màu §4 cho **cả Login Phase A** (phải mở lại phạm vi đóng băng: `auth-login.css`, `LoginPage.tsx`,
   demo HTML) hay không — nếu áp dụng chỉ cho First Change, hai màn sẽ lệch màu nút/link.
2. Màu nút: `#0b8043` (5,02:1) làm nút đậm hơn màu thương hiệu `#0fa958`; phương án khác là giữ nền `#0fa958` và
   tăng chữ nút lên ≥ 18,66 px đậm (ngưỡng chữ lớn 3:1 — hiện 3,07, biên rất mỏng) — không khuyến nghị.
3. Viền ô nhập `#8a94a3` (thay đổi nhìn thấy rõ nhất).
4. Footer `#5d6571` (đạt đúng 4,50 trên nền mobile xấu nhất) hay `#4b5563`.

Đo trên Chromium; trình duyệt khác có thể làm mịn chữ khác nhau nhưng tỉ lệ màu không đổi.
