# HANDOFF — TALO-MOS-V4 (phiên kết thúc 2026-10-15, khoảng 12:30)

> **Superseded (AUTH-FIX):** TALO-MOS-V4 no longer uses HIBP / Pwned Passwords. Every HIBP / blocklist item below is historical; the current contract is `backend/src/modules/auth/AUTH-API-v1.md` §5.3.

Tài liệu bàn giao cho phiên Claude Code tiếp theo. Mục đích: biết **đã làm gì, đang treo gì, việc nào chờ User quyết định**. Đây không phải kế hoạch hay phase mới. Nếu tài liệu này mâu thuẫn với source code hoặc `git`, tin source code và `git`.

## 1. Trạng thái nguồn

- Nhánh `main`, HEAD `73a6545` "Allow localhost as a development origin". User tự commit; Claude không commit hay push.
- `git status` lúc bàn giao (không phải do Claude tạo, đừng xóa hay sửa):
  - `?? documents/development/TALO_MOS_V4_AI_Governance_MD_v0_1/`: tài liệu governance mới của User.
  - `?? frontend/TALO-MOS-V4-Appshell.html`: file demo AppShell của User.
  - `?? frontend/src/assets/images/talopack-name.png`
- Các commit gần đây: `fa5eb64` (HIBP Compact), `affe954` (P-4e recovery/CLI), `e117d72` (HIBP offline + provisioning CLI), `0af66c3` (auth + first-change).

## 2. Đã hoàn thành và User đã nghiệm thu

1. **Authentication E2E:** 4 API (`login`, `session`, `password/first-change`, `logout`); React Login, FirstChange và Welcome; H-b CAS; INV-10; IB-1..IB-3; P-4e recovery trên DB test.
2. **Contract P-4d (sửa đổi):** kiểm HIBP tối đa 5 biến thể chữ hoa/thường của chuỗi NFC (như đã gõ, thường, HOA, Viết hoa đầu, Viết Hoa Từng Từ). Đây không phải so khớp case-insensitive đầy đủ. Contextual checks vẫn case-insensitive. Dataset thiếu hoặc hỏng thì trả `503 SERVICE_BUSY` (fail-closed). Đã đồng bộ `AUTH-API-v1.md`, `AUTH-API-v1.yaml` và test.
3. **HIBP Compact (định dạng mục tiêu, chưa dùng ở runtime):**
   - Mã nguồn: `backend/src/modules/auth/pwnedCompact.ts` (reader và pointer `current.json`), `backend/src/modules/auth/tools/pwnedCompact.ts` (convert, verify, activate); lệnh `npm run pwned:compact`.
   - Biến môi trường `PWNED_PASSWORDS_FORMAT=text|compact`, mặc định `text`; không fallback giữa hai định dạng.
   - Kết quả test: 121 unit, 39 DB, 3 live-sample.
4. **Sửa lỗi Login trên localhost (commit `73a6545`):** khi chạy dev mà không đặt `APP_ORIGIN`, backend cho phép cả `http://127.0.0.1:5173` lẫn `http://localhost:5173`. Trước đó `localhost` bị 403 `ORIGIN_NOT_ALLOWED`. Allowlist vẫn so khớp chính xác; production vẫn bắt buộc khai báo `APP_ORIGIN`.
5. **Tải HIBP đầy đủ, xong rồi đã xóa:**
   - Đã tải đủ 1.048.576 range (81,23 GB). Text verify PASS (treeSha256 `7a68a86b…21675854`).
   - Đã convert sang Compact (2.068.408.781 hash, 16,56 GB) và verify Compact PASS.
   - Luồng trình duyệt Login → First Change → Login → Welcome → Logout đã PASS với dataset thật.
   - **Sau đó User quyết định xóa toàn bộ:** đã xóa `D:\TaloData\hibp\*` và `D:\TaloData\tools\*` (giải phóng 100,2 GB). Hai thư mục cha `D:\TaloData\hibp` và `D:\TaloData\tools` còn nhưng rỗng.
6. **Kiểm tra Login cơ bản lần cuối (2026-10-15):** Docker, PostgreSQL 5433, backend và frontend đều được khởi động lại. Trên `http://localhost:5173`: Login 200, tải lại trang thì Session 200, Logout 204. **PASS**, kiểm bằng Chromium qua Playwright.

## 3. Đang treo hoặc chờ User quyết định

| # | Vấn đề | Trạng thái | Ai quyết định |
|---|---|---|---|
| T1 | **Vite dừng vì `EBUSY`** khi có file HTML demo trong `frontend/` vừa được ghi. Đã xảy ra 3 lần: `…AppShell-Foundation-Demo-Assets.html`, `…Foundation-Redesign.html`, `…Menu-Grouped.html`. | Lúc bàn giao **frontend 5173 KHÔNG chạy**; backend 3000 chạy. Hai hướng: (1) chuyển file demo ra khỏi `frontend/`, ví dụ sang `design/` (đã đề xuất); (2) thêm `server.watch.ignored` vào `frontend/vite.config.ts`, cần User duyệt. | User |
| T2 | **First Change trả 503** vì dataset HIBP đã xóa. `.env` vẫn trỏ tới thư mục đã xóa: `PWNED_PASSWORDS_DIR=D:/TaloData/hibp/text-20261015`, `PWNED_PASSWORDS_FORMAT=text`. | Backend ghi log `password blocklist unavailable … manifest.json missing` (fail-closed đúng thiết kế). Login, Welcome và Logout không bị ảnh hưởng. Không bypass, không dùng fixture partial làm dataset thật. Có giữ hai dòng `.env` này hay không là quyết định của User. | User |
| T3 | **Tài khoản fixture còn trên DB test**, run `AUTHT-mv8ssjlf-d39d74`: `autht-mv8ssjlf-d39d74-u1` (ACTIVE) và `autht-mv8ssjlf-d39d74-u2` (PROVISIONED). | Mật khẩu nằm ở `D:\TaloData\localhost-test\credentials.txt`. Script dọn dẹp chạy nền trong phiên cũ chờ file `D:\TaloData\localhost-test\cleanup.now`. **Nếu phiên cũ đóng thì script cũng chết**, các dòng `AUTHT-` sẽ còn lại và bộ test `TALO_AUTH_DB=1` sẽ từ chối chạy (`assertNoLeftovers`). Phiên mới không được tự xóa theo phỏng đoán; báo User và dọn bằng cơ chế `AuthFixtures`, chỉ xóa khi chứng minh được quyền sở hữu (runId, UUID). | Claude (báo cáo trước) |
| T4 | Khoảng 6 dòng audit `LOGIN/UNKNOWN_USERNAME` trên DB test, sinh ra từ các request chẩn đoán (UA là curl hoặc Chromium). | Fixture không chứng minh được quyền sở hữu nên chưa xóa. Không ảnh hưởng test. | User |
| T5 | P-4e: reissue, revoke và recovery ngoài phạm vi test DB; TCP smoke cần `PROVISIONER_DATABASE_URL`, hiện chưa cấu hình. | Chưa chạy, cần phê duyệt quyền. | User |
| T6 | Các mục chỉ liên quan production: Argon2 benchmark, rate limit dùng chung, HTTPS/Secure cookie, audit retention, đa trình duyệt. | Không phải blocker của local/test. | — |

**Việc tiếp theo User đã báo trước:** AppShell. Chờ yêu cầu cụ thể, không tự bắt đầu. Các file demo AppShell của User nằm ở `frontend/*.html`; xem T1.

## 4. Môi trường local

- PostgreSQL 18.6 chạy trong Docker container `talo-mos-v4-postgres`, cổng `127.0.0.1:5433`.
  - DB `talo_mos_v4_test` (được phép dùng) và `talo_mos_v4_dev` (**không bao giờ đụng**).
  - Cổng 5432 là một PostgreSQL cài trực tiếp trên máy, không liên quan.
- Docker Desktop đôi khi bị tắt. Bật bằng `"%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"`; container tự khởi động lại.
- Các role:
  - `talo_app`: runtime, là user trong `DATABASE_URL` ở `.env`;
  - `talo_provisioner`;
  - `talo_test_harness`: dùng qua `docker exec … psql`, trust local, cho fixture;
  - `admin`: chỉ đọc hoặc DDL đã được duyệt.
- Chạy ứng dụng: `run-dev.cmd`, hoặc `npm run dev` trong `backend/` (cổng 3000, `tsx watch`, đọc `../.env`) và trong `frontend/` (Vite 127.0.0.1:5173, proxy `/api` sang 3000).
- `.env` thuộc User: không in giá trị, không tự sửa. Chỉ sửa khi User yêu cầu rõ.
- Test:
  - `backend`: `npm run typecheck`, `npx vitest run`;
  - Auth trên DB test: `TALO_AUTH_DB=1 npx vitest run test/integration/auth`;
  - `TALO_AUTH_PRIV=1`; `TALO_HIBP_LIVE=1` (tải vài range thật);
  - `TALO_PROVISIONER_TCP=1` chỉ khi đã có `PROVISIONER_DATABASE_URL` an toàn.

## 5. Ràng buộc bắt buộc (từ CLAUDE.md và các chỉ thị của User)

- `documents/` chỉ đọc. Không sửa IAM schema, GRANT, Prisma schema hay migration; không seed, không reset DB; không đụng DB dev.
- Không commit/push. Không tự cài dependency. Không tải lại HIBP. Không bypass fail-closed.
- Không in mật khẩu, connection string hay secret.
- Không dùng type assertion, `any` hay `@ts-ignore` để che lỗi.
- Fixture chỉ trên `talo_mos_v4_test`, gắn nhãn `AUTHT-`, dọn theo UUID đã chứng minh quyền sở hữu.
- Báo cáo bằng tiếng Việt, ngắn, kèm bằng chứng thật (lệnh, HTTP status, kết quả). Không tuyên bố PASS nếu thiếu bằng chứng. Không tạo tài liệu kế hoạch, phase hay framework mới.
- Chỉ dừng để hỏi khi cần đổi quyền DB, dữ liệu dev hoặc quyết định bảo mật.

## 6. Bẫy kỹ thuật đã gặp (Windows)

- PowerShell 5.1:
  - `[IO.Directory]::EnumerateFiles(...).Count` **không** trả về số lượng mà trả về một mảng các số 1. Phải đếm bằng vòng `foreach`.
  - File `.ps1` có ký tự ngoài ASCII mà không có BOM sẽ bị đọc sai: dấu "—" thành dấu ngoặc kép, gây lỗi parse.
- Lấy exit code của tiến trình: dùng `Start-Process -PassThru`, rồi gán `$null = $p.Handle` ngay để sau này đọc được `ExitCode`. Không dùng `Tee-Object` cho mục đích này.
- `tail -f` một file log sẽ **khóa file** khiến PowerShell `Add-Content` báo lỗi. Chờ bằng vòng `until grep …`, không dùng `tail -f`.
- Heredoc, `sed` và `printf` hay làm hỏng escape (`\t`, `\n`, `\b`). Sửa code thì dùng Edit tool; sau khi sửa bằng script, quét ký tự điều khiển.
- `npm run … -- --flag "a b"` mất dấu ngoặc kép, nên dùng giá trị không có khoảng trắng.
- Script tsx đặt ngoài package: dùng đuôi `.mts`; import đường dẫn tuyệt đối phải viết dạng `file:///D:/...`.

## 7. Tài liệu cần đọc (theo thứ tự, chỉ mở phần cần)

1. `CLAUDE.md`: phạm vi và ranh giới.
2. `handoff.md`: file này.
3. `documents/development/TALO_MOS_V4_AI_Governance_MD_v0_1/TALO_MOS_V4_AI_Governance_Master_v0_1.md`: governance mới của User (chỉ đọc).
4. `AUTH-CONTEXT/00-START-HERE.md` và `AUTH-CONTEXT/01-SOURCE-MAP.md`. Lưu ý: snapshot ngày 2026-10-14; phần "HIBP dataset/P-4d còn mở" đã được thay bằng mục 2–3 của file này.
5. `backend/src/modules/auth/README.md`: cách chạy, HIBP, provisioning, các lệnh test.
6. `backend/src/modules/auth/AUTH-API-v1.md`: §5.3 (policy và P-4d), §13 (các quyết định và mục còn mở).
7. Khi làm AppShell: `frontend/src/App.tsx`, `frontend/src/routes/navigation.ts`, `frontend/src/pages/auth/WelcomePage.tsx`, `design/auth-b1/`, cùng các file demo HTML của User trong `frontend/`.

---