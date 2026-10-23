# FMI-01 — Đặc tả UI/UX

## Vị trí

Tích hợp tại `frontend/src/pages/foundation/ModuleScreen.tsx`, tab **Module & Phiên bản**. Đặt nút **Quét Module** cạnh **Tải lại** trong `fx-toolbar`. Giữ nguyên bảng registry và `VersionPanel`; không tạo AppShell route hay sidebar group mới.

## States

| UI state | Hiển thị / tương tác |
|---|---|
| INITIAL | Hướng dẫn: chép folder vào modules, nhấn Quét Module. Không fetch scan |
| LOADING | Spinner + nút bị vô hiệu hóa, không gửi request chồng |
| SUCCESS_EMPTY | Hoàn tất; 0 folder được tìm thấy |
| SUCCESS_DATA | Thời điểm, ba thanh đỏ/vàng/xanh, UNAVAILABLE riêng, bảng module |
| PARTIAL_ERRORS | Hiển thị folder lỗi trong bảng, vẫn hiển thị folder tốt |
| NETWORK_ERROR | Báo lỗi kết nối; giữ snapshot cũ có nhãn 'Kết quả lần quét trước' |
| 401 | Chuyển luồng mất session hiện có qua onSessionLost |
| 403 | Thông báo thiếu quyền, không retry tự động |
| 409 | 'Đang có lượt quét'; không tự gọi lại |
| SNAPSHOT_EXPIRED | Không tự quét lại; nút bấm Quét Module |

## Tổng quan

- Nút Primary hoặc Secondary theo style AppShell, nhãn 'Quét Module'.
- Badge thời điểm quét (thời gian ISO chuyển sang local trong client).
- 3 thanh kết quả: Đỏ = FAIL, Vàng = WARN, Xanh = PASS; chiều dài `count / total`; không tô xanh UNAVAILABLE. Hiển thị số UNAVAILABLE riêng.
- Bảng kết quả: tên/moduleKey, packageVersion, classification, MIC, pass/warn/fail counts, scanStatus, 'Chi tiết'.
- Tìm kiếm theo moduleName/moduleKey; lọc status. Client-side lọc snapshot, không kích hoạt scan.
- Empty state với minh họa nhỏ bằng icon AppShell sẵn có (không thêm thư viện UI ngoài).

## Drawer chi tiết

- Desktop: panel cố định bên phải, rộng khoảng 40vw, `max-width: 680px` và tối thiểu đủ đọc; overlay backdrop.
- Mobile: full-screen / sheet phù hợp với breakpoints hiện có.
- `role=dialog`, `aria-modal=true`, tiêu đề truy cập được, nút Close, Escape, click backdrop, focus đúng khi mở/đóng, ngăn scroll nền.
- Sections: Overview, File/MIC Details, Checks, Issues, Registry, Hash.
- Một issue hiển thị `code`, `severity`, `relative path`, JSON field path, `expected`, `actual` đã truncate/redact, hướng khắc phục.
- Không mở detail thành hàng nằm dưới bảng, không scroll trang tới cuối để xem lỗi.

## Permission

UI chỉ render nút khi `can('foundation.module_registry.read') && can('foundation.module_registry.create')`. Server là nguồn cuối cùng. Không chỉnh SCREEN_ACCESS hoặc menu hiện có chỉ để mở rộng quyền.

## Accessibility, chất lượng

- Bảng có header rõ, error banner `role=alert`.
- Không chỉ truyền trạng thái qua màu, phải có chữ/numbers.
- Bảo đảm tab navigation và keyboard.
- Drawer không chiếm vĩnh viễn toàn màn hình desktop.
- Dùng CSS và icon hiện có, không thêm theme, animation nặng, thư viện chart.
- API parser sử dụng schema runtime đảm bảo response khác contract không làm trắng UI; báo `UNEXPECTED_RESPONSE` cho developer mà không lộ secrets.
