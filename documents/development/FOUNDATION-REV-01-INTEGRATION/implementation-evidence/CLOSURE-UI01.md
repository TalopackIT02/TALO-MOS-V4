# CLOSURE-UI01 — Candidate Workspace: tràn ngang, cắt chữ, bảng, cuộn

Trạng thái: **PASS** (Playwright đo DOM thật, react-dev + react-preview).

## Nguyên nhân gốc (đo bằng DOM)

1. **Grid item có `min-width:auto`**, cộng với chiều rộng nội tại của bảng, làm `.workspace` (`overflow:auto`) rộng hơn vùng nội dung.
2. **Nhãn `sr-only` của `th`** (`position:absolute`) thoát khỏi wrapper cuộn. Wrapper không có containing block nên nhãn làm document rộng thêm: 774 > 768 tại 768×1024, và 521 > 390 tại 390×844.

**Không dùng `overflow-x:hidden`** trên root / body / .workspace.

## Sửa

**`module-scan.css`:**
- `.cw-grid` dùng `repeat(auto-fit, minmax(min(100%, 380px), 1fr))`.
- `.cw-card` và `.ms-installer` có `min-width: 0`.
- `.cw-scroll` có `position: relative; max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain`.
- `overflow-wrap: anywhere` cho text và code.
- Toolbar được wrap.

**`CandidateWorkspace.tsx`:**
- Bảng runtime, các phép kiểm và khác biệt MIC nằm trong `.cw-scroll`.
- Hash có `title` đầy đủ và có nút copy.
- Bảng runtime có `aria-label`.
- Khối tổng hợp tách bạch các ý:
  - Bắt buộc x/y chấp nhận (PASS hoặc N/A);
  - Đạt / Lỗi / Cảnh báo;
  - Không áp dụng (N/A);
  - Tùy chọn chưa chạy (không chặn READY);
  - "N/A không phải PASS … READY chưa phải INSTALLED_ACTIVE".

**`Overlay.tsx`:**
- Focus trap: Tab / Shift+Tab vòng trong dialog.
- Escape đóng dialog; focus trả về phần tử mở.

**CLOSURE D1:** thêm nhãn cho `RECOVERY_AWAITING_RESTART` và `RECOVERED`.

## Kiểm thử — `tests/e2e/candidate-workspace-layout.e2e.spec.ts` (13 ca × 2 project)

**Viewport:**
- 1440×900, 1366×768, 1280×720: sidebar mở và thu gọn;
- 1024×768, 768×1024, 390×844.

**Mỗi viewport:**
- `scrollWidth ≤ clientWidth + 1` của document và `.workspace`, đo ở đầu và cuối trang;
- mọi phần tử nằm trong content box, trừ phần nằm trong `.cw-scroll`;
- tiêu đề, trạng thái và stepper không bị sidebar che;
- có đủ 4 bước.

**Các ca riêng:**
- **Bảng:** có ít nhất 3 `.cw-scroll` với overflow-x auto; hash có `title`; có nút copy.
- **Tổng hợp:** chuỗi READY ≠ INSTALLED_ACTIVE như mô tả ở trên.
- **Drawer / modal:** Tab ×6 vẫn ở trong dialog; Escape đóng; focus được khôi phục.
- **Reload / back / forward:** layout không tràn.

| Lượt | Kết quả | Log / ảnh |
|---|---|---|
| RED (trước sửa) | 13 failed | `$OUT/t-ui01-red.log`, `$OUT/ui01-before/` |
| GREEN | 13 passed | `$OUT/t-ui01.log`, `$OUT/ui01-after/` |
| Hồi quy toàn bộ (react-dev + react-preview) | 26/26 ca UI-01 PASS trong 311 passed | `$OUT/t-playwright-final.log` |

`candidate-workspace.e2e.spec.ts` B02 / B07 được cập nhật theo câu chữ tổng hợp mới của UI-01: "Không áp dụng (N/A) 1" và "READY chưa phải INSTALLED_ACTIVE". Lý do: text đã được chủ ý đổi.

## Chưa kiểm

- Trình duyệt ngoài Chromium.
- Ảnh trên dữ liệu live của SYSTEM_TEST: chỉ dùng mock route, không gọi backend thật.
