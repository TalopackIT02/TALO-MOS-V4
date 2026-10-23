# 06 — API và UX đề xuất

**Các endpoint dưới đây là thiết kế đề xuất, chưa tồn tại trong repository.** Giữ envelope `{error:{code,message,requestId,details?}}`, session/Origin/no-store của Foundation. Payload chỉ chấp nhận ID + lựa chọn enum được server cho phép, không cho client gửi command, path hoặc SQL tùy ý.

## Preflight

- `POST /api/foundation/module-candidates` body `{scanId, moduleKey}`: tạo candidate từ result scan hợp lệ, verify hash, không tạo B01/B02.
- `GET /api/foundation/module-candidates/:candidateId`: trạng thái + scan metadata.
- `POST /api/foundation/module-candidates/:candidateId/preflight` body `{}`: start preflight; trả `{runId,status}`. Không khởi tạo nhiều run trùng candidate.
- `GET /api/foundation/module-candidates/:candidateId/preflight/:runId`: progress + checks + evidence + summary; polling UI với giới hạn, **không tự scan folder**.
- `GET /api/foundation/module-candidates/:candidateId/preflight/:runId/report.txt`: tải báo cáo TXT sanitized, content type `text/plain; charset=utf-8`, Content-Disposition attachment.
- `GET /api/foundation/module-candidates/:candidateId/preflight/:runId/report.json`: machine-readable sanitized report.

## Installer

- `POST /api/foundation/module-candidates/:candidateId/install/prepare` body `{}`: verify READY/hash, plan deployment, backup/readiness; trả plan `dryRun=true`/blockers.
- `POST /api/foundation/module-candidates/:candidateId/install/commit` body `{planId,acknowledge:true}`: thực thi khi plan còn valid và gates PASS. Chỉ admin authorized; reject khi lỗi/mismatch/old plan.
- `GET /api/foundation/module-installations/:installId`: state machine + current step + before/after versions/hashes + blocked reasons.
- `GET /api/foundation/module-installations/:installId/report.txt`: deployment report, không lộ secrets.

## Cleanup (không xoá tự động)

- `GET /api/foundation/fixture-cleanup/route-conflicts` (hoặc command quản trị local tương đương): report *read-only* có ownership evidence.
- Không tạo public endpoint DELETE/RETIRE hàng loạt trong phase đầu; nếu có workflow cleanup riêng phải yêu cầu reviewed ID manifest và explicit owner authorization.

## UX một màn hình Foundation Module

```
[Quét Module]    [Danh sách modules hiện tại]
  | chọn candidate
[Chi tiết package] [Kiểm tra & Chạy thử]
  > Các nhóm static/build/API/IAM/DB/runtime/regression
  > 3 thanh trạng thái đỏ/vàng/xanh; unavailable tách riêng
  > Drawer lỗi (file, API, expected/actual, log đã lọc)
  > Tải TXT / JSON
      khi required checks PASS và hash đúng
[READY] [Xem kế hoạch cài đặt] [Cài đặt & Kích hoạt]
  > Installing status: PREPARING / STAGED / AWAITING_RESTART / ...
  > Postcheck; DONE hoặc RECOVERY_REQUIRED
```

- Nút Install bị disabled trừ READY + deploy plan hợp lệ + đủ quyền.
- Không hiển thị ACTIVE chỉ vì HTTP 200 hay MIC10 PASS.
- Trên màn hình ghi rõ backend/frontend release đang chạy và package hash.
- Candidate lỗi vẫn được chọn, sửa source ngoài UI rồi nhấn Scan lại; không tạo version liên tục.
- Tránh tái sử dụng thông báo `API không trả dữ liệu đúng hợp đồng` chung chung: show endpoint + invalid field/error code trong drawer, log server theo requestId; không để browser lộ payload nhạy cảm.

## Chỉ số/report bắt buộc

- Code `status`, `errorCode`, `requestId`, `runId`, `candidateHash`, `environment`, `startedAt`,`finishedAt`, `checks`, `summary`, `artifacts`, `limitedReasons`.
- `report.txt`: không lộ secrets/cookie, `UTF-8`, có header, module, version, hash, DB target label, kết quả từng check, suite, timestamps, lỗi, limitations, kết luận NOT_TESTED khi chưa thực hiện.
