# CLOSURE-D3 — Route conflict guard khi ENABLE

Trạng thái: **PASS** (unit + DB TEST). Không xóa hay sửa fixture cũ nào.

## Triển khai

Code nằm trong `foundation.lifecycle.repository.ts` và `.service.ts`.

**Thứ tự trong transaction ENABLE**, sau `gate()`:
1. Module lock.
2. `lockRouteClaims`: một khóa chung `pg_advisory_xact_lock(7201, hashtext('foundation.route-claims'))`. Khóa luôn lấy sau module lock nên không có deadlock.
3. `mic04Routes(ACTIVE.manifestJson)` lấy các route từ MIC-04 của bản ACTIVE (bản này vừa qua gate hash).
4. `routeHolders` tìm module khác (`module_id <> $1`) đang ACTIVE + `is_enabled` có route trùng.

**Khi trùng:**
- `RouteConflictError` → `LifecycleError(409, 'MODULE_ROUTE_CONFLICT', ['route@MODULE_KEY', …])`, sắp xếp theo route rồi module.
- Transaction ROLLBACK: `is_enabled` và `updated_at` không đổi.
- Không ghi B07 ENABLE.
- Không ghi B08, theo chính sách gate-refusal hiện hành. Lỗi bất ngờ vẫn đi `logFailure`.

**DISABLE** không lấy route lock.

**Đồng bộ Installer gate:**
- Mã gate đổi `ROUTE_CONFLICT` → `MODULE_ROUTE_CONFLICT`. Không có test hay UI nào dùng mã cũ.
- Cảnh báo cho module đang TẮT nay nói rõ Lifecycle sẽ từ chối bật lại module đó.
- Bước ENABLE của Installer gọi `lifecycle.enable`, nên guard được kiểm lại dưới lock.

**UI:** `foundationMessages.ts` có thông điệp `MODULE_ROUTE_CONFLICT`. Chi tiết `route@module` hiển thị qua `details.errors`.

## Kiểm thử

### RED trước khi sửa

Tắt tạm điều kiện throw:
- Lệnh: `npx vitest run test/unit/foundation/foundation.lifecycle.routes.test.ts`, exit 1.
- Kết quả: **3 failed, 3 passed** (D3-1, D3-2, D3-5 fail).
- Log: `$OUT/t-d3-red.log`. File đã được khôi phục nguyên trạng.

### Unit — `foundation.lifecycle.routes.test.ts`: 6/6 PASS

| Ca | Kiểm |
|---|---|
| D3-1 | 409 với `['/sales/orders@OTHER']`; is_enabled, B07, B08 không đổi; ROLLBACK |
| D3-2 | Kiểu FBET: `/system-test@FBET_A`, `/system-test/runner@FBET_B` |
| D3-3 | Không coi là xung đột: holder tắt, holder chỉ RETIRED hoặc APPROVED, route khác, module không có route |
| D3-4 | Loại trừ chính module (DISABLE rồi ENABLE lại) |
| D3-5 | ENABLE cạnh tranh: 200 + 409; route lock nằm trong transaction, sau module lock, trước khi đọc holders |
| D3-6 | DISABLE không lấy route lock; SQL holders chỉ xét ACTIVE + ENABLED, loại trừ chính module |

### DB TEST — `foundation.lifecycle.db.test.ts` REV01-D3-DB: PASS

**(a) Fixture cũ `FBET_ST_MVJQQP1S_0383C3`** (ACTIVE, đang TẮT, giữ `/system-test` và `/system-test/runner`) so với SYSTEM_TEST 1.1.1 (ACTIVE + bật):
- ENABLE trả **409 `MODULE_ROUTE_CONFLICT`** với `['/system-test@SYSTEM_TEST', '/system-test/runner@SYSTEM_TEST']`.
- `moduleState` (B02, B01 is_enabled / updated_at, số dòng B07 / B08) không đổi; không có dòng B08.
- Fixture vẫn `is_enabled=false`, đã kiểm read-only sau test.

**(b) Race:** hai module của run cùng route riêng `/fbet-<run>-d3`, ENABLE đồng thời:
- kết quả 200 + 409, lỗi nêu đúng module thắng;
- đúng 1 module bật, 0 lock treo, không có 40P01;
- sau đó cả hai được tắt (khối `finally`).

`FP5-1`: ba SQL mới (`reactivateVersion`, `lockRouteClaims`, `routeHolders`) đều plan được với talo_app.

## Ảnh hưởng tới fixture test cũ (đã xử lý, không sửa dữ liệu)

Trên TEST có **208 module fixture FBET ACTIVE + ENABLED cùng giữ `/sales/orders`** (từ `validMic`). Guard mới, đúng nghiệp vụ, chặn mọi fixture mới bật với route đó.

- **Lỗi quan sát:** lifecycle DB V4 / V6 và navigation DB (7 ca) trả 409.
- **Cách xử lý:** chỉ đổi fixture của test sang route riêng theo moduleKey (`/<module-key>/orders`). Các assertion route dùng route của chính module đó. Ý nghĩa kiểm tra không đổi.
- **Dữ liệu cũ:** không tắt hay sửa 208 module cũ. Dọn chúng cần chủ dự án phê duyệt.
