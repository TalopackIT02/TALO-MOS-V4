# DATA_INSPECTOR — bằng chứng kiểm thử (DI-02)

Mỗi thư mục `DI-02-<run>/` là một lần chạy thật: `00-run.txt` (thời điểm, HEAD, trạng thái working tree, lệnh, exit
code, số test), các log đã lọc (bỏ dòng logger JSON và mã ANSI — không có giá trị dòng, hash, token hay account id),
`SHA256SUMS`. Log thô chỉ nằm ở máy chạy, không đưa vào repository.

Môi trường: Windows 11, Node v24, PostgreSQL TEST `talo_mos_v4_test`, role `talo_app` (chỉ đọc qua Host `readOnly`).
Không có migration, SQL GRANT, đăng ký module hay cấp quyền IAM thật trong các lần chạy này. Các lần chạy DI-02 / DI-04-PRE
chỉ đọc; DI-03B ghi dữ liệu IAM **fixture** bằng `talo_test_harness` (quyền có sẵn) và xóa hết theo ID (audit B08 giữ lại).

| Lần chạy | Trạng thái | Ghi chú |
|---|---|---|
| `DI-02-20261022-161105` | R1 — có 1 bước FAIL | Bước 03 (`-t FIX-01`): test DB phụ thuộc thứ tự (stub lifecycle chỉ bật sau test đầu). Đã sửa test cho độc lập thứ tự; không đổi assertion. Giữ lại làm hồ sơ. |
| `DI-02-20261022-R2` | Lần chạy DI-02 (thay thế bởi DI-04-PRE cho MIC-10 cuối) | Xem `00-run.txt` |
| `DI-03B-FBET_DI_MVJD8RZ44461` | DI-IAM-DB (FIXTURE) — 7/7 PASS, cleanup 0 dòng còn lại, 10 dòng B08 DENIED giữ lại | IAM/Host/PostgreSQL thật; session admin giả lập, lifecycle stub; K05 fixture, không phải `data_inspector.*` |
| `DI-04-PRE-20261022` | Lần chạy được MIC-10 FINAL tham chiếu (10 bước exit=0) | Xem `00-run.txt` |

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
| DI-IAM-DB (FIXTURE) — IAM runtime trên PostgreSQL TEST với K05 fixture (quyết định chủ dự án DI-04) | DI-03B | PASS |

MIC-10 FINAL: 8/8 PASS, gate kích hoạt Foundation chấp nhận (`activationBlockers` = []). Quyền thật `data_inspector.*` được kiểm ở nghiệm thu sau kích hoạt.

**Sau kích hoạt — nghiệm thu tích hợp, không đưa vào MIC-10 (không thể PASS trước ACTIVATE)**
- Lifecycle thật: ENABLED + 1 ACTIVE → 200; DISABLE / RETIRE → 503.
- Menu B09 `/data-inspector`: chỉ `admin` thấy; tài khoản khác không thấy (và trường hợp cấp nhầm quyền — G7/BL-01).
- AppShell trên trình duyệt: hai vùng, MASKED, phân trang, trạng thái lỗi.
- Đăng nhập thật E2E: `admin` truy cập được, tài khoản khác 403.

## Chạy lại
Lệnh của từng bước nằm trong `00-run.txt`. Kiểm tra tham chiếu MIC-10 sau khi chạy:
`cd backend && TALO_DI_EVIDENCE_VERIFY=1 npx vitest run --config ../modules/DATA_INSPECTOR/tests/vitest.config.mjs -t "evidence files"`
