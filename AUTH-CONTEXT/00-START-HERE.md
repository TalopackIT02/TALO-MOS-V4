# TALO-MOS-V4 — AUTH FAST CONTEXT

**Mục đích:** tiết kiệm context/usage cho Claude Code bằng cách chỉ mở đúng file đang cần. Đây KHÔNG phải một phase, kế hoạch xây mới hay nguồn sự thật cao hơn source code.

## Trạng thái nguồn (snapshot 2026-10-14)
- GitHub repository: `TalopackIT02/TALO-MOS-V4`, commit mới nhất đã kiểm tra `e117d727` (`Add offline Pwned checks and provisioning CLI`). **Không suy ra đây là HEAD local.**
- GitHub đã có frontend `LoginPage`, `FirstChangePage`, `WelcomePage`; backend module `auth`, 4 API, H-b CAS; HIBP offline adapter và provisioning CLI.
- Theo báo cáo kiểm thử local mới nhất từ Claude: 102/102 unit/HTTP, 32/32 PostgreSQL integration, 4/4 browser E2E, fixture cleanup 0; **chưa được xác minh lại trong phiên mới**.
- `frontend/src/layouts/` hiện chỉ có `.gitkeep`; AppShell KHÔNG thuộc task này.
- Root `README.md` và `CATALOG.html` có nội dung placeholder lỗi thời; không dùng làm trạng thái hiện tại.

## Công việc thực sự còn mở
1. **P-4d:** HIBP SHA-1 chỉ kiểm chính xác chuỗi; 5 case variants KHÔNG đạt yêu cầu case-insensitive đầy đủ. Không tự thay đổi Security Contract. Chuẩn bị giải pháp/đề xuất tối thiểu và dừng riêng nhánh này nếu cần user chốt.
2. **HIBP dataset:** chưa tải bộ offline lớn (~75–80 GB ước tính). Không tải nếu chưa có phê duyệt riêng; cân nhắc định dạng lưu trữ, checksum, cập nhật. Không đưa dữ liệu vào Git hoặc IAM DB.
3. **P-4e recovery:** CLI cấp mới đã có; reset/reissue/revoke cần quyền chưa được duyệt. Không tự GRANT/schema changes. Chỉ thiết kế và kiểm tra SQL phạm vi tối thiểu; thực thi sau phê duyệt.
4. **Provisioner TCP:** cấu hình `PROVISIONER_DATABASE_URL` bí mật, chưa kiểm chứng chạy host từ báo cáo trước. Không in connection string.
5. **Production-only:** Argon2 benchmark, shared rate limiting, HTTPS proxy/Secure cookie, audit retention, WAL overhead, đa trình duyệt. KHÔNG biến thành blocker để đóng local/test trừ khi người dùng yêu cầu deploy production.

## Chốt sẵn, không hỏi lại
- IAM v0.3 bất biến; DB dev tuyệt đối không đụng; test DB là `talo_mos_v4_test`.
- Runtime `talo_app`; provisioning `talo_provisioner`; test harness `talo_test_harness`.
- H-b CAS trên `updated_at`, D=30s; 5 failed attempts → lock 15m; writer account-lock coupling; DB clock.
- Session activation 15m, auth 10h absolute / 60m idle; change password → login lại; CSRF X1; cookie HttpOnly Strict.
- Argon2id local 19 MiB, t=2, p=1; login rate 60/15min/IP; audit tối thiểu reason/requestId/ip/ua.
- HIBP offline fail closed khi dataset hỏng/thiếu. Blocklist hiện chưa có dataset chính thức. Audit `ACCOUNT_PROVISIONED` đã được chấp nhận trong hội thoại.
- Không tự commit/push; không app shell, refactor rộng, phát sinh tài liệu kế hoạch.

## Cách Claude nên làm
1. `git status --short`, `git rev-parse --short HEAD`, kiểm tra diff local; **không fetch hoặc duyệt toàn repo nếu không cần**.
2. Xác định một trong hai blocker có thể xử lý an toàn; mở tối đa nhóm source tương ứng từ `01-SOURCE-MAP.md`, không đọc tất cả tài liệu.
3. Sửa nhỏ, test targeted; chỉ sau khi xong mới chạy regression cuối theo nhu cầu.
4. Nếu cần chính sách P-4d, tải HIBP lớn, GRANT hoặc migration: **dừng đúng nhánh đó**, tiếp tục nhánh độc lập.
5. Báo cáo tối đa 10–15 dòng: thay đổi, test thực chạy, blockers và Git status. Không tạo phase mới.

## Điều kiện nghiệm thu local/test
- Không có regression login/first-change/logout; DB test fixtures về 0 và DB dev không đổi.
- Không khẳng định P-4d PASS nếu chỉ kiểm 5 biến thể.
- Cấp mới có thật; reissue chỉ coi PASS sau khi được duyệt quyền và chạy transaction thu hồi session thật.
- Không tuyên bố production-ready từ kết quả local/test.
