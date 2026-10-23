# 08 — Test acceptance matrix

**Yêu cầu các lệnh/test phải thực sự chạy; không tự đánh dấu PASS.** Khi không có môi trường, ghi NOT_TESTED + blocker.

| ID | Kịch bản | Điều kiện PASS |
|---|---|---|
| CL-01 | Inventory FBET route owners | Có ID, provenance/relationships, report |
| CL-02 | Fixture không xác minh | Không bị xóa/retire |
| CL-03 | Fixture claim route thật | Có cảnh báo/blocker, không bị bỏ qua giả |
| CL-04 | Remediation TEST hợp lệ | Không route conflict, audit tồn tại |
| CL-05 | Test suite chạy 2 lần | Không tái chiếm route sản phẩm |
| RT-01 | Scan candidate | Không tự sync hoặc mount |
| RT-02 | Build/dev npm scripts | Không nạp package candidate chưa duyệt |
| RT-03 | DATA_INSPECTOR old release | API/Menu/IAM hoạt động như baseline |
| RT-04 | SYSTEM_TEST 1.1.1 old ACTIVE | Không bị ghi đè bởi 1.2.0 trước cutover |
| PF-01 | Valid MIC/Host | Static PASS |
| PF-02 | Sai MIC01/MIC07/K05 | FAIL có path/expected |
| PF-03 | Backend/frontend compile | PASS bằng toolchain thật |
| PF-04 | API contract mismatch | Fail cụ thể field/endpoint |
| PF-05 | Quick/run tests | Có runId, logs sanitized, duration |
| PF-06 | Lack real DB staging | NOT_TESTED/UNAVAILABLE, chặn READY |
| PF-07 | Package file thay đổi | Old evidence invalidated |
| PF-08 | MIC10 AI tự PASS | Không được tin là runtime PASS |
| PF-09 | Full PASS same hash | READY; immutable evidence |
| PF-10 | TXT download | Đầy đủ checks, hash, timestamps, limitations |
| IN-01 | Package DRAFT | Không tạo duplicate B02 |
| IN-02 | Locked version | Không PUT/update bypass |
| IN-03 | Existing module upgrade | Giữ same moduleKey/B01 |
| IN-04 | New module | Chỉ tạo B01 khi plan đã approved |
| IN-05 | IAM permission catalog | Đối chiếu ACTIVE MIC07, least privilege |
| IN-06 | Admin-only Data/Logs | Unauthorized 403 + audit; admin allowed |
| IN-07 | B09 idempotence | Rerun không tạo menu duplicate |
| IN-08 | Deploy missing supervisor | Không báo ACTIVE, AWAITING_RESTART |
| IN-09 | Postcheck API fail | RECOVERY_REQUIRED, không báo success |
| IN-10 | Upgrade rollback route | Recovery path test PASS hoặc chặn auto-cutover |
| IN-11 | Retry/idempotence | Không duplicate permissions/versions/artifacts |
| IN-12 | INSTALLED_ACTIVE | B02/runtime/IAM/menu/postcheck đều khớp |
| SEC-01 | Unauthenticated | 401, không lộ path |
| SEC-02 | Nonadmin | 403, không ghi dữ liệu |
| SEC-03 | Invalid candidateId/path | Không thực thi shell/SQL |
| SEC-04 | Symlink/traversal | Bị từ chối |
| SEC-05 | No source DB secrets | Logs/report masked |
| SEC-06 | Wrong DB target | Refuse side effects |
| SEC-07 | Concurrency | Serial install per module, no double activate |
| RG-01 | AppShell/IAM/Foundation regression | No unexpected change |
| RG-02 | B07/B08 unchanged history | No DELETE or rewrite |
| RG-03 | Git status | No reset/push/merge/deploy PROD |

### Bằng chứng nghiệm thu

Mỗi test: time, environment, command, exit code, result, trace/reference và git commit/hash. Với DB actions: dump name+SHA256, before/after count, manifest IDs. Manual UI runtime acceptance đòi screenshots hoặc mô tả thao tác có bằng chứng.

Kết luận theo nhóm: `PASS`, `FAIL`, `NOT_TESTED`, `BLOCKED`. DONE tổng thể chỉ khi mọi gate bắt buộc PASS, kể cả recovery; PARTIAL khi có bước chưa thực thi, BLOCKED khi còn rủi ro cốt lõi.
