# 03 — CANONICAL END-TO-END WORKFLOW & STATES

## Phân loại 3 vòng đời — không trộn

| Bề mặt | Trạng thái | Ý nghĩa |
|---|---|---|
| Candidate Workspace | `SCANNED`, `VALIDATING`, `NEEDS_FIX`, `READY`, `INVALIDATED`, `CANCELLED`, `ERROR` | Phát triển / kiểm thử trước khi khóa version; chưa phải B02 |
| B02 Version | `DRAFT`, `IN_REVIEW`, `APPROVED`, `ACTIVE`, `RETIRED`, `REJECTED` | Phiên bản chính thức, audit và gates; hạn chế edit |
| Installer | `PREPARED`, `BLOCKED`, `PREPARING`, `STAGED`, `PUBLISHING`, `AWAITING_RESTART`, `CUTTING_OVER`, `POSTCHECK`, `INSTALLED_ACTIVE`, `RECOVERY_REQUIRED`, `FAILED_SAFE`, `EXPIRED` | Quá trình cài/điều phối; không suy ra ACTIVE chỉ từ HTTP 200 |

Không thêm trạng thái Candidate vào enum B02 hoặc đổi enum DB để làm UI dễ code.

## Luồng chuẩn — module MỚI

1. AI tạo package có `module.json`, MIC JSON, Host adapters, backend/frontend/tests.
2. User chép vào `modules/MODULE_KEY/`, nhấn **Quét Module**.
3. FMI-01 read-only scan; có lỗi package → drawer chỉ rõ file/field, user sửa và nhấn quét lại.
4. User chọn **Kiểm tra & Chạy thử**; tạo Candidate immutable snapshot + hash. FMI-02 chạy checks, report TXT/JSON.
5. `NEEDS_FIX`: sửa package, scan lại, chạy lại không tăng version; evidence cũ invalid. `READY`: đủ required checks, báo các giới hạn chính xác.
6. User vào Workspace, xem MIC read-only, bản diff, permissions/menus/dependencies, blockers, recovery, plan dry run.
7. Nếu không blocker: user xác nhận **Cài đặt & Kích hoạt**. FMI-03 tự tạo B01/B02 DRAFT khi cần, ghi MIC từ snapshot + evidence, submit, approve; release lock/Host staging theo cơ chế có kiểm chứng; thực hiện activated flow có audit.
8. IAM permissions/catalog, B09 navigation theo policy; postcheck authenticated + API contract + routes + UI + release hash. Chỉ rồi mới `INSTALLED_ACTIVE`.
9. Nếu chưa có supervisor: `AWAITING_RESTART` không được báo DONE. Restart chỉ theo hướng dẫn/bridge được cho phép, vào lại workspace rồi Continue; **không để browser chạy command tùy ý**.

## Luồng chuẩn — UPGRADE module đã tồn tại

- Dùng `moduleKey` cũ/B01 cũ, Candidate mới, B02 DRAFT trùng version được reuse nếu an toàn; không tạo duplicate.
- Nếu B02 có cùng version đã APPROVED/ACTIVE/RETIRED/REJECTED: không sửa; yêu cầu version mới chỉ khi lịch sử đã khóa thật (không tăng chỉ vì lỗi code ở Candidate).
- B02 DRAFT hiện có với MIC mẫu `MAIN.READ`: Installer phải kế hoạch rõ thay MIC khi kiểm chứng đúng version và quyền, compare-and-swap/expected hash để chống ghi đè thay đổi của người khác.
- Không thay ACTIVE cũ khi staging/test. Có ACTIVE thì cần recovery được chứng minh, hoặc **block upgrade** kèm hướng dẫn chính xác và không thực hiện một phần cutover nguy hiểm.
- Khi rollback chưa được phê duyệt/test, REV-01 có thể triển khai mọi phần *trước cutover* và acceptance của luồng BLOCKED; không được tự dựng SQL chuyển RETIRED → ACTIVE.

## Invalidations & concurrency

- `packageHash` thay đổi → Candidate READY, Test Run, plan cũ hết hiệu lực. Required check chạy lại.
- `Registry revision`, quyền actor, active version, deployment lock hoặc route holders thay đổi → plan dry run hết hạn và kiểm tra blockers lại trước mọi ghi.
- Một installation / module tại một thời điểm; persist journal và idempotency keys (dùng store hiện có) qua restart; không dựa duy nhất vào React state.
- Mất quyền/session trước commit → deny, không được tự retry side effects.
- Tắt fixture giữ route ACTIVE trong MIC không đồng nghĩa route đã giải phóng vĩnh viễn: kiểm tra ENABLE cũng phải ngăn conflict, không tự enable FBET.

## UX sequence chính xác

**Danh sách Module:** nút Quét; scan report; chọn package hoặc module → drawer. Candidate tạo mới/chạy dài → route workspace.

**Workspace:** Stepper Scan → Preflight → Plan → Install; test/check/log chi tiết mở drawer. MIC source vs registered manifest được so sánh ở dạng bảng, raw JSON chỉ ở Advanced mode, read-only trừ permission/flow thủ công đặc biệt.

**Navigation Builder:** màn hình chức năng riêng, tree central + action drawer; một lần Save với revision conflict handling. Không đặt một builder thứ hai trong Installer.

## Điều kiện DONE theo luồng

`READY` = static/contract/preflight required checks đạt với cùng hash; không phải ACTIVE.

`INSTALLED_ACTIVE` = Foundation B02 ACTIVE + module ENABLED + backend/frontend runtime đúng version/hash + IAM catalog/policy + B09 + postcheck giao diện/API đã authenticated/denied theo hợp đồng. Nếu chỉ có 401 smoke, báo `POSTCHECK_INCOMPLETE`.
