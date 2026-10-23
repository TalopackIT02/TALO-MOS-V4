# 04 — UI/UX SPEC: TWO WORKSPACES + DRAWER/POPUP

## Design system bất biến

Tái dùng CSS/layout hiện hành `app-shell.css`, `foundation.css`, `module-scan.css`, `navigation-builder.css`, common components, `DataTable`, `FeedbackLine`, breadcrumbs và IAM capability context. Không thêm thư viện UI/theme. Duy trì chuẩn **4 block**: breadcrumb → title/description → toolbar/tabs/actions → content. Không tạo sidebar ứng dụng thứ hai; "drawer" trong hồ sơ là overlay bên phải của vùng nội dung.

### Screen A — `/foundation/modules`: Quản lý Module

- Block 1: Breadcrumb `Develop > Foundation > Quản lý Module`.
- Block 2: H1 và mô tả ngắn `Quét, kiểm thử, cài đặt và quản lý phiên bản`.
- Block 3: nút `Quét Module` (manual), `Tải lại`, tìm kiếm và `Module đã cài / Ứng viên`; `Hiện FBET` mặc định tắt (hiển thị số ẩn, không giả xóa dữ liệu).
- Block 4: bảng module với Key, tên, activeVersion, enabled, latestCandidate, trạng thái; dùng `DataTable` chung. Nhấn dòng hoặc Chi tiết → drawer.
- `Scan results`: tóm tắt 3 thanh đỏ/vàng/xanh + unavailable riêng; bảng compact; chi tiết scan → drawer; `Kiểm tra & Chạy thử` → route Screen B.
- Danh sách các version và nút tạo DRAFT không đặt tự động trên đầu một bảng dài. Version history/tab trong drawer; nếu quản trị chuyên sâu thật sự cần MIC manual, đặt `Advanced / Quản trị thủ công` có cảnh báo rõ, không phải default.
- `Đăng ký Module` cũ: không xóa API; chuyển UI vào chế độ advanced hoặc tab ít ưu tiên, không bắt người dùng đi qua để cài từ package.

### Screen B — `/foundation/modules/candidates/:candidateId`: Candidate Workspace

- Route hợp lệ trong AppShell với session + quyền tương ứng, direct URL guard và breadcrumb quay lại Screen A. Không tạo B09 link mới cho workspace admin.
- Header tên module, version, Candidate ID ngắn, status, packageHash ngắn + copy đầy đủ và time.
- Stepper: `1. Quét` → `2. Kiểm tra & Chạy thử` → `3. Kế hoạch` → `4. Cài đặt & Hậu kiểm`.
- Overview compact: PASS/WARN/FAIL/NOT_TESTED/UNAVAILABLE; trạng thái; evidence; limitations.
- Danh sách checks theo table compact (P0–P7). Chọn row → **drawer bên phải** chứa issue, file/line, expected/actual sanitized, logHash, report evidence; không mở rộng inline toàn page.
- MIC review: summary Functions/Actions/API/Resources/IAM/Navigation, diff package MIC vs B02 MIC. **Không hiển thị `MAIN.READ` template như MIC thực tế.** Raw JSON có thể mở read-only trong drawer Advanced.
- Plan: dry-run blockers, upgrade guard/recovery, release/hash, IAM catalog policy, B09 placement. Risk confirmation bằng modal. Nút disabled nếu blocker.
- Install journal: steps, state, checkpoint, restart instruction, Continue, download TXT. Vẫn xem lại được sau reload (read API từ store).
- Nếu `AWAITING_RESTART`: thông báo thao tác vận hành cụ thể; không gọi là ACTIVE; giữ trạng thái qua refresh.

### Drawer chuẩn dùng chung

- Trigger: row/"Chi tiết"/error item, fixed right overlay desktop, max-width ~680px, mobile full-width; `role=dialog`, aria-modal, title, Escape, close button, backdrop and focus return.
- Chỉ **xem/sửa một entity**: Module detail, Version detail, Preflight issue, MIC diff, Navigation area/menu/link/Function inventory.
- Không để drawers lồng nhau; từ drawer có thể chuyển nội dung trong cùng drawer.
- Logs trên 2 màn dài: trong drawer có scrollbar độc lập, download TXT cho bằng chứng dài; không làm trang kéo dài 20.000px.

### Popup/modal

- Dùng cho `APPROVE`, `REJECT`, `RETIRE`, `ENABLE/DISABLE`, `INSTALL`, `RECOVERY`, `DISCARD DIRTY`, xóa/gỡ.
- Nội dung xác nhận phải nói rõ: đối tượng, trạng thái hiện tại → kỳ vọng, ảnh hưởng runtime/IAM/menu, và điều kiện không thể hoàn tác nếu có. Không thay bằng `window.confirm` cho quy trình nguy hiểm phức tạp.
- Không cho một xác nhận UI vượt Backend gate.

### Navigation Builder — một màn hình chuyên dụng

Giữ `/foundation/navigation` và tab `Quản trị menu (B09)`; không thêm screen thứ ba.

- Cây AREA → MENU → FUNCTION chiếm trung tâm; chỉ hiển thị nhánh cần thao tác. Search, collapse, showHidden, FBET filter.
- Chọn vùng/menu/link → mở drawer sửa tên, hiển thị, di chuyển, thứ tự, gỡ/khôi phục; form không đẩy kho chức năng xuống phía dưới.
- Kho chức năng mở qua nút `+ Thêm chức năng`: drawer có tìm tên/mã/module, lọc available/assigned/unassigned/history, support multi-select & drag if possible. User chọn target menu trước.
- `Xem trước` mở popup lớn hoặc drawer có mode Design/Account; không mở rộng bên dưới cây.
- `Lưu cấu hình`, `Hủy thay đổi`, revision/conflict/dirty guard vẫn nằm ở toolbar sticky.
- Dữ liệu legacy và hidden mặc định thu gọn; không tự xóa lịch sử. Developer Functions chỉ được ở Develop.

### Các trạng thái bắt buộc

Loading, empty, unauthorised 401/403, network, unexpected API response, stale scan, invalidated candidate, needs_fix, READY, blocked plan, restart pending, recovery_required, finished. Alert chỉ gắn vào lỗi người dùng thao tác; fetch phụ có thể dùng note yên lặng có thể truy cập.

### Test UI

Desktop ≥ 1280px, laptop ~1024px, mobile ~375px. Keyboard focus/ESC, navigation back/forward, reload preserving CandidateId, dirty draft handling, stale result and direct URL auth, overlay z-index không che sai AppShell. Snapshot/comparison với UI hiện hành, không thay màu/font/sidebar layout.
