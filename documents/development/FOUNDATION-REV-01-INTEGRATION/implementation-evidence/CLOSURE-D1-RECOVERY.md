# CLOSURE-D1 — Active Upgrade Recovery

Trạng thái: **PASS** (unit + DB TEST). Không dùng SYSTEM_TEST 1.1.1 → 1.2.0 làm cutover; mọi cutover thật chạy trên fixture riêng `FBET_INST_<run>` / `FBET_<run>_<n>`.

## Thiết kế đã triển khai

### Lifecycle (`foundation.lifecycle.repository.ts` / `.service.ts`)

`recoverUpgrade` chỉ dùng nội bộ, gọi từ Installer. **Không có route HTTP**: test R5 kiểm `/rollback`, `/recover`, `/reactivate`, `/restore` đều trả 404, và ACTIVATE một bản RETIRED vẫn bị 409.

- **Quyền:** cần cả `MODULE_VERSION_ACTIVATE` và `MODULE_VERSION_RETIRE`. Bị từ chối thì trả 403 và ghi B08 DENIED.
- **Bằng chứng (proof) kiểm lại dưới module lock** (`pg_advisory_xact_lock(7201, hashtext(module))`):
  - bản lỗi phải đang ACTIVE, với `activated_at` đúng bằng giá trị journal của Installer;
  - bản phục hồi phải RETIRED, có `activated_at`, cùng module, và manifest còn nguyên vẹn.
- **Thứ tự ghi trong một transaction:**
  1. bản lỗi ACTIVE → RETIRED (B07 RETIRE);
  2. bản phục hồi RETIRED → ACTIVE qua SQL `reactivateVersion` (B07 ROLLBACK);
  3. B08 `MODULE_VERSION.ROLLBACK`, metadata có `failedVersionId` và `installId`.
- `activated_at` của lần kích hoạt đầu được giữ nguyên. Index one-ACTIVE luôn được tôn trọng.
- **Mã lỗi:**
  - `RECOVERY_PROOF_MISMATCH` (409);
  - `VERSION_STATE_CONFLICT` (409);
  - `MANIFEST_INTEGRITY_INVALID` (422);
  - lỗi SQL → 503, rollback toàn bộ.

### Installer (`foundation.installer.service.ts`)

**Gate `UPGRADE_RECOVERY_UNAVAILABLE`** nay có điều kiện: chỉ gỡ khi có điểm phục hồi. Gate vẫn chặn khi:
- lock không có module;
- lock khác bản ACTIVE;
- kho release thiếu release cũ, hoặc release đó khác hash;
- actor thiếu RETIRE.

**`recoveryPoint`**: chụp tại commit, trước mọi ghi:
- B01 (moduleId, enabled);
- B02 (ACTIVE id, version, hash MIC chuẩn);
- lock (version, hash);
- danh sách quyền IAM;
- B09 revision.

**Journal kích hoạt:**
- ghi intent trước khi gọi ACTIVATE;
- sau đó ghi `activatedAt` và `retiredVersionId` do Lifecycle trả về.

**Khi có lỗi sau restart** (ACTIVATE / ENABLE / IAM / B09 / postcheck FAIL), chạy `rollbackUpgrade`. Hàm này idempotent và theo dõi từng bước:
1. B02: Lifecycle `recoverUpgrade`;
2. B01: tắt lại nếu trước đó đang tắt;
3. B09: ẩn các link do lượt này thêm, qua Builder, không xóa;
4. lock: băm lại release cũ rồi ghi lock cũ.

Sau đó chuyển sang `RECOVERY_AWAITING_RESTART`.

**Khi không chứng minh được** (ACTIVE nhưng không có journal, MIC phục hồi đã đổi, release cũ khác hash, số ACTIVE bất thường):
- bước đó được đánh dấu `UNPROVEN`;
- trạng thái là `RECOVERY_REQUIRED`, phải xử lý thủ công;
- không đoán.

**`verifyRecovered`** chạy sau restart. `RECOVERED` chỉ khi tất cả PASS:
- `RECOVERY_RUNTIME`: backend, frontend và lock đều chạy release cũ;
- `RECOVERY_B02`: đúng 1 ACTIVE là bản cũ, hash MIC không đổi;
- `RECOVERY_B01`;
- `RECOVERY_NAVIGATION`;
- `API_SMOKE` của router cũ.

**Chống race:** `continue` đọc lại journal bên trong module lock. Một lượt `continue` đồng thời đã xong trước sẽ thắng; lượt còn lại nhận 409.

**Trạng thái mới:**
- `RECOVERY_AWAITING_RESTART` (nằm trong OPEN_INSTALL, nên chặn plan thứ hai);
- `RECOVERED` (trạng thái cuối, không phải INSTALLED_ACTIVE).

**Phần IAM còn lại:**
- Quyền danh mục do lượt nâng cấp tạo ra được giữ lại: không DELETE, chưa gán cho ai.
- Ghi chú này nằm trong `recovery`.

### Frontend

Các file: `CandidateWorkspace.tsx`, `moduleScanApi.ts`, `foundationMessages.ts`.
- Hai trạng thái mới có nhãn riêng, nút "Tiếp tục", và hướng dẫn khởi động lại.
- Bước 4 được tô `blocked` khi RECOVERED.
- Có thông điệp cho `UPGRADE_STATE_MISMATCH` và cho `UPGRADE_RECOVERY_UNAVAILABLE` mới.

## Kiểm thử

### RED trước khi sửa

Khôi phục tạm gate vô điều kiện cũ:
- Lệnh: `npx vitest run test/unit/foundation/foundation.installer.test.ts -t "REV01-D1"`, exit 1.
- Kết quả: **9 failed, 1 passed**. D1-10 vẫn PASS vì nó kiểm rằng gate vẫn chặn khi thiếu điểm phục hồi.
- Log: `$OUT/t-d1-red.log`. File đã được khôi phục nguyên trạng.

### Unit (GREEN)

**`foundation.installer.test.ts`: 34/34 PASS.** Gồm 10 ca D1:

| Ca | Kịch bản bắt buộc |
|---|---|
| D1-01 | Thành công: recoveryPoint đủ trường, journal, 1.0.0 RETIRED, INSTALLED_ACTIVE, không ROLLBACK |
| D1-02 | Lỗi trước cutover (Activation Gate từ chối): B02 không đổi, lock cũ, RESTART_PENDING, rồi RECOVERED |
| D1-03 | Lỗi sau kích hoạt (B09 apply): ROLLBACK đúng 1 lần, 1.1.0 RETIRED / 1.0.0 ACTIVE, lock cũ, RECOVERED |
| D1-04 | Postcheck FAIL: link B09 bị ẩn (không xóa, số dòng +1), B02 + lock phục hồi, RECOVERED khi router cũ trả lời |
| D1-05 | Restart dở dang (chỉ backend): RESTART_PENDING, không ACTIVATE; trạng thái phục hồi vẫn giữ |
| D1-06 | Phục hồi lỗi giữa chừng (ROLLBACK `SERVICE_BUSY`): RECOVERY_REQUIRED, lock chưa đổi, thử lại thì xong các bước còn lại (ROLLBACK 1 lần) |
| D1-07 | Hai lượt cài cạnh tranh: plan thứ hai bị INSTALL_IN_PROGRESS; hai `continue` đồng thời ra 200 + 409; ACTIVATE 1 lần |
| D1-08 | Mở lại sau restart tiến trình: instance Installer mới trên cùng journal → RECOVERED |
| D1-09 | Lệch trạng thái / hash: ACTIVE không có journal → UNPROVEN (không ROLLBACK, giữ lock); ACTIVE lạ → 409 UPGRADE_STATE_MISMATCH; release cũ bị sửa → lock UNPROVEN |
| D1-10 | Không có điểm phục hồi (thiếu RETIRE / thiếu release cũ) → BLOCKED |

**`foundation.lifecycle.recovery.test.ts`: 5/5 PASS.**
- **R1:** B02 / B07 RETIRE + ROLLBACK / B08 ROLLBACK có installId; một transaction; giữ `activated_at`.
- **R2:** lệch proof, phục hồi chính nó, bản phục hồi không RETIRED, lần phục hồi thứ hai → không thay đổi gì.
- **R3:** lỗi giữa chừng → rollback toàn bộ.
- **R4:** quyền 403; manifest bị sửa → 422.
- **R5:** không có route chung RETIRED → ACTIVE.

**Thay đổi kỳ vọng có lý do** (hành vi được yêu cầu đổi, không che lỗi):
- IN-04: plan thứ hai cho cùng phiên bản giờ chỉ bị `VERSION_LOCKED`, không còn `UPGRADE_RECOVERY_UNAVAILABLE`, vì module do Installer cài đã có điểm phục hồi.
- Fake lifecycle `activate` nay RETIRE bản ACTIVE cũ và trả về `ActivationResult`, đúng như service thật.

### DB TEST (`talo_mos_v4_test`, `TALO_FOUNDATION_DB=1`)

**`foundation.lifecycle.db.test.ts` REV01-D1-DB: PASS** (12/12 file, `$OUT/t-lifecycle-db.log`):
- v2 RETIRED / v1 ACTIVE, `activated_at` giữ nguyên, đúng 1 ACTIVE;
- B07 `RETIRE v2`, `ROLLBACK v1` (actor đúng);
- B08 `MODULE_VERSION.ROLLBACK` SUCCESS với `installId`;
- proof lệch → 409, không đổi gì;
- lỗi CHECK B07 thật (23514) → 503, rollback toàn bộ;
- hai lượt phục hồi đồng thời → fulfilled + `VERSION_STATE_CONFLICT`, 0 lock treo;
- ACTIVATE bản RETIRED → 409.

**`foundation.installer.db.test.ts` REV01-D1: PASS** (2/2, `$OUT/t-installer-db.log`):
1. Fixture `FBET_INST_<run>` đang ở 1.0.0 INSTALLED_ACTIVE.
2. Nâng cấp lên 1.1.0: plan PREPARED (không blocker); recoveryPoint gồm 1.0.0 / bật / lock 1.0.0.
3. "Restart" không mount router → API_SMOKE FAIL → `RECOVERY_AWAITING_RESTART`, rollback `b02 DONE / lock DONE`.
4. B02 cho 1.0.0 ACTIVE / 1.1.0 RETIRED, đúng 1 ACTIVE.
5. B07 có hai transaction:
   - kích hoạt: `ACTIVATE:1.1.0`, `RETIRE:1.0.0`;
   - phục hồi: `RETIRE:1.1.0`, `ROLLBACK:1.0.0`.
6. B08 `MODULE_VERSION.ROLLBACK` SUCCESS với installId `21ef64ee-…`, version 1.0.0.
7. Lock trở về 1.0.0; trước restart trả RESTART_PENDING.
8. Restart lên release cũ → **RECOVERED**: RECOVERY_RUNTIME / B02 / B01 / NAVIGATION / API_SMOKE đều PASS.
9. Sau đó 1.0.0 → 1.2.0 → **INSTALLED_ACTIVE**, 7/7 hậu kiểm PASS, B02 `1.0.0 RETIRED · 1.1.0 RETIRED · 1.2.0 ACTIVE`, không trùng K05.
10. Cleanup: RETIRE + DISABLE + ẩn menu qua API; xóa 2 quyền K05 của run theo UUID; `remaining 0`.

## Chưa kiểm / giới hạn

- Chưa có deploy supervisor: restart vẫn thủ công. Trong cửa sổ giữa ROLLBACK B02 và restart, runtime vẫn chạy code mới với B02 cũ. Cửa sổ này giống cửa sổ AWAITING_RESTART sẵn có.
- Mất kết nối đúng lúc ngay sau COMMIT của ACTIVATE (đã commit nhưng chưa nhận kết quả) → journal không có `activatedAt` → UNPROVEN, phải xử lý thủ công. Đây là hành vi cố ý.
- Chưa có Playwright cho hai trạng thái mới; chỉ kiểm qua typecheck và build.
