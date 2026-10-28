# TALO-MOS-V4 — BẮT ĐẦU TỪ ĐÂY

**Bộ tổng hợp bàn giao ChatGPT Work/Codex → Claude Code**  
**Ngày chốt nguồn:** 27/10/2026  
**Hạng mục:** SCC / IAM Administrator Inheritance / PostgreSQL Audit Access / Installer Recovery  
**Gate hiện tại:** `DB-APPROVAL REQUIRED`

## Mục đích

Bộ tài liệu trả lời hai câu hỏi: **ChatGPT Work/Codex đã làm được gì?** và **Claude Code cần tiếp tục những gì để SCC hoạt động thật trên TEST?** Đây là tài liệu bàn giao/kế hoạch thực thi, **không phải** lệnh cho phép chỉnh database, deploy hoặc Installer.

## Cách đọc

1. `01_BAO_CAO_TONG_HOP_CHI_TIET.md` — nội dung đầy đủ; nguồn sự thật để quản lý tiến độ.
2. `02_CLAUDE_CODE_ACTION_PLAN.md` — từng nhóm việc, điều kiện, gate, tiêu chí dừng và nghiệm thu.
3. `03_MASTER_PROMPT_CHO_CLAUDE_CODE.md` — prompt có thể dán nguyên văn cho Claude Code; không cần chỉ đạo từng bước kỹ thuật.
4. `04_EVIDENCE_VA_QUYET_DINH.md` — vị trí bằng chứng, hash, quyết định cần chủ dự án ký duyệt.

## Kết luận 30 giây

- **Đã làm:** sửa tương thích permission SCC cũ, cơ chế IAM inheritance/postcheck, Installer readProbe, response assertions, code SCC 0.1.1 đọc audit qua 3 hàm PostgreSQL, SQL least privilege, kiểm thử, preflight và gói release đầy đủ.
- **Bằng chứng mới nhất:** Backend 458/458 PASS (172 skipped), targeted 50/50 PASS, SCC contract 9/9 PASS, Preflight 0.1.1 `READY`, SQL thử trên PostgreSQL 18 cô lập PASS.
- **Chưa làm:** chạy SQL trên `talo_mos_v4_test`; xử lý journal `RECOVERY_REQUIRED`; deploy/restart; cài SCC 0.1.1; nghiệm thu sáu màn hình qua trình duyệt/session thật; commit/push/merge.
- **Cần Claude Code:** xác minh working tree hiện tại, hoàn thiện native recovery operation và test, đề trình DB approval theo gói đã có, sau đó chỉ thực thi các thao tác ảnh hưởng thực tế khi có phê duyệt riêng từng gate.

## Cảnh báo nền tảng

**Code complete ≠ TEST deployed ≠ SCC accepted.** Các báo cáo PASS trong gói nguồn không xác nhận 6 màn hình SCC đã vận hành trên TEST. Các file `.sql` dùng `psql` meta-command như `\connect`; không dán nguyên file hợp nhất vào pgAdmin Query Tool mà không xử lý tương thích.

## Nguồn chính

- `CLAUDE_CODE_CONTINUATION_HANDOFF_20261027-201021.zip` (7/7 checksum hợp lệ).
- File lồng bên trong: `SCC_PHASE2_ACCEPTANCE_PACKAGE_20261027-200250.zip` (31/31 checksum hợp lệ).
- Các gói lịch sử: `SCC_AUDIT_AUTH_FIX_20261026-162136.zip` và `SCC_COMPLETION_20261026-192042.zip`.

**Lưu ý nguồn:** Tài liệu này tổng hợp hồ sơ, không có kết nối trực tiếp đến Git working tree/DB TEST của máy Windows. Các mốc runtime/test chỉ được ghi ở mức đã được hồ sơ báo cáo; Claude Code phải xác minh lại trước khi tác động thật.
