# 01 — SOURCE BASELINE & VERIFIED FINDINGS

## Độ tin cậy

**Đã đọc code trên GitHub:** `TalopackIT02/TALO-MOS-V4`, branch `feat/system-test-diagnostics-v1-1`, commit `b7b5f071f10b7d98690a2efb1dc843990b834a79` (23/10/2026). Đây là baseline để tìm file, **không khẳng định trùng working tree hiện tại**.

**Người dùng đã gửi từ local:** ảnh Foundation có Manual Scan, SYSTEM_TEST 1.2.0 DRAFT, SYSTEM_TEST 1.1.1 ACTIVE, DATA_INSPECTOR 0.1.0 ACTIVE; preflight SYSTEM_TEST 1.2.0 10/10 PASS sau patch, SHA `463dddfcee36c111fc4a7618ce8ebede6f447c6b7605e0fbe320e1fffd360aec` ở lượt đó. Không mặc định hash vẫn giữ nguyên sau thay đổi tiếp theo.

**Chưa kiểm chứng:** Runtime local hôm nay, database live, kết quả install thử SYSTEM_TEST 1.2.0, trạng thái cleanup FBET, thao tác authenticated API, UI browser full regression. Claude phải xác minh chứ không suy đoán.

## Các sự thật kỹ thuật trực tiếp từ source

| ID | Source | Bằng chứng / vấn đề |
|---|---|---|
| B-01 | `frontend/src/pages/foundation/VersionPanel.tsx` | `micTemplate()` sinh `MAIN.READ`, `/system_test`, `mic05Api: []`, `mic09Compatibility.kind=INITIAL_REGISTRATION`, MIC10 NOT_TESTED khi B02 DRAFT chưa có manifest; tạo hai luồng MIC |
| B-02 | `backend/src/modules/foundation/foundation.installer.service.ts` | `composeMic()` đọc `mic/module.mic.json` Candidate và tạo MIC10 evidence server; `commit()` PUT/submit/approve DRAFT, nhưng `blockersFor()` chặn toàn bộ UPGRADE |
| B-03 | Cùng file, `blockersFor()` | Khi có ACTIVE: `UPGRADE_RECOVERY_UNAVAILABLE`; module đã có nhưng không ACTIVE: `UPGRADE_NOT_SUPPORTED` |
| B-04 | `foundation.lifecycle.service.ts` | Activate bản mới retires ACTIVE trước; không có đường `RETIRED→ACTIVE` đã chứng minh; cutover upgrade không được mở tùy tiện |
| B-05 | `foundation.installer.service.ts` `navigation()` | Dùng B09 nhóm gốc → Function trực tiếp; không thống nhất `AREA→MENU→FUNCTION` của Navigation Builder; kiểm tra bản ghi function tồn tại chưa phân biệt liên kết bị ẩn |
| B-06 | `foundation.navigation.builder.ts`, `NavigationBuilder.tsx` | Có 3 tầng, draft/preview/drag/drop, anchor Develop, save một transaction; giữ cơ chế cũ, không xây builder thứ hai |
| B-07 | `foundation.preflight.ts` | P0–P7 10 checks; P6 chỉ kiểm 401 không session; P5b không có test DB ghi nên được đánh PASS vì không áp dụng: phải diễn giải rõ |
| B-08 | `foundation.installer.service.ts` `postcheck()` | IAM catalog, menu, API 401; chưa chứng minh 200/403 theo principal hợp lệ và response schema thực |
| B-09 | `foundation.installer.service.ts` `runtimeRelease()` | Supervisor `NONE`, bước AWAITING_RESTART yêu cầu restart thủ công rồi tiếp tục; không tự động restart |
| B-10 | `backend/scripts/modules-sync.mjs` | Cơ chế release store `backend/module-releases/` và deployment lock đã có; khi dùng release store, đồng bộ từ release chứ không scan folder candidate |
| B-11 | `frontend/src/pages/foundation/ModuleScreen.tsx` | Scan, Installer, versions panel và danh sách module cùng kéo dài một màn; tab Đăng ký Module thủ công còn hiện |
| B-12 | `frontend/src/pages/foundation/ModuleInstaller.tsx` | Chi tiết từng check và install plan in-line dài dưới trang thay vì drawer/workspace |
| B-13 | `frontend/src/pages/foundation/ModuleScan.tsx` | Scan detail đã dùng drawer, có lọc và thanh trạng thái; tái sử dụng style/hành vi |
| B-14 | `frontend/src/pages/foundation/NavigationBuilder.tsx` | Cây và inventory cùng hai cột; UI dài, chi tiết cần đưa drawer; có `showHidden` và filter FBET |
| B-15 | `frontend/src/routes/shellScreens.ts` | `/foundation/modules` và `/foundation/navigation` là admin screens có permission guard; workspace path mới cần được route hợp lệ và bảo vệ quyền |
| B-16 | `backend/src/modules/foundation/foundation.manifest.service.ts` | PUT manifest chỉ khi DRAFT; SUBMIT xác thực MIC, hash và registry, kèm audit; không bypass để “fix nhanh” |
| B-17 | `backend/src/modules/foundation/foundation.installer.iam.ts` | IAM catalog tạo qua IAM Admin repository, chỉ tạo permission, **không tự gán account/role** |
| B-18 | Tài liệu evidence FMI-01 | Có fixture FBET trùng `/system-test`; snapshot cũ 1.914 `FBET_*` module; source branch mới có logic cảnh báo khi disabled, không suy đoán đã cleanup |

## Baseline local Claude phải ghi trước khi sửa

1. `git status --short`, branch/HEAD, danh sách thay đổi chưa commit.
2. Read-only: database identity `current_database()` = `talo_mos_v4_test` trước bất kỳ integration DB. Không in chuỗi kết nối.
3. B01/B02 trạng thái SYSTEM_TEST và DATA_INSPECTOR, enabled flags; B09 digest và sidebar menus quan trọng; B07/B08 audit baseline. **Không tự sửa.**
4. Runtime release lock, hashes backend/frontend/loaded, Installer store candidates và run hash; verify active release.
5. Tệp `modules/SYSTEM_TEST/mic/module.mic.json` của `1.2.0` và dữ liệu B02 `1.2.0 DRAFT` có MIC mẫu hay không.
6. Existing test commands, package versions, tests skipped/failed có từ trước.
7. Diff local vs GitHub chỉ để xác định vị trí/hành vi, không ghi đè local.

## Những thay đổi đã có, không làm lại

- FMI-01 Manual Scan có snapshot, route conflict, MIC validator, scan drawer.
- FMI-02 Candidate/Preflight có log TXT/JSON và hash.
- FMI-03 Installer có register DRAFT/MIC/submit/approve, release store, runtime lock, steps và hậu kiểm cơ bản.
- Navigation Builder có save draft atomically, Develop anchor và inventory.
- Các source này cần **tích hợp/sửa theo delta**, không rewrite từ đầu.
