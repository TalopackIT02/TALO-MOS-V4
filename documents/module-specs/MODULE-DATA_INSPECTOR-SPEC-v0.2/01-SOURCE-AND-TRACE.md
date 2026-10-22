# 01 — Nguồn chứng cứ và truy vết

> TALO-MOS-V4 | DATA_INSPECTOR | Hồ sơ v0.2 DRAFT | Package/MIC dự kiến 0.1.0 | 22/10/2026 | Repo `main` `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`
> USER REVISED SCOPE (22/10/2026). Chỉ thiết kế; không cấp IAM/SQL privileges, không sửa Foundation/Host, không deploy. Bằng chứng runtime: NOT_TESTED.

## Source Register

| ID | Nguồn | Mức chứng cứ |
|---|---|---|
| SRC-USER-22 | Chỉ đạo trực tiếp 22/10/2026: admin-only, hardcode username `admin`, xem toàn bộ bảng PostgreSQL, chỉ đọc | **CONFIRMED_FROM_USER**, ưu tiên cao hơn đề xuất DRAFT cũ |
| SRC-DRAFT | ZIP `TALO_DATA_INSPECTOR_DEVELOPMENT_DOSSIER_v0.1_DRAFT.zip` và hồ sơ v0.1 (13 file) | USER_SUPPLIED, dùng thông tin kỹ thuật; các giới hạn application schema/highest-class của bản cũ **bị thay thế** |
| SRC-GOV | ZIP AI Governance v0.1 | DRAFT, không ACTIVE policy |
| SRC-SKILL | tmos-module-creator / MIC, Host, IAM, delivery contract | Baseline thiết kế; không chứng minh runtime |
| SRC-REPO | GitHub `main` HEAD `fafc4d5f5e0215d40dc9ee7308d23973d1a7b19d`: `auth.repository.ts`, `auth.service.ts`, `foundation.navigation.service.ts`, `foundation.permissions.ts`, `module-host/contract.ts` và `capabilities.ts` | **VERIFIED_REPO 22/10/2026**; chưa kiểm tra DB live |

ZIP đầu vào nguyên thủy được bản DRAFT nhắc đến chưa có trong các file này; không tuyên bố đã đọc trực tiếp HTML/BR gốc.

## Yêu cầu chính và trạng thái

| ID | Nội dung | Loại |
|---|---|---|
| REQ-001 | Danh sách **toàn bộ bảng** PostgreSQL mọi schema, không giới hạn application schema | CONFIRMED_FROM_USER |
| REQ-002 | Xem nội dung/kiểu cột và dữ liệu từng bảng, không sửa | CONFIRMED_FROM_USER |
| REQ-003 | Chỉ username chính xác `admin` có thể thấy module; user khác không thấy menu | CONFIRMED_FROM_USER; G7 BLOCKER |
| REQ-004 | Mọi backend API hardcode điều kiện account `admin` | DERIVED từ yêu cầu gắn cứng; thiết kế kỹ thuật |
| REQ-005 | Không thay đổi IAM–Foundation, không tạo quyền SQL | CONFIRMED_FROM_USER và phạm vi từ yêu cầu gốc |
| REQ-006 | Phân trang dữ liệu lớn (mặc định 50, tối đa 100) | PROPOSED |
| REQ-007 | Nếu DB role không đọc được, vẫn liệt kê bảng + trạng thái không đọc được | DERIVED từ READ-only/no GRANT |
| REQ-008 | 3 API GET, Host session/IAM/lifecycle/readOnly | DERIVED/VERIFIED_REPO |

## Traceability

| REQ | Function.Action | Màn hình | API | Dữ liệu / MIC | Test |
|---|---|---|---|---|---|
| 001 | `CATALOG.READ` | Panel trái | `GET /tables` | `pg_class`, MIC05/06/07 | TC-01, TC-08 |
| 002 | `CATALOG.READ`, `ROWS.READ` | Panel phải | `GET /tables/{key}/columns`, `/rows` | `pg_attribute`, source table, MIC05/06/07 | TC-02,03,09 |
| 003 | `CATALOG.READ` | Menu AppShell | B09 + MIC04 | IAM only; chưa có username menu predicate | TC-05,06, G7 |
| 004 | cả hai | Mọi request | cả 3 GET | `iam.iam_user_accounts`, `HostActor.userAccountId` | TC-04,07 |
| 005 | cả hai | Read-only UI | cả 3 GET | `Host.readOnly`, không DDL/GRANT | TC-10,11 |
| 006 | `ROWS.READ` | Phân trang | `GET /rows` | bounded LIMIT/OFFSET | TC-12,13 |
| 007 | `CATALOG.READ`, `ROWS.READ` | Trạng thái bảng | `/tables`, `/rows` | SQL role privilege/RLS | TC-14,15 |
| 008 | cả hai | AppShell | MIC05 | MIC01–10 + module.json | TC-16–23 |

Giới hạn: API trong cột trên viết đường dẫn tương đối sau `/api/data-inspector`, xem 06. Trace không xác nhận endpoint đã được triển khai.
