# TALO-MOS-V4 — FOUNDATION-REV-01: UNIFIED WORKFLOW

**Ngày:** 23/10/2026 · **Trạng thái:** APPROVED DESIGN INPUT / NOT IMPLEMENTED · **Loại:** Implementation dossier + one-pass agent handoff.

## Mục tiêu sử dụng

Người phát triển module (AI hoặc con người) đặt package hoàn chỉnh vào `modules/<KEY>/`. Chủ dự án thao tác bằng chính Foundation:

`Quét Module (nhấn nút) → Candidate → Kiểm tra & Chạy thử → READY → Xem kế hoạch → Cài đặt & Kích hoạt → hậu kiểm`.

Không copy MIC thủ công, không dùng Claude Code để *add từng module*, không khóa version trước khi có evidence. Claude Code trong đợt này **chỉ được dùng một lần để hoàn thiện Foundation chung**; sau này người dùng cài module qua giao diện.

## Phạm vi của REV-01

- **REV-A (P0):** Nguồn MIC thống nhất; upgrade/recovery; Installer–IAM–B09; phân biệt READY/ACTIVE; nâng chất lượng Preflight; runtime hash & restart.
- **REV-B (P1):** Chuẩn hóa AppShell 4 block; màn hình Danh sách và Workspace; drawer bên phải cho chi tiết/sửa ngắn; popup cho xác nhận; Navigation Builder gọn hơn.
- **REV-C (P0/P1):** Test, dữ liệu FBET, API contracts, regression và evidence; không làm nhiễu dữ liệu thật.

## Quy tắc tiết kiệm token cho Claude Code

1. Đọc `CLAUDE.md` của repository, **file này**, `02_NON_NEGOTIABLE_GUARDS.md`, rồi `14_CLAUDE_CODE_ONE_PASS_PROMPT.md`.
2. Lập bản đồ thay đổi bằng `01_SOURCE_BASELINE.md` và `12_FILE_MAP_AND_IMPLEMENTATION.md`; xác minh file thật ở local, không dump cả repo vào hội thoại.
3. **Đọc tài liệu theo pha**, không đọc toàn bộ 17 file trước khi code:
   - REV-A: `03_WORKFLOWS_AND_STATES.md`, `05_MIC_VERSION_CONTRACT.md`, `06_INSTALLER_UPGRADE_RECOVERY.md`, `07_NAVIGATION_IAM.md`, `08_PREFLIGHT_CONTRACT.md`.
   - REV-B: `04_UI_UX_TWO_SCREENS.md` và phần UI trong `07_NAVIGATION_IAM.md`.
   - REV-C: `09_API_AND_ERROR_CONTRACT.md`, `10_DATA_AND_SECURITY.md`, `11_ACCEPTANCE_MATRIX.md`.
   - Kết thúc: `13_ONE_PASS_RUNBOOK.md`, `15_HANDOFF_AND_RELEASE.md`.
4. Mỗi pha ghi `evidence/PHASE-*.md` gồm điều đã chứng minh, test, blocker; không in hàng nghìn dòng test/log vào chat.
5. Tái sử dụng các type/service/schema/tests hiện có; không sao chép validator/logic của Foundation để làm bản thứ hai.
6. Báo cáo cuối tối đa 1–2 trang: DONE/PARTIAL/BLOCKED, file, test, blocker, evidence. Không hỏi từng bước; chỉ dừng để xin phê duyệt khi gặp protected scope.

## Thứ tự ưu tiên khi nguồn mâu thuẫn

1. Quyết định/chỉ thị người dùng hiện hành và `CLAUDE.md` trên máy local.
2. Database thực tế, source local mới nhất và các hợp đồng đang được kiểm thử thành công.
3. Source tham chiếu GitHub tại commit `b7b5f071f10b7d98690a2efb1dc843990b834a79` (23/10/2026).
4. Tài liệu FMI-01, FMI-02/03 và bộ hồ sơ này. Các tài liệu này là **đặc tả yêu cầu**, không phải chứng nhận tính năng đã cài.

Nếu local khác GitHub, ghi DIFF trong `evidence/BASELINE.md`, sửa theo local nhưng bảo toàn invariant. Không `checkout`, `reset`, `pull --rebase` hay chép file GitHub đè lên local.

## Quy tắc sử dụng hồ sơ

- Giải nén vào `D:\Documents\ClaudeProject\TALO-MOS-V4\documents\development\`.
- Chạy Claude Code ở **root repository**, đưa prompt `14_CLAUDE_CODE_ONE_PASS_PROMPT.md` (hoặc prompt ngắn ở cuối file này).
- Không giải nén đè `modules/SYSTEM_TEST`; bản `1.2.0` đã là Candidate, `1.1.1` ACTIVE phải được bảo vệ.
- Hồ sơ này **không** tự thay đổi PostgreSQL, mã nguồn, IAM hay runtime; việc thực thi và nghiệm thu là nhiệm vụ Claude Code trên local.

## Nội dung bộ hồ sơ

| File | Vai trò | Đọc khi nào |
|---|---|---|
| 01_SOURCE_BASELINE | Đối chiếu source và các tồn tại đã thấy | Khảo sát |
| 02_NON_NEGOTIABLE_GUARDS | Rào an toàn bất biến | Bắt buộc đầu tiên |
| 03_WORKFLOWS_AND_STATES | Luồng end-to-end và trạng thái | REV-A |
| 04_UI_UX_TWO_SCREENS | Hai màn hình, drawer, popup, Navigation Builder | REV-B |
| 05_MIC_VERSION_CONTRACT | MIC package → Candidate → B02, bằng chứng | REV-A |
| 06_INSTALLER_UPGRADE_RECOVERY | ACTIVE upgrade, cutover, recovery | REV-A |
| 07_NAVIGATION_IAM | B09 3 tầng, K05, quyền thực tế | REV-A/B |
| 08_PREFLIGHT_CONTRACT | P0–P7, mức bao phủ và evidence | REV-A |
| 09_API_AND_ERROR_CONTRACT | API, error envelope, concurrency | REV-C |
| 10_DATA_AND_SECURITY | Database, security, fixtures, no data loss | REV-C |
| 11_ACCEPTANCE_MATRIX | Cổng nghiệm thu có bằng chứng | REV-C |
| 12_FILE_MAP_AND_IMPLEMENTATION | File map, kế hoạch thay đổi tối thiểu | Triển khai |
| 13_ONE_PASS_RUNBOOK | Quy trình chạy một lượt và fail-safe | Thực thi |
| 14_CLAUDE_CODE_ONE_PASS_PROMPT | Prompt gửi Claude Code | Khởi chạy |
| 15_HANDOFF_AND_RELEASE | Báo cáo, rollback, phân định DONE | Kết thúc |
| 16_DECISION_REGISTER | Điểm chốt và quyết định cần chủ dự án phê duyệt | Khi blocked |
| 17_TRACEABILITY | Requirement → file → test → evidence | Kiểm toán |

**Không tạo version Foundation mới, không đổi DB schema hoặc quyền nếu chưa được phê duyệt trong task.**
