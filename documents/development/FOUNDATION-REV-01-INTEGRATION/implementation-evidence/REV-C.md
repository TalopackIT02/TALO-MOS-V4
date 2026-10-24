# REV-C — Contract / security / fixture / regression

- API giữ envelope `{error:{code,message,requestId,details?}}`, session/Origin/no-store; mới: `UPGRADE_RECOVERY_UNAVAILABLE` (409 continue), trường `micDiff`, `navigationPlan`, `nextActions`, `latestInstallId`, check `required`, trạng thái `NOT_APPLICABLE`, `POSTCHECK_INCOMPLETE`. Client parse từng trường (UNEXPECTED_RESPONSE + field path).
- Cookie của người thao tác chỉ chuyển in-process tới router module cho `ACCESS_VERIFIED`; không lưu, không log.
- Fixture DB: `FBET_INST_<run>` route namespace riêng, tự RETIRE + DISABLE + ẩn vùng menu của chính lượt chạy + xóa quyền IAM theo UUID. Một lượt chạy (MVKME0M8_488E78) dừng ở bước dọn do thứ tự FK (role_permissions trước permissions) — đã sửa thứ tự trong test và dọn phần sót theo UUID/run tag bằng harness (script `TALO-MOS-V4_exports/REV-01-20261023-135930/cleanup-run-MVKME0M8*.mts`); leftovers FBET-/AUTHT-/FBET_INST permission = 0.
- Trạng thái được bảo vệ, live check trước/sau (`live-before.txt` = `live-after.txt`): B01/B02 SYSTEM_TEST & DATA_INSPECTOR, digest B09, IAM counts, hash lock — **không đổi**. SYSTEM_TEST 1.2.0 không được cài/kích hoạt.
- Ghi DB có chủ đích trong đợt: chỉ fixture của test (FBET_INST_*, FBET_ST_*, AUTHT-/FBET- tạm) qua service/harness; không SQL vào bảng Foundation, không GRANT, không đổi schema.
