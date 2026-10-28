# TALO-MOS-V4 — BÁO CÁO TỔNG HỢP CHI TIẾT SCC

**Ngày biên soạn:** 27/10/2026  
**Nguồn gần nhất:** `CLAUDE_CODE_CONTINUATION_HANDOFF_20261027-201021.zip` + `SCC_PHASE2_ACCEPTANCE_PACKAGE_20261027-200250.zip`  
**Branch được báo cáo:** `feat/iam-admin-inheritance-20261024`  
**HEAD được báo cáo:** `0e491a3fac77801488739f3cd95f99845bbcd69e`  
**Quyết định vận hành hiện tại:** `DB-APPROVAL REQUIRED`; chưa được tự ý triển khai.

---

## 1. Mục tiêu dự án và phạm vi của SCC

TALO-MOS-V4 gồm Foundation (hạ tầng tích hợp và vòng đời module), IAM (tài khoản và phân quyền), AppShell, các module nghiệp vụ và công cụ quản trị SCC. SCC phải cho phép Administrator kiểm soát/kiểm tra hệ thống qua giao diện, không cần thực hiện mọi tác vụ qua pgAdmin/terminal. SCC **không** thay Foundation hoặc IAM, và việc có vai trò Administrator trong ứng dụng **không** tự sinh SQL GRANT trong PostgreSQL.

Sáu màn hình đã được thiết kế/đăng ký:

| # | Màn hình | Phạm vi chức năng |
|---|---|---|
| 1 | System Health / Diagnostics | Tình trạng dịch vụ, chẩn đoán và chỉ số liên quan |
| 2 | Test Results | Đọc các kết quả kiểm thử/artifact có kiểm soát |
| 3 | Data Inspection | Tra cứu dữ liệu read-only và masking theo phạm vi cho phép |
| 4 | Foundation & Module / Architecture | Module, version, functions/actions, cấu trúc tích hợp |
| 5 | IAM Access Matrix | Kiểm tra quyền hiệu lực, nguồn quyền và Direct DENY |
| 6 | System Audit Logs | Đọc audit Foundation/IAM và thống kê audit |

**P2 — System Coordination rộng hơn và Database Access Contract tổng quát cho module tương lai chưa được mở rộng/hoàn thành.** Gói hiện tại ưu tiên sửa P0/P1 của sáu màn hình và Installer.

### Nguyên tắc kiến trúc không được thay đổi

- `TALO_SYSTEM_ADMIN` đang hợp lệ kế thừa động các Function/Action permission được định nghĩa, kể cả module tương lai, **không cần grant thủ công**.
- `Direct DENY` có hiệu lực vẫn thắng; account/session/assurance và lifecycle ACTIVE/ENABLED vẫn phải được kiểm tra.
- SCC còn có **Administrator Gate độc lập**; Manager không được vào SCC dù cố được gán ALLOW.
- Backend truy cập PostgreSQL qua DB role kỹ thuật, hiện là `talo_app`. IAM xác định **người dùng**, PostgreSQL giới hạn **năng lực truy vấn của dịch vụ**.
- Không tạo quyền toàn bộ DB cho `talo_app`, không sử dụng PostgreSQL superuser làm runtime và không sửa immutable SCC 0.1.0.

---

## 2. Lịch sử công việc — phân biệt người thực hiện

| Giai đoạn | Người/công cụ theo hồ sơ | Đã thực hiện | Kết quả bằng chứng |
|---|---|---|---|
| 24–26/10, IAM | Claude Code và phiên hướng dẫn trước | IAM Evaluator, Foundation Repository, Navigation Repository, fake/test hỗ trợ Administrator inheritance | `IAM_NAVIGATION_20261026-144727.txt`: 79/79 PASS, Backend/Test TypeScript PASS |
| 26/10, Audit authorization | Gói sửa lỗi SCC | Truy vết 403; xác định permission cũ/sai catalog; sửa Host/SCC source; kiểm tra Manager và Direct DENY | `SCC_AUDIT_AUTH_FIX...`: 394/394 unit tuần tự PASS, targeted 74/74, HTTP regression mới 6/6 |
| 26/10, SCC completion | Work/Codex theo báo cáo gói | Thu hẹp compatibility, sửa Installer/IAM postcheck, đề xuất DB API/SQL, SCC 0.1.1 candidate | 457 PASS, 172 skipped; targeted 41/41; SCC 9/9; DB cô lập PASS |
| 27/10, SCC Phase 2 | Work/Codex theo handoff hợp nhất | Hoàn thiện release tự chứa, SQL/verify/rollback, preflight cuối và chứng cứ TEST read-only | 458 PASS, 172 skipped; targeted 50/50; SCC 9/9; FMI-02 READY |
| Tại thời điểm handoff | Chưa ai được phê duyệt thực hiện | DB migration TEST, journal recovery, deploy, Installer 0.1.1, UI acceptance | **PENDING** |

Tên gọi “ChatGPT Work/Codex” trong tài liệu này dùng để chỉ phần việc được handoff quy cho Codex sau giai đoạn Claude Code. Không suy diễn rằng mọi thay đổi đều đã được commit vào Git.

---

## 3. ChatGPT Work/Codex đã làm gì — phân tích kỹ thuật

### 3.1 IAM Administrator Inheritance

- Hỗ trợ nguồn quyền động `TALO_SYSTEM_ADMIN` thay vì phải tạo record ALLOW cho từng Function/Action.
- Luồng authorization giữ permission definition hợp lệ, account ACTIVE/not disabled, role hiệu lực, Direct DENY, assurance, module lifecycle.
- Foundation Navigation và IAM effective access logic được cập nhật/kiểm tra ở các giai đoạn trước để phản ánh quyền Administrator.
- Installer `IAM_POLICY` đã được điều chỉnh để công nhận kế thừa động là nguồn policy hợp lệ, **không tự tạo IAM grant**.
- Các regression mới xác minh Manager bị chặn, Direct DENY vẫn thắng, role/contract không thuộc phạm vi không bị canonicalize ngoài ý muốn.

**Giới hạn:** Chưa có nghiệm thu sáu màn hình cuối bằng session Administrator/Manager thật sau release 0.1.1.

### 3.2 Tìm đúng nguyên nhân 403 Audit Logs

Luồng đã được truy vết:

`SystemLogsTab.tsx` → `GET /api/system-controller-center/audit/logs` → SCC Administrator Gate → `SystemAuditService` → Module Host → Foundation AccessGuard/evaluator.

- SCC immutable 0.1.0 gửi: `system_controller_center.audit.read`.
- IAM Catalog K05 chuẩn: `system_controller_center.audit_log.read` (`SYSTEM_CONTROLLER_CENTER / AUDIT_LOG / READ`).
- Kết quả ban đầu: `PERMISSION_NOT_DEFINED` → HTTP 403 `FORBIDDEN`; Navigation vẫn hiện do đánh giá K05 triple.
- Ban đầu có cách chuẩn hóa rộng hơn theo module. Phase 2 **đã thu hẹp compatibility chỉ còn alias chính xác của SCC 0.1.0**; không làm thay đổi permission code module khác.
- Source SCC dùng cho 0.1.1 đã thống nhất với catalog.

**Giới hạn:** HTTP tương đương 200 trong probe không có nghĩa dữ liệu audit đã AVAILABLE.

### 3.3 Phát hiện lỗi PostgreSQL sau khi IAM đã cho phép

- DB runtime role: `talo_app`.
- Bảng nguồn: `foundation.fnd_audit_logs`, `iam.iam_audit_logs`.
- Raw SELECT trả SQLSTATE `42501` vì thiếu database privilege; lỗi này **khác** IAM 403.
- Candidate 0.1.1 thử gọi các function chưa có trên TEST → SQLSTATE `3F000`, `complete=false`, cả hai nguồn `UNAVAILABLE`. Đó là kết quả đúng với thực trạng DB chưa migration.

**Quyết định thiết kế:** Không GRANT raw `SELECT` cho `talo_app`. Thay bằng database API qua ba hàm với projection giới hạn và quyền EXECUTE.

### 3.4 Thiết kế Database Access — đã viết và thử ở môi trường cô lập

**SQL artifacts:** `DATABASE_MIGRATION.sql`, `DATABASE_APP_VERIFICATION.sql`, `DATABASE_ROLLBACK.sql`, `DATABASE_PRIVILEGE_MANIFEST.md`.

**Đối tượng mới đề xuất:**

1. Cluster role `talo_audit_reader`: `NOLOGIN`, `NOINHERIT`, không superuser, không bypass RLS và không quyền tạo database/role.
2. Schema `audit_api` trong `talo_mos_v4_test`.
3. Ba `SECURITY DEFINER` functions:
   - `audit_api.read_foundation_audit(...)`;
   - `audit_api.read_iam_audit(...)`;
   - `audit_api.read_foundation_audit_summary(...)`.
4. `talo_audit_reader`: USAGE schema Foundation/IAM và SELECT **theo cột** trên hai bảng audit và `iam.iam_user_accounts(user_account_id, username)`.
5. `talo_app`: USAGE schema `audit_api`, EXECUTE đúng ba function; **không** nhận direct SELECT bảng audit.
6. `PUBLIC`: không có quyền trên schema/function audit_api (theo script đề xuất).

**Rào giới hạn function:** nguồn/trường cố định; action/outcome/filter validate; audit reader tối đa 31 ngày và 501 dòng, summary 24 giờ; timeout khai báo 5 giây; fixed `search_path=pg_catalog`; không dynamic SQL; không trả raw metadata, chỉ các field `reason`/`errorCode` được lọc.

**Bằng chứng isolated PostgreSQL 18:** Foundation 2 dòng mẫu, IAM 1 dòng mẫu, summary DENIED=1/FAILURE=0; raw SELECT bằng `talo_app` bị `42501`; caller ngoài hợp đồng bị `42501`; input không hợp lệ bị `22023`; rollback PASS.

**Chưa triển khai:** chưa chạy bất kỳ script mới nào trên TEST. `audit_api` chưa tồn tại trong TEST theo kiểm tra read-only của hồ sơ.

**Lưu ý quan trọng:** `DATABASE_MIGRATION.sql` hợp nhất chứa `\connect postgres` rồi `\connect talo_mos_v4_test`, là cú pháp của `psql` (không phải SQL thông thường trong pgAdmin Query Tool). Claude Code phải dùng công cụ thích hợp hoặc tách/chạy các file 01–05 đúng database, đúng quyền, không bỏ qua guards. Thao tác `CREATE ROLE` là ở cấp PostgreSQL cluster và ownership transfer cần role quản trị có đủ quyền thực thi; cần xác minh trước khi chạy TEST.

### 3.5 Installer postcheck đã được sửa ở source

- `IAM_POLICY` postcheck hiểu Administrator inheritance động (không đòi static ALLOW giả).
- MIC-05 `readProbe.query` cho phép placeholder đáng tin cậy `$moduleKey` và `$actorAccountId`.
- Sửa các request từng trả 400 do thiếu `moduleKey` hoặc `accountId`.
- Bổ sung **response assertions** để phân biệt HTTP 200 với payload dùng được.
- Với Audit Logs, chỉ PASS khi đồng thời có:
  - `logs.complete === true`;
  - `logs.sources.FOUNDATION.state === 'AVAILABLE'`;
  - `logs.sources.IAM.state === 'AVAILABLE'`.
- Có unit tests cho các thay đổi và regression.

**Chưa triển khai:** nguồn đã sửa chưa đồng nghĩa Installer ở TEST đã chạy lại; journal 0.1.0 cũ vẫn `RECOVERY_REQUIRED`.

### 3.6 Đóng gói SCC 0.1.1

- Artifact: `SCC_0.1.1_RELEASE.zip`.
- Trong Phase 2 package: **49 mục**, đủ backend, frontend, MIC, database scripts, tests, README và manifest.
- SHA-256 ZIP: `db96d4b1aaec6c93336dada304cb240b78d6f1306c410045544f93b84e993d3d`.
- Foundation package hash: `576eed9a74566b99e805200af06fbc8f4ee158b510baa488b9224cf2357a2eb2`.
- FMI-02 candidate: `e42284db-7cdc-44e1-b6fa-7121f6c3011f`.
- FMI-02 run: `c0f6f8bd-b4c4-43e2-ba25-e651867051ad`.
- Kết quả: `READY`, 9 PASS, 0 FAIL, một P8 `NOT_TESTED` tùy chọn, P5b `NOT_APPLICABLE`.
- Immutable release `backend/module-releases/SYSTEM_CONTROLLER_CENTER/0.1.0` được báo cáo không sửa, lock SHA-256 `f049fb885d8b87e63cac9d7cc1a072641aa36a50bed0438f19889b4f67bc9238`.

**Chưa triển khai:** SCC 0.1.1 chưa được Installer cài/cutover; runtime vẫn 0.1.0.

---

## 4. Kết quả kiểm thử — hiểu đúng giá trị bằng chứng

| Đầu việc | Kết quả báo cáo mới nhất | Bằng chứng/ý nghĩa |
|---|---|---|
| Backend TypeScript | PASS | Typecheck source/test không lỗi |
| Backend Build | PASS | Compile/build thành công |
| Frontend TypeScript/Build | PASS | 99 modules theo báo cáo trước; còn cảnh báo bundle lớn, không phải lỗi build |
| Full backend regression | **458 PASS, 172 SKIP, 0 FAIL** | 34 file PASS, 23 file skipped; chạy đơn luồng sau khi 5 timeout do tải máy |
| Targeted Foundation IAM/Installer | **50/50 PASS** | Đúng nhóm test sửa mới |
| SCC package contract | **9/9 PASS** | API/MIC/release contract ở mức kiểm thử |
| Foundation FMI-02 | **READY**, 9 PASS, 0 FAIL | Đủ điều kiện preflight; không có nghĩa đã install |
| SQL trên PostgreSQL 18 cô lập | PASS | Quyền/function/negative/rollback, dữ liệu mẫu |
| Inventory TEST | PASS **read-only** | Không chứng minh migration đã chạy |
| Authenticated HTTP/UI sáu màn hình | **PENDING** | Chưa có nghiệm thu live sau triển khai |

**Chú thích lịch sử test:** Gói ngày 26/10 báo 457 PASS/172 SKIP; gói ngày 27/10 cập nhật 458 PASS/172 SKIP. Sử dụng **458** là mốc mới nhất. `SKIP` không được cộng thành PASS. Bộ kiểm thử chạy trước deployment không thay thế runtime acceptance.

---

## 5. Hiện trạng ba lớp hệ thống tại thời điểm handoff

### 5.1 Source/Git

- Local repo theo hồ sơ: `D:\Documents\ClaudeProject\TALO-MOS-V4`.
- Branch: `feat/iam-admin-inheritance-20261024`; HEAD: `0e491a3fac77801488739f3cd95f99845bbcd69e`.
- **Có thay đổi tracked và untracked chưa commit**; không được reset/checkout đè, không thay bằng GitHub main cũ.
- `git diff --check` không có whitespace error; chỉ cảnh báo LF/CRLF trên Windows.
- Thư mục `modules/SYSTEM_CONTROLLER_CENTER/database/` và `database/scripts/scc-audit-read/` là **untracked** phải bảo toàn.

### 5.2 PostgreSQL TEST

- Database: `talo_mos_v4_test`; runtime role: `talo_app`.
- SCC 0.1.0 đang `ACTIVE`, B01/module `enabled=true`.
- Một `TALO_SYSTEM_ADMIN` hợp lệ; static Role ALLOW 0, Direct ALLOW 0, Direct DENY SCC 0 trong inventory; inheritance là đường quyền được dùng.
- `audit_api` 3 function **chưa tồn tại**.
- Đếm/inventory tham chiếu: Foundation audit khoảng **14.207** dòng, IAM audit khoảng **126** dòng; đây là tổng nguồn được báo cáo, không phải cam kết số hàng sẽ trả về trong bộ lọc 24 giờ.
- IAM có index `occurred_at`; Foundation chưa có index thời gian. Query audit có thể chịu ảnh hưởng hiệu năng khi dữ liệu tăng, nhưng **không tự thêm index ở gate hiện tại**.
- Không được dùng kết quả isolated DB thay cho việc xác minh TEST.

### 5.3 Installer/Lifecycle

- Journal id: `d6fa3a06-1707-43c1-84bd-470b4107a78f`.
- Journal: `RECOVERY_REQUIRED` từ cài SCC 0.1.0; lỗi hậu kiểm `ACCESS_VERIFIED`.
- Journal ghi module đã disabled ở giai đoạn recovery nhưng DB hiện enabled=true: **journal không còn khớp snapshot runtime**.
- Journal chưa terminal làm plan cài 0.1.1 bị chặn bởi `INSTALL_IN_PROGRESS`.
- Không được `Continue` 0.1.0 một cách mù; release 0.1.0 vẫn đọc bảng audit thô và postcheck cũ có nguy cơ HTTP 200 giả.
- Cần hoàn thiện/review **Foundation-native operation** để đóng recovery `NEW_MODULE` thất bại thành `FAILED_SAFE` có kiểm soát.

---

## 6. Những việc ChatGPT Work/Codex CHƯA làm — không được hiểu nhầm

| Chưa thực hiện | Lý do chính | Tác động |
|---|---|---|
| SQL migration lên `talo_mos_v4_test` | Chờ chủ dự án phê duyệt DB | Chưa có audit_api, audit vẫn UNAVAILABLE |
| Thao tác close failed recovery native | Chưa hoàn thiện và chưa phê duyệt lifecycle/journal | Journal chưa terminal, 0.1.1 bị chặn |
| Deploy/restart Backend & Frontend code mới | Chờ phê duyệt riêng | TEST chưa thực thi đầy đủ source cuối |
| Installer prepare/commit/continue hoặc cài 0.1.1 | Chờ journal giải quyết và Installer approval | Runtime vẫn SCC 0.1.0 |
| HTTP authenticated + UI acceptance sáu màn hình | Thiếu những điều kiện vận hành nêu trên | SCC chưa nghiệm thu |
| Git commit/push/merge | Chưa phê duyệt | Thay đổi vẫn ở working tree local |
| Mở rộng System Coordination P2 | Chủ động hoãn để ưu tiên P0/P1 | Chưa có trung tâm điều phối đầy đủ theo tầm nhìn dài hạn |

### Vì sao không thể coi SCC đã hoàn thành?

`source/build PASS` chỉ xác nhận mã xây dựng được; `FMI-02 READY` chỉ xác nhận candidate đủ điều kiện preflight; SQL isolated PASS không tạo function trên TEST; database 0.1.0 ACTIVE/enabled không đồng nghĩa journal đã đóng. Thêm nữa, audit service có thể trả HTTP 200 với `complete=false`; không được chấp nhận như kết quả đọc audit thành công.

---

## 7. Claude Code cần làm tiếp — nhóm nhiệm vụ theo trình tự an toàn

### A. Tiếp nhận, giữ nguyên working tree và xác minh nguồn

- Xác minh đúng local repository/branch/HEAD; kiểm tra `git status --short`, tracked/untracked, current diff; đối chiếu gói Phase 2 và source hiện tại.
- Lập snapshot/patch an toàn của **toàn bộ** thay đổi chưa commit, bao gồm untracked, không gây ghi lên DB.
- Xác minh hash ZIP release/package và tình trạng immutable 0.1.0.
- Không cần viết lại các phần đã PASS nếu source vẫn khớp; chỉ test lại phần bị thay đổi hoặc trước gate quan trọng.

### B. Gate DB — trình phê duyệt và chỉ chạy nếu được chủ dự án duyệt rõ

- Đối chiếu chính xác `DATABASE_MIGRATION.sql`, `DATABASE_APP_VERIFICATION.sql`, `DATABASE_ROLLBACK.sql`, DB object privilege manifest với TEST read-only mới nhất.
- Xác minh thao tác tạo cluster role, transfer function ownership, môi trường chạy `psql` hoặc script tách 01–05, guards và quyền của người triển khai.
- Chuẩn bị phiếu phê duyệt gồm SQL checksum, đối tượng/đặc quyền trước–sau, ảnh hưởng, rollback và bằng chứng isolated.
- **Khi và chỉ khi có phê duyệt:** thực thi đúng script đã duyệt trên đúng `postgres`/`talo_mos_v4_test`; verify catalog, owner, EXECUTE, raw SELECT denial, function result; rollback nếu bất kỳ tiêu chí bắt buộc nào fail theo phạm vi rollback được duyệt.
- Phân biệt **quyền truy vấn hoạt động** với **thực sự có record trong time window** (0 rows có thể do lọc thời gian, không tự kết luận mất quyền).

### C. Hoàn thiện native Installer Recovery và kiểm thử

- Thêm Foundation Installer service operation riêng để đóng **failed NEW_MODULE journal** vào `FAILED_SAFE`.
- Chỉ áp dụng `RECOVERY_REQUIRED`, classification `NEW_MODULE`, không recovery point; yêu cầu actor có permission phù hợp và acknowledgement rõ.
- Serialize qua module lock; re-read journal, B01/B02 ngay trong operation; xử lý stale state bằng chính Lifecycle service.
- Nếu B01 đang enabled: gọi Lifecycle `DISABLE` có audit, đọc lại xác nhận disabled.
- Terminalize journal qua InstallerStore/service; không sửa JSON hay B01/B02/B07/B08 trực tiếp, không xóa dữ liệu release/navigation/lock.
- Bổ sung unit/regression/integration-safe tests cho wrong journal, wrong permission, concurrent updates, module already disabled, failure-atomic behavior và stale state.
- **Chỉ viết code + chạy test**; không thực thi trên TEST trước approval lifecycle/journal và deploy tương ứng.

### D. Deploy/restart / journal reconciliation — phê duyệt tách biệt

- Khi DB PASS, code native operation review/test PASS, xin phê duyệt deploy/restart để runtime chạy đúng source đã kiểm tra; không chạm immutable release 0.1.0.
- Xin **approval lifecycle/journal riêng** để gọi operation và ghi nhận trạng thái trước–sau; không tự suy diễn deploy approval cho phép sửa journal.
- Xác minh journal chuyển terminal `FAILED_SAFE`, module state phù hợp và không mất registration/navigation.

### E. Cài SCC 0.1.1 — phê duyệt Installer riêng

- Sau khi old journal terminal và DB functions có mặt, lập mới plan 0.1.1; kiểm tra `UPGRADE` recovery point, MIC diff, lifecycle, lock, blockers.
- Không dùng lại candidate ID cũ như bằng chứng trạng thái hiện tại nếu source/runtime đã đổi; chạy lại preflight khi cần.
- Chỉ commit/cutover 0.1.1 sau **Installer approval**. Nếu fail, áp dụng recovery chính thức, không sửa JSON/B01/B02 thủ công.

### F. Runtime/Frontend acceptance, audit và bàn giao cuối

- Chạy sáu màn hình SCC qua session Administrator hợp lệ; xác minh API status, payload và UI hiển thị đúng.
- Chạy Manager 403, Direct DENY, locked account, assurance/lifecycle negative tests trong phạm vi an toàn.
- Audit Logs chỉ PASS với HTTP 200 + `complete=true` + Foundation/IAM `AVAILABLE` + bằng chứng truy vấn dữ liệu nguồn thực sự; một cửa sổ thời gian không có event phải được phân biệt với lỗi DB.
- Xuất bằng chứng gắn timestamp, query contract và SQLSTATE/response; tổng hợp PASS/FAIL/NOT_TESTED từng chức năng.
- Git commit/push/merge chỉ được thực hiện khi có approval Git riêng.

---

## 8. Điểm kỹ thuật cần Claude Code kiểm tra trước thay đổi thật

1. **`psql` meta commands:** File SQL hợp nhất chứa `\connect`; không chạy nguyên văn trong Query Tool pgAdmin. Dùng đúng công cụ hoặc các file SQL đã tách, sau khi xác minh nội dung tương đương.
2. **Cluster scope:** `CREATE ROLE talo_audit_reader` ảnh hưởng PostgreSQL cluster, dù GRANT/function nằm trong TEST. Việc `DROP ROLE` không được tự động; rollback giữ role để review.
3. **SECURITY DEFINER:** kiểm tra owner, fixed search_path, column-level grants, REVOKE PUBLIC, login/membership path và chữ ký 3 function; không chỉ kiểm tra file tồn tại.
4. **Không bắc cầu IAM → SQL quyền cá nhân:** `talo_app` là role dùng chung; mọi code chạy với credentials của nó có thể gọi các function đã cấp. Phải giữ SCC Administrator Gate và audit/authorization ở Backend.
5. **Runtime 0.1.0 không được hưởng lợi trực tiếp từ migration mới:** release 0.1.0 dùng raw SELECT; cần SCC 0.1.1 mới gọi `audit_api`.
6. **Audit count:** cửa sổ kiểm thử 24 giờ có thể trả 0 record dù function đúng; bằng chứng nghiệm thu phải sử dụng nguồn dữ liệu thực hợp lệ và không tự tạo sự kiện giả trên TEST.
7. **Hiệu năng:** `foundation.fnd_audit_logs` thiếu index `occurred_at` theo inventory; 5 giây timeout có thể bị chạm khi tăng dữ liệu. Không tự mở rộng DB migration để tạo index nếu chưa phê duyệt.
8. **Stale journal:** thời điểm journal disabled và DB enabled khác nhau; không được ép theo snapshot journal cũ hoặc bấm Continue chưa kiểm soát.
9. **Snapshot local:** release ZIP là release ứng viên, **không phải** bản sao đầy đủ Git working tree có `.git` và tất cả thay đổi chưa commit.
10. **Approval rõ ràng:** tài liệu bàn giao không chứa sự phê duyệt ngầm của chủ dự án đối với bất kỳ thao tác ghi thật nào.

---

## 9. Quyết định cần chủ dự án theo từng gate

| Gate | Chủ dự án duyệt cụ thể | Không được suy rộng sang |
|---|---|---|
| DB | Tạo cluster role; schema/function/GRANT trên TEST theo migration hash đã xem; verify/rollback | Installer, journal/lifecycle, deploy, Git, DEV/PROD |
| Deploy | Deploy/restart đúng source đã test lên môi trường được chỉ định | Ghi DB/journal, cài release, Git |
| Journal/Lifecycle | Native close failed NEW_MODULE journal, DISABLE nếu cần, ghi `FAILED_SAFE` | Installer cutover 0.1.1 |
| Installer | Prepare/commit/cutover SCC 0.1.1 sau preflight mới | Git commit/push/merge hoặc PROD |
| Git | Commit, push, merge: mỗi thao tác có phạm vi được chỉ định | Deploy/DB nếu chưa được cấp phép |

**Gate hiện tại từ bộ nguồn: DB-APPROVAL REQUIRED.** Không có lời phê duyệt thực thi migration trong gói tài liệu này.

---

## 10. Kết luận quản trị dự án

- **Completed (source/test):** IAM inheritance/compatibility, Installer postcheck ở mã nguồn, SCC audit database API 0.1.1, SQL migration/rollback đề xuất, automated tests và preflight.
- **Pending (runtime):** triển khai quyền PostgreSQL thật; reconcile journal; deploy; cài 0.1.1; nghiệm thu sáu màn hình và phân quyền người dùng.
- **Future, không thuộc nghiệm thu P0/P1:** mở rộng SCC thành trung tâm điều phối đầy đủ hơn và Database Access Contract tổng quát để tích hợp module trong tương lai.

**Chỉ công bố “SCC 0.1.1 ACCEPTED ON TEST” khi có bằng chứng sau migration, journal terminal, Installer success, audit dữ liệu AVAILABLE và nghiệm thu đầy đủ từng màn hình.**
