# CATALOG — Bản đồ cấu trúc TALO-MOS-V4

**Mục đích:** Giải thích tất cả khu vực trong repository, trách nhiệm và quyền thao tác. Đây là bản catalog cho người quản lý dự án, không phải lệnh chạy ứng dụng.

## Quy ước quyền
- **User-owned / read-only to Claude**: Claude được đọc, không ghi đè hoặc di chuyển file.
- **Approved-task only**: Claude chỉ được chỉnh sửa đúng file/phạm vi mà task đã được duyệt.
- **Claude artifacts**: Claude được viết kế hoạch nháp, báo cáo, đề xuất và handoff, không được coi là phê duyệt.
- **Protected**: cần User duyệt riêng trước thay đổi, kể cả khi đường dẫn nằm trong khu vực coding.

## Danh mục thư mục

| Đường dẫn | Chứa gì | Ai ghi/chỉnh sửa | Ghi chú |
|---|---|---|---|
| `apps/web/` | Source frontend WebApp | Claude theo task duyệt | Chưa chọn framework |
| `apps/web/public/` | Tài nguyên công khai do frontend phục vụ | Approved-task only | Không để bí mật |
| `apps/web/src/app/` | Bootstrap, router/app entry theo framework | Approved-task only | Chưa có code |
| `apps/web/src/components/` | Component UI theo màn hình | Approved-task only | Không tự phát minh nghiệp vụ |
| `apps/web/src/layouts/` | Login layout, AppShell, page shell | Approved-task only | Blueprint cần duyệt |
| `apps/web/src/features/` | Chức năng giao diện từng module | Approved-task only | Chỉ presentation logic theo scope |
| `apps/web/src/services/` | API client, service calls | Approved-task only | Bám API contract |
| `apps/web/src/hooks/` | Hooks composable frontend | Approved-task only | Chưa chọn công nghệ |
| `apps/web/src/styles/` | Global styles, tokens | Approved-task only | Theo design system |
| `apps/web/src/assets/` | Asset đưa vào bundle | Approved-task only | Bản gốc nên nằm trong inputs |
| `apps/api/` | Source backend/API | Claude theo task duyệt | Không đồng nghĩa được tạo business logic |
| `apps/api/src/controllers/` | Request handlers | Approved-task only | Không thay contract |
| `apps/api/src/routes/` | API routing | Approved-task only | Theo API spec |
| `apps/api/src/services/` | Application/integration services | Approved-task only | Business rules protected |
| `apps/api/src/adapters/` | Adapter các hệ thống | Approved-task only | Theo đặc tả |
| `apps/api/src/middleware/` | Middleware | Approved-task only | Auth/authorization thay đổi phải duyệt |
| `apps/api/src/config/` | Config không chứa secrets | Approved-task only | Secret không commit |
| `apps/api/src/types/` | Backend types | Approved-task only | Đồng bộ contracts |
| `packages/ui/` | UI library dùng chung | Approved-task only | Cân nhắc tách khi thực sự cần |
| `packages/contracts/` | API contracts dùng chung | Protected / riêng theo task | Thay đổi contract phải duyệt |
| `packages/types/` | Type shared | Approved-task only | Không ngầm thay domain schema |
| `packages/config/` | Config dùng chung | Approved-task only | Thay stack/dependency cần duyệt |
| `database/design/` | SQL thiết kế User đưa vào | User-owned | Không migrate/run tự động |
| `database/diagrams/` | Sơ đồ ERD | User-owned | Có thể lưu ảnh/PDF/diagram source |
| `database/documentation/` | Data dictionary, DB spec | User-owned | Nguồn tham chiếu |
| `inputs/requirements/` | Đặc tả gốc | User-owned | Input không đồng nghĩa Approval |
| `inputs/images/` | Mockup/hình demo gốc | User-owned | Không ghi đè |
| `inputs/html-demos/` | HTML/CSS/JS demo gốc | User-owned | Không coi là production source |
| `inputs/references/` | Tài liệu tham khảo khác | User-owned | Phân biệt tham khảo/approved |
| `inputs/archive/` | Bản input cũ | User-owned | Không tự xóa |
| `design/screens/` | Đặc tả màn hình chuẩn hóa | User duyệt; Claude sửa theo task | Không đồng nghĩa approved mặc định |
| `design/components/` | UI design system spec | User duyệt; Claude sửa theo task | Layout/styles/tokens |
| `design/navigation/` | Sitemap, navigation flows | User duyệt; Claude sửa theo task | Không tự thêm nghiệp vụ |
| `design/blueprints/` | UI blueprint chính thức | User duyệt; Claude sửa theo task | Chỉ dùng bản được duyệt |
| `claude/plans/` | Draft/approved plan | Claude draft; User approve | Giữ lịch sử, không ghi đè plan approved |
| `claude/reports/` | Báo cáo thực thi/test | Claude | Không báo passed nếu chưa chạy |
| `claude/reviews/` | Code/UX/security reviews | Claude | Ý kiến chưa phải quyết định |
| `claude/proposals/` | Đề xuất công nghệ/schema/scope | Claude | Không áp dụng trước approval |
| `claude/handoffs/` | Trạng thái và bước tiếp theo | Claude | Ghi việc tồn đọng |
| `governance/` | Chính sách/kiến trúc/đăng ký công nghệ | User-owned | Claude chỉ đọc, đề xuất tại `claude/proposals/` |
| `tests/e2e/` | Automated end-to-end tests | Approved-task only | Chạy trong test env |
| `tests/integration/` | Integration tests | Approved-task only | Không dùng production database |
| `scripts/` | Build/check scripts | Approved-task only | Review trước scripts nguy hiểm |
| `.claude/` | Claude Code config | User-owned | Ví dụ tối thiểu, phải cấu hình thực tế |
| `.github/workflows/` | CI workflows | Protected | Không tự tạo deployment |

## File ở root

| File | Dùng làm gì |
|---|---|
| `CLAUDE.md` | Entry point: Claude phải đọc luật, scope, tech registry trước task |
| `README.md` | Trạng thái, cách tiếp nhận repository |
| `CATALOG.md` | Tài liệu giải thích từng folder/file |
| `.gitignore` | Tránh commit môi trường/secret/build artifacts |
| `.env.example` | Placeholder cho biến cấu hình sau khi chốt stack |

## File quản trị chính

| File | Dùng làm gì |
|---|---|
| `governance/CLAUDE_CODE_LAW.md` | Luật, approval, ranh giới hành vi |
| `governance/PROTECTED_SCOPE.md` | Danh sách vùng read-only/controlled và nguyên tắc change control |
| `governance/TECHNOLOGY_REGISTRY.md` | Phân biệt USER_MANDATED, CLAUDE_PROPOSED, APPROVED, IMPLEMENTED |
| `governance/ARCHITECTURE.md` | Các quyết định kiến trúc còn trống/chưa chốt |
| `governance/DECISIONS.md` | Nhật ký quyết định explicit của User |
| `governance/CHANGELOG.md` | Ghi thay đổi chính sách/kiến trúc đã phê duyệt |

## Luồng xử lý khuyến nghị
1. User cung cấp hình ảnh/HTML/đặc tả/SQL thiết kế vào các thư mục input tương ứng.
2. Claude đọc nguyên liệu gốc và ghi draft Plan tại `claude/plans/`.
3. User phê duyệt rõ task, file scope, ràng buộc và validation; ghi nhận vào Plan/Decision.
4. Claude sửa chỉ file được cho phép tại `apps/`, `packages/`, `design/`, `tests/`, `scripts/`.
5. Claude chạy test được phép, ghi `claude/reports/`, `claude/handoffs/`.
6. Các đề xuất thay schema, logic, kiến trúc, dependency đi vào `claude/proposals/` chứ không tự triển khai.

## Naming convention
- Plan: `TASK-YYYYMMDD-NNN-PLAN.md`
- Report: `TASK-YYYYMMDD-NNN-REPORT.md`
- Review: `TASK-YYYYMMDD-NNN-REVIEW.md`
- Handoff: `TASK-YYYYMMDD-NNN-HANDOFF.md`
- Technology proposal: `TECH-CHANGE-YYYYMMDD-NNN.md`

## Các mục vẫn cần User quyết định
Frontend/backend framework, ngôn ngữ, package manager, runtime version, DB engine/contract, auth strategy, UI library, test tools, deploy strategy. Không có lựa chọn mặc định được phê duyệt từ bộ ZIP này.
