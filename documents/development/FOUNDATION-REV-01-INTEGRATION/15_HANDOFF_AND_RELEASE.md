# 15 — FINAL HANDOFF / RELEASE CONTROL

## Quyết định nghiệm thu

- `DONE`: toàn bộ required checks và luồng được phép đã PASS, không còn blocker phá mục tiêu đã giao.
- `PARTIAL`: đã cải thiện source/UI hoặc new-module path nhưng ACTIVE upgrade chưa thể cutover do recovery/policy. Báo rõ **Foundation chưa đáp ứng mục tiêu upgrade một nút**.
- `BLOCKED`: không đủ điều kiện sửa an toàn hoặc tests không thể chứng minh. Dừng thay đổi có rủi ro, giữ runtime.

## Báo cáo bắt buộc

1. Source local: branch, HEAD, dirty trước/sau, phạm vi diff.
2. Những thay đổi trong REV-A/B/C, cách dùng 2 màn hình và Navigation Builder.
3. Danh sách endpoints thực tế và error/status mới; dẫn về spec, không lặp full code.
4. Before/after `SYSTEM_TEST`, `DATA_INSPECTOR` B02/B01/lock/runtime/B09 + audit changes hợp lệ.
5. MIC source, reportHash/candidateHash, cách đồng bộ DRAFT and conflict.
6. Test matrix theo 11, command, exit, passed/failed/skipped; DB target và safe fixture.
7. Release plan và rollback đã test hoặc blocker owner approval (đừng giả đã hỗ trợ).
8. Known issues, giới hạn P6/DB/authenticated/UI, đã khắc phục/chưa.
9. Local commit nếu phù hợp, không push/merge/deploy.
10. Next user action bằng UI nếu đã test, không yêu cầu Claude Code add module.

## Checklist phát hành trên TEST (sau khi code DONE)

- Backup hợp lệ nếu migration/fixture write được phê duyệt (không bắt backup riêng cho read-only scanning).
- Freeze commit và artifact hashes.
- Verify guards on actor, candidate, plan, DB, B09/IAM/recovery.
- Test New Module fixture trên staging; không tự mở upgrade ACTIVE có chưa được approval.
- Restart/reload nếu cần theo supervised/manual control với active release unchanged.
- Verify AppShell, Foundation, IAM, Navigation, SYSTEM_TEST, DATA_INSPECTOR từ account hợp lệ và denial account.
- Đọc lại B02/B09/IAM từ fresh connection; log audit, artifact/report SHA.
- Release note/known limitations lưu trong evidence.

## Rollback thay đổi mã Foundation

- Có thể rollback thay đổi code source của Foundation về baseline Git bằng reverse patch/commit an toàn **nếu không hề commit DB/lifecycle transaction**, sau khi xác minh local working tree/user changes. Không `git reset --hard`.
- Nếu đã ghi B02/B09/IAM qua test fixtures, phải có cleanup/restore do policy cho phép; không suy đoán DB rollback từ Git.
- Nếu active upgrade cutover xảy ra, **không** dùng copy folder làm rollback B02; yêu cầu recovery service đã phê duyệt và test.
- Snapshot report cùng hash và reason; không xóa audit.

## Handoff sau REV-01

Mục tiêu triển khai sản phẩm sau này: AI tạo folder package hoàn chỉnh; user chép folder, nhấn Quét, xem lỗi và sửa candidate, READY, xác nhận plan, Foundation tự tích hợp. Không bắt copy MIC JSON hay chạy npm/SQL cho từng module. Nếu restart còn manual do supervisor NONE, UI phải giải thích và không hứa "một nút end-to-end" chưa có.
