# 17 — REQUIREMENT → SOURCE → TEST → EVIDENCE MAP

Dùng bảng này để báo cáo tiến độ theo mã, không lặp phần giải thích ở các file khác. Tên tests tương ứng là gợi ý mới; nếu local đã có test tương đương, mở rộng test đó.

| Requirement | Source chính | Test cần có | Evidence |
|---|---|---|---|
| A01/A02/A03 MIC & DRAFT | installer.service, manifest.service, VersionPanel | unit manifest merge/locked/stale, integration DRAFT | REV-A + test MIC |
| A04/A05 Host/MIC identity | foundation.mic, module-host, moduleScreens | contract mismatch method/path/route | REV-A |
| A06/A07 Preflight evidence | preflight.ts, installer.store | hash run/reference, skip truthfulness | REV-A |
| A08 P6 auth/schema | preflight.ts, Host routes, API client | 200/403 envelope, 401 controls, bad payload | REV-A |
| A09/A10 NEW/EXISTING install | installer.service, store, versions | new module and B01 existing no ACTIVE | REV-A |
| A11/A12 active upgrade guard | lifecycle.service (protected), installer.service | no-retire-on-block, injection of failures; approved recovery only | REV-A / Decision Q01 |
| A13 IAM catalogue vs assignment | installer.iam, IAM admin repository | catalogue READY vs access NOT READY, allow/deny | REV-A |
| A14 B09 3-level | installer.service, navigation.builder/service | no legacy, hidden link replan, Develop anchor | REV-A |
| A15/A16 postcheck/journal | installer.service/store | resume/restart/error/status persistence | REV-A |
| B01–B03 Module UI and route | ModuleScreen, shellScreens | AppShell/breadcrumb, permission direct URL | REV-B |
| B04 Manual Scan | ModuleScan, scan.service | no POST on page load, click exactly once | REV-B |
| B05–B08 drawer/workspace | ModuleInstaller, ModuleScan, VersionPanel | drawer ESC/focus, modal, TXT export | REV-B |
| B09 Navigation UI | NavigationBuilder, navigationDraft | drag/draft/save unchanged; drawer inventory, mobile | REV-B |
| B10/B11 a11y/filter | styles, UI components | keyboard/mobile/FBET hidden toggle | REV-B |
| C01–C03 protected state | Git baseline, DB reads | before/after hash/counts; no schema/role write | REV-C |
| C04 candidate isolation | modules-sync, Host registry | release lock guard no new package mount | REV-C |
| C05 unauthorized/conflict | Foundation access/lifecycle/routes | 401/403/409/422, ENABLE route clash | REV-C |
| C06 fixture containment | Foundation tests/fixture harness | no stray FBET ACTIVE route, clean teardown | REV-C |
| C07/C08 builds/tests | package scripts, e2e specs | noEmit/build/unit/integration/e2e | TEST-RESULTS |
| C09 active untouched | DB snapshots, lock | SYSTEM_TEST 1.1.1/DATA_INSPECTOR 0.1.0 unchanged | FINAL |
| C10 reports | Installer routes/store | TXT/JSON content/hash/no secret | REV-C |

Không tạo file test riêng cho mỗi hàng khi có thể gom các assertions; quan trọng là chứng minh từng requirement. Mọi kết luận cuối phải dẫn về mã requirement và evidence thực.
