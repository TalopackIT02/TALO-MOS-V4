# TALO-MOS / Customer Management V1 — Reconcilation v0.2-RC2

- **Ngày:** 2026-10-29
- **Trạng thái:** `EVIDENCE_REVIEWED / DESIGN_CANDIDATE / OWNER_APPROVAL_REQUIRED`.
- **Mục tiêu:** Sau khi nhận toàn văn Claude Code preflight, đối chiếu 27 bảng thiết kế với metadata TEST và quy ước Foundation, cung cấp hồ sơ để chủ dự án PHÊ DUYỆT và sau đó mới cho phép Claude viết **file SQL nháp**.
- **Cấm:** Không có SQL chạy được trong gói; không cấp phép chạy SQL / migration / GRANT; không sửa Foundation/IAM; không thêm bảng, cột, module mới ngoài dictionary và quyết định đã phê duyệt.

## Phạm vi đóng băng
- 11 bảng nghiệp vụ, 10 bảng danh mục CM, 6 bảng Master Data: **27 bảng**.
- `inventory/`: 27 bảng, 195 cột explicit. Một số bảng nghiệp vụ cần quyết định metadata chung; chưa được tự thêm cột hệ thống.
- `03_*`, `04_*`, `05_*`: từ điển **ứng viên**, chưa có owner approval. Đổi tên PK ứng viên phản ánh pattern `<entity>_id` thực tế, nhưng có ngoại lệ PK code/composite cần duyệt.
- `evidence/`: báo cáo Claude và 4 bằng chứng gốc, chỉ metadata không có dữ liệu nghiệp vụ. SHA-256 báo cáo: `ab01201f671587d45dfca68cd71a6f5fc5cc01b5c199cc912bdab0f66d7487d5`.

## Kết luận
- Metadata TEST `talo_mos_v4_test`, PostgreSQL 18.6, role `talo_app`: 25 bảng hiện có (`iam` 11, `foundation` 14); **27 bảng thiết kế không hiện diện** trên TEST, không suy rộng DEV/PROD.
- Installer Foundation không tạo/migrate bảng; theo preflight, chỉ kiểm `MIC-06`, table tồn tại và SELECT của `talo_app`.
- Mọi DDL/GRANT thuộc DB Gate độc lập, cần duyệt quyền và backup/rollback.
- Chưa thể chốt FINAL khi D-CM-01/02/03/07 và quyết định tác động DDL khác chưa có xác nhận của chủ dự án.

## Trình tự sử dụng
1. Đọc `01_EVIDENCE_VERIFICATION.md` và `02_OWNER_DECISIONS.md`.
2. Chọn/điền quyết định ở `10_APPROVAL_FORM.md`; không coi văn bản gợi ý là phê duyệt.
3. Đối chiếu 27 bảng ở `03`, `04`, `05` và `inventory`.
4. Khi đủ phê duyệt, chuyển `09_PROMPT_CLAUDE_SQL_AUTHORING.md` cho Claude Code để tạo **SQL nháp ngoài repo**, không thực thi.
5. Chủ dự án kiểm tra SQL và tạo Gate riêng nếu muốn cài trên TEST; DEV/PROD ngoài phạm vi.
