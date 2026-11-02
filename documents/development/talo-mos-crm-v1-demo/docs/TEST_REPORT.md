# CRM V1 REV02 — Test Report

**Ngày:** 29/10/2026 · **Scope:** Offline Mock service / workflow adapter / source structure.

- `npm test`: **51/51 PASS**, exit 0.
- 39 test Backend REV01 từ REV01 được giữ nguyên, tất cả PASS.
- Thêm 12 test workflow REV02 (W01-W12) gồm tạo/cập nhật/hủy Schedule, nhắc lịch, To-do chung store, hoàn thành, báo cáo từ activity gốc, IAM scope và điều hướng 5 mục.
- Schema: giữ đúng dictionary tham chiếu **15 bảng/173 cột** (baseline 11/114), 40 endpoint.
- `check:syntax`: PASS TS/TSX parser; shim typecheck phụ PASS; `npm run build`: BLOCKED do thiếu React/Vite dependencies.
- Mọi tiêu chí UI/UX trình duyệt phải để **NOT_TESTED** cho đến khi cài dependencies và nghiệm thu trực tiếp.
- 50 backend cases trong tài liệu gốc vẫn mang trạng thái đối chiếu REV01 ở `TEST_CASES_50.csv`; không tự nâng các case BLOCKED/NOT_TESTED thành PASS.

Xem `docs/BUILD_STATUS.md`, `docs/GAP_REPORT_REV02.md`, `docs/FRONTEND_ACCEPTANCE_STATUS.md` và `docs/TEST_RUN_TAP.txt`.
