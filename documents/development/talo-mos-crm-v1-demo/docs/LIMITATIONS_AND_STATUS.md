# Giới hạn và trạng thái trung thực — CRM V1 DEMO

| Đối tượng | Trạng thái demo | Ghi chú |
|---|---|---|
| Database baseline TEST | THEO BÁO CÁO, KHÔNG KẾT NỐI | 11 bảng/114 cột được báo đã cài, chưa có live pg_dump tại phiên xây demo |
| Migration BE REV01 | **CANDIDATE — KHÔNG CÀI** | 4 bảng/56 cột + 3 cột mới, target 15/173; mô phỏng bằng JS |
| API Contract | **MOCK 40/40 route** | Route dispatcher trong `src/mock/service.ts`; HTTP envelope trong `src/mock/handlers.ts` |
| Duyệt pháp lý | **MOCK ONLY** | Contract 40 endpoint thiếu endpoint duyệt; dùng `decideLegal()` nội bộ, không tự dựng API 41 |
| Phân quyền IAM | **SIMULATED** | Phân quyền capability + scope tại mock, không truy cập IAM thật |
| MIC registration | **NOT EXECUTED** | Không tạo/đăng ký/cập nhật MIC |
| AppShell UI | **DERIVED** | Tái dựng theo source GitHub ref `32475d3`, không copy toàn bộ Foundation; logo chỉ dạng text nếu không có asset nhúng |
| Danh mục tỉnh/xã | **VERIFIED SUBSET** | Hà Nội + 3 phường; thiếu 33 tỉnh và 3.318 xã, không phải catalog đủ |
| Vùng kinh tế | **DEMO MAPPING ONLY** | Dùng `DEMO_R1`, không coi là code DB chính thức |
| Định danh/MST | **DEMO FORMAT ONLY** | Dữ liệu DEMO, 10/13 chữ số kiểm format; chưa checksum/đối soát thuế |
| File storage | **BROWSER MEMORY** | File upload không tồn tại sau reload, metadata localStorage vẫn giữ; file seed tạo PDF demo |
| Size tài liệu/cảnh báo | **ASSUMPTION** | 10MB và 30 ngày trong demo, chưa chốt sản xuất |
| Audit/Event Foundation | **MOCK** | Nhật ký trong memory/localStorage, masked, không gửi bus Foundation |
| Order/Kho/Kế toán | **NOT INTEGRATED** | Không có API liên module; không giả số liệu bán hàng/công nợ |
| Handover override | **POLICY NOT APPROVED** | Service chỉ chấp nhận người quản lý có capability + lý do; UI không mở mặc định |
| Concurrency | **SIMULATED** | Copy/commit nguyên khối trong tab; không đạt DB isolation đa trình duyệt |
| HTTPS backend adapter | **DISABLED** | `HttpCrmApi` luôn trả 503; không có URL production |
| Runtime screenshot | **NOT TESTED** | Không có trình duyệt/build dependencies trong môi trường đóng gói |
| npm install | **BLOCKED ENVIRONMENT** | DNS registry.npmjs.org không khả dụng tại môi trường tạo ZIP |
| npm run build | **NOT VERIFIED** | Không có React/Vite dependencies; phải chạy trên máy có npm registry rồi đối chiếu |
| Node Mock Tests | **PASS** | 39/39 tests trực tiếp tại môi trường tạo ZIP |
| TypeScript parse | **PASS** | Tất cả file TypeScript/TSX parse không lỗi, không thay thế typecheck sau cài dependencies |

## Nguồn đã đối chiếu

- Tài liệu bàn giao gốc: `TALO_MOS_CM_V1_FULLSTACK_DEMO_HANDOFF_REV01.zip` do chủ dự án cung cấp.
- GitHub source AppShell snapshot: `https://github.com/TalopackIT02/TALO-MOS-V4/tree/32475d3/frontend/src/layouts` và `frontend/src/styles/app-shell.css`.
- Quyết định 19/2025/QĐ-TTg về mã đơn vị hành chính: https://cms.baochinhphu.vn/bang-danh-muc-va-ma-so-cua-34-tinh-thanh-moi-3321-don-vi-hanh-chinh-cap-xa-moi-102250704153652947.htm
- Cục Thống kê phụ lục mã xã `00070`, `00082`, `00004`: https://www.nso.gov.vn/wp-content/uploads/2025/06/Danh-sach-va-ma-so-cac-don-vi-hanh-chinh-cap-xa.pdf

**Không chạy SQL nào. Không truy cập Database TEST/PROD; không commit hoặc deploy TALO-MOS.**

## REV02 — bổ sung theo Handoff UI/UX & Functional 29/10/2026

- Sidebar REV02 chỉ còn năm mục: Tổng quan công việc, Khách hàng, Lịch hẹn, Công việc, Báo cáo. Những route REV01 về bàn giao/duyệt/nhóm/tài liệu vẫn tồn tại nhưng được dẫn từ Khách hàng hoặc thanh DEMO, không có Sidebar riêng.
- Calendar, To-do và Work Report trong REV02 là **UI trên activity schema hiện có**. `description` được format theo marker DEMO; không có schema mới hoặc bảo đảm migrate.
- Work Report liên kết To-do/Calendar bằng `activity_id` trong mô tả (không có khóa ngoại). Việc định nghĩa FK/API production là một Gap cần quyết định trước tích hợp.
- API POST/PATCH `occurred_at` cho MEETING/NOTE và PATCH CANCELLED lịch là **chỉ Mock**; không khẳng định Backend REV01 production hỗ trợ.
- Bộ kiểm thử được mở rộng thành **51/51 Mock PASS**. Build Vite không xác minh được do thiếu node_modules/npm registry, UI browser acceptance **NOT_TESTED**.
