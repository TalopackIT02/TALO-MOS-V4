# DATA_INSPECTOR — bằng chứng kiểm thử (DI-02)

Mỗi thư mục `DI-02-<run>/` là một lần chạy thật: `00-run.txt` (thời điểm, HEAD, trạng thái working tree, lệnh, exit
code, số test), các log đã lọc (bỏ dòng logger JSON và mã ANSI — không có giá trị dòng, hash, token hay account id),
`SHA256SUMS`. Log thô chỉ nằm ở máy chạy, không đưa vào repository.

Môi trường: Windows 11, Node v24, PostgreSQL TEST `talo_mos_v4_test`, role `talo_app` (chỉ đọc qua Host `readOnly`).
Không có migration, GRANT, ghi dữ liệu, đăng ký module hay cấp quyền IAM trong các lần chạy này.

| Lần chạy | Trạng thái | Ghi chú |
|---|---|---|
| `DI-02-20261022-161105` | R1 — có 1 bước FAIL | Bước 03 (`-t FIX-01`): test DB phụ thuộc thứ tự (stub lifecycle chỉ bật sau test đầu). Đã sửa test cho độc lập thứ tự; không đổi assertion. Giữ lại làm hồ sơ. |
| `DI-02-20261022-R2` | Lần chạy được MIC-10 Candidate tham chiếu | Xem `00-run.txt` |

## Phân loại

**Trước kích hoạt — thuộc MIC-10 (`mic/data-inspector.mic.ts`, `DATA_INSPECTOR_MIC10_CANDIDATE`)**

| Evidence | Bước | Kết quả |
|---|---|---|
| DI-UNIT | 01 | PASS (lần chạy thật) |
| DI-DB | 02 | PASS (PostgreSQL TEST, chỉ đọc) |
| DI-MASK (FIX-01) | 03 | PASS |
| DI-MIC | 04 | PASS |
| DI-HOST (DI-01) | 05 | PASS |
| DI-TYPECHECK | 06–08 | PASS |
| DI-REGRESSION | 09 | PASS |
| DI-IAM-DB — IAM runtime trên PostgreSQL với quyền `data_inspector.*` đã provision (ALLOW chỉ admin, Direct DENY, cấp nhầm cho người khác → 403, audit B08) | — | **NOT_TESTED** — cần phê duyệt provision IAM (BL-02) |

Vì còn DI-IAM-DB `NOT_TESTED`, gate kích hoạt của Foundation (mọi kết quả phải PASS) **vẫn đóng**.

**Sau kích hoạt — nghiệm thu tích hợp, không đưa vào MIC-10 (không thể PASS trước ACTIVATE)**
- Lifecycle thật: ENABLED + 1 ACTIVE → 200; DISABLE / RETIRE → 503.
- Menu B09 `/data-inspector`: chỉ `admin` thấy; tài khoản khác không thấy (và trường hợp cấp nhầm quyền — G7/BL-01).
- AppShell trên trình duyệt: hai vùng, MASKED, phân trang, trạng thái lỗi.
- Đăng nhập thật E2E: `admin` truy cập được, tài khoản khác 403.

## Chạy lại
Lệnh của từng bước nằm trong `00-run.txt`. Kiểm tra tham chiếu MIC-10 sau khi chạy:
`cd backend && TALO_DI_EVIDENCE_VERIFY=1 npx vitest run --config ../modules/DATA_INSPECTOR/tests/vitest.config.mjs -t "evidence files"`
