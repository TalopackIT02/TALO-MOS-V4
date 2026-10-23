# FMI-01 — Bảo vệ Module Host / modules:sync

## Vấn đề xác minh trên repository

`backend/scripts/modules-sync.mjs` hiện:

1. Quét mọi child folder dưới `modules/` có `module.json` hợp lệ.
2. `rmSync(outDir,{recursive:true,force:true})` trên `backend/src/installed-modules` / `frontend/src/installed-modules`.
3. Copy source và sinh `registry.ts`.
4. Được gọi từ `predev`, `prebuild`, `pretest`, `pretypecheck`.

Do đó chỉ chép candidate chưa được kiểm thử vào `modules/` có thể làm Host/Frontend dùng code chưa được chấp thuận ở lần build/restart. Đây là rủi ro độc lập với nút Scan (API scan có thể read-only nhưng prebuild đã sync package).

## Yêu cầu bảo vệ

- Scanner phải tách khỏi chức năng runtime sync. Không gọi sync từ scan.
- Khi thiết kế cơ chế chỉ nạp package deployed, **ưu tiên duy trì danh sách installed thực đã được nghiệm thu** (đọc baseline local/DB và commit), không đoán rằng tất cả folder tồn tại đều ACTIVE.
- Candidate mới chưa READY không thể thay thế package đã installed qua `npm run dev|build|test` do script pre-hook.
- Không xóa package đã installed hoặc làm mất route của module ACTIVE.
- Không làm `modules:sync` phá generated registry khi có folder scan-only lỗi.
- Không dùng DB trạng thái `ACTIVE` đơn độc để xác định path triển khai nếu chưa có mối liên kết bản build/package hash hợp lệ; thiếu bằng chứng thì dừng và báo BLOCKED.
- Không gỡ khả năng xây local module đã được chấp thuận; giải pháp compatibility cần tests.

## Trình tự kỹ thuật khuyến nghị

1. Chụp baseline: branch, sha, existing installed packages/version, tất cả module route và menu hiện có, `modules:sync` behavior.
2. Dùng fixtures cô lập của modules-sync để tái hiện hiện tượng candidate copy đè installed code.
3. Đề xuất rào nguồn installed runtime phù hợp architecture hiện có (explicit deployed selection/manifest do hệ thống build tin cậy cung cấp), tuyệt đối không allowlist rỗng hoặc đọc `package.json` tùy ý như được duyệt.
4. Nếu phải thay đổi `modules-sync.mjs`, giới hạn thay đổi, thêm unit tests và regression cho installed packages hiện hữu.
5. Đảm bảo Scanner vẫn thấy mọi folder candidate; Host chỉ nhìn thấy phần được phép triển khai, không nhập nhằng hai mục tiêu.
6. Kiểm tra route Host và AppShell không bị mất sau dev/build; riêng SYSTEM_TEST local có thể là 1.1.1, DATA_INSPECTOR 0.1.0. Không checkout lại source cũ GitHub.
7. Nếu chưa thể bảo đảm bảo vệ runtime trong FMI-01 mà không thực hiện FMI-03, **không claim DONE**; ghi PARTIAL/BLOCKED và dừng những thay đổi có nguy cơ.

## Không được làm

- Không thay đổi `mountModules` để bỏ IAM/lifecycle.
- Không bỏ handshake `TALO-MODULE-HOST-1`.
- Không vô hiệu hóa prebuild cho toàn hệ thống rồi khiến registry stale.
- Không reset/delete generated folders đang phục vụ runtime mà không có snapshot và rollback test.
- Không cài đặt candidate thông qua Scan API.
- Không cho server import code từ folder chưa được phê duyệt.

## Rollback

Trước khi sửa sync/registry, có backup trạng thái local và file diff. Nếu tests chứng minh Host hồi quy hỏng, restore **chính xác file thay đổi của FMI-01** về baseline đã ghi nhận, không `git reset --hard` toàn repo và không sửa dữ liệu DB.
