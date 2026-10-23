# FMI-01 — Quy tắc Scan, MIC và Package

## 1. Danh sách kiểm tra tối thiểu

| ID | Check | PASS nếu | FAIL/WARN/UNAVAILABLE nếu |
|---|---|---|---|
| MS-01 | Root/folder | Folder con trực tiếp có thể đọc an toàn | Folder không hợp lệ hoặc root unavailable |
| MS-02 | Path Safety | Không symlink/junction/escape | Lstat và realpath không hợp lệ |
| MS-03 | Manifest file | module.json hiện hữu và JSON parse được | Thiếu/JSON invalid |
| MS-04 | Package format | `TALO-MODULE-PACKAGE-1` | Sai/missing |
| MS-05 | Key | K01, trùng tên folder | Sai chữ hoa / key |
| MS-06 | Version | SemVer `MAJOR.MINOR.PATCH` | Sai version |
| MS-07 | Host | `TALO-MODULE-HOST-1` | Không hỗ trợ |
| MS-08 | Capabilities | Trong `HOST_CAPABILITIES` thực tế | Capability lạ |
| MS-09 | Backend entry | Path tương đối cho phép và file thật tồn tại | Thiếu/sai path |
| MS-10 | Frontend entry | Path tương đối cho phép và file thật tồn tại | Thiếu/sai path |
| MS-11 | Frontend screens | screenKey/route/tabs đúng validator Host | Sai syntax, duplicate nội package |
| MS-12 | MIC JSON | JSON data-only được tìm thấy/parse | MISSING/INVALID/legacy-only |
| MS-13 | MIC Schema | Tái sử dụng `micSchema` | Schema lỗi |
| MS-14 | MIC Identity | moduleKey/version/contract trùng manifest | Mismatch |
| MS-15 | Cross refs | Function/Action/API/IAM K05 đúng | Sai/missing/extra |
| MS-16 | Route conflicts | Không trùng package khác / admin route | Conflict; re-use route của chính module upgrade hợp lệ |
| MS-17 | Registry | Registry/version tra được chính xác | Registry unavailable -> UNAVAILABLE |
| MS-18 | Compatibility | MIC09 đúng lifecycle & fromVersion | Sai INITIAL/CHANGE |
| MS-19 | MIC10 | Biết chính xác trạng thái declaration | PENDING/UNVERIFIED -> WARN, không runtime PASS |
| MS-20 | Package integrity | SHA256 deterministic và ổn định | File thay đổi/vượt limit -> FAIL/UNAVAILABLE |

## 2. Code lỗi tối thiểu

`MODULE_MANIFEST_MISSING`, `MODULE_MANIFEST_INVALID`, `MODULE_KEY_MISMATCH`, `MODULE_VERSION_INVALID`, `PACKAGE_FORMAT_UNSUPPORTED`, `HOST_PROTOCOL_UNSUPPORTED`, `CAPABILITY_UNSUPPORTED`, `MODULE_ENTRY_MISSING`, `MODULE_ROUTE_CONFLICT`, `MIC_FILE_MISSING`, `MIC_JSON_INVALID`, `MIC_SCHEMA_INVALID`, `MIC_IDENTITY_MISMATCH`, `MIC_MAPPING_INVALID`, `MIC_COMPATIBILITY_INVALID`, `LEGACY_MIC_FORMAT`, `TEST_EVIDENCE_PENDING`, `TEST_EVIDENCE_UNVERIFIED`, `REGISTRY_UNAVAILABLE`, `VERSION_ALREADY_LOCKED`, `PACKAGE_CHANGED_DURING_SCAN`, `PATH_UNSAFE`, `SCAN_LIMIT_EXCEEDED`.

Code lỗi ổn định; human message bằng tiếng Việt, không expose bí mật. Kết quả `UNKNOWN` phải hiện rõ, không ép về PASS.

## 3. MIC và tương thích legacy

- Package mới: `mic/module.mic.json` chuẩn, dữ liệu MIC01–MIC10; `micEntry` trong module.json vẫn có thể trỏ `.ts` để tuân loader cũ.
- Legacy `.ts` (không `.json`): **không được import/execute** để trích MIC. Nếu module đã installed/ACTIVE, báo `LEGACY_MIC_FORMAT` ở mức cảnh báo/hạn chế candidate, không can thiệp runtime.
- Nếu package mới không có JSON: FAIL static gate và không eligible for Preflight.
- Tái sử dụng validator Foundation `validateMic()` và cấu trúc context `{moduleKey,moduleVersion,contractVersion,otherVersions}`. Validator không tự xác minh runtime MIC10.
- `mic09Compatibility`: INITIAL_REGISTRATION khi không tồn tại version trạng thái eligible, CHANGE khi có và fromVersion tồn tại đúng contract. Không tự chỉnh MIC09.
- MIC10 PASS từ JSON chỉ là **khai báo** và phải đánh WARN `TEST_EVIDENCE_UNVERIFIED` cho đến FMI-02. MIC10 NOT_TESTED => WARN `TEST_EVIDENCE_PENDING`.

## 4. Package Hash

Đề xuất định nghĩa package snapshot:

- Duyệt mọi file hợp lệ trong package (trừ danh mục loại trừ được định nghĩa rõ). Không theo symlink.
- Tập file và byte được giới hạn; không đọc/ghi file bí mật.
- Sắp thứ tự các relative file path theo UTF-8/byte-order xác định, xử lý slash thống nhất.
- Hash SHA-256 trên từng file content, tổng hợp digest cuối từ `relative path` và digest bytes có length-delimiter nhằm tránh collision do concat không phân định.
- Hash toàn package cần thay đổi nếu sửa code, MIC, tests hay module.json (trong tập hash). Không hash `.git`, `node_modules`, `dist`, artifacts và secrets bị loại trừ.
- Kiểm tra metadata/mtime và file identity nhất quán trước/sau scan (Windows cần thận trọng); khi có dấu hiệu race, không khẳng định stable hash.
- Chỉ hiển thị hex64 nếu thành công, `null` nếu thất bại.

## 5. Registry và xung đột

- Đọc B01 + B02 bằng SELECT qua repository phù hợp, không thay đổi cấu trúc B01–B14.
- Phân loại version có SemVer bằng so sánh số nguyên từng thành phần, không lexicographic.
- Không tính cùng route của cùng module nâng cấp là conflict sai; không bỏ qua conflict giữa các folder hiện có hoặc với admin route (AppShell).
- Nếu version đã APPROVED/ACTIVE/RETIRED, người dùng không được ghi đè cùng version theo luồng cài đặt mới.
- Registry lỗi: `REGISTRY_UNKNOWN`, không khai báo `NEW_MODULE` và không đặt `eligibleForPreflight=true`.

## 6. Static Scan không phải runtime verification

Không gọi module API, không kiểm tra backend trả response thật, không cấp session fixture, không kiểm tra DB privileges theo các câu SQL tùy ý trong package. Các bước đó thuộc FMI-02.
