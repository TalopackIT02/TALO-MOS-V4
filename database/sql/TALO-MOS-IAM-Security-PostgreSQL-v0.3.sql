-- TALO-MOS / IAM & Security - PostgreSQL logical schema v0.3
-- Derived from IAM v0.2; v0.3 removes Active Role / Role Switching as approved on 2026-10-12.
-- Other v0.2 decisions remain unchanged; this DDL is NOT yet approved for execution.
-- Target: PostgreSQL 14+; run in an empty database or review migrations first.
-- This file creates the IAM schema only. External REF tables are NOT created.
-- IMPORTANT: Password hashes must be produced by application using Argon2id.
BEGIN;
CREATE SCHEMA IF NOT EXISTS iam;
SET search_path = iam, public;

-- Định danh nhân sự: Tồn tại khi nhân sự được ghi nhận, kể cả chưa cấp quyền truy cập. Không tái sử dụng ID cho người khác. Đây là đại diện IAM; nếu HR là nguồn dữ liệu chính thì đồng bộ/REF, không duy trì hai nguồn sự thật.
CREATE TABLE iam.iam_memberships (
    membership_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL,
    employee_code VARCHAR(50) NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    membership_status VARCHAR(20) NOT NULL,
    joined_at DATE NOT NULL,
    left_at DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_membership_status CHECK (membership_status IN ('ACTIVE','ON_LEAVE','EXITED')),
    CONSTRAINT ck_membership_dates CHECK (left_at IS NULL OR left_at >= joined_at)
);
COMMENT ON TABLE iam.iam_memberships IS 'Tồn tại khi nhân sự được ghi nhận, kể cả chưa cấp quyền truy cập. Không tái sử dụng ID cho người khác. Đây là đại diện IAM; nếu HR là nguồn dữ liệu chính thì đồng bộ/REF, không duy trì hai nguồn sự thật.';
COMMENT ON COLUMN iam.iam_memberships.membership_id IS 'Định danh bất biến của người trong phạm vi doanh nghiệp';
COMMENT ON COLUMN iam.iam_memberships.employee_id IS 'Liên kết hồ sơ nhân sự do HR quản lý';
COMMENT ON COLUMN iam.iam_memberships.employee_code IS 'Mã nhân viên dùng để khởi tạo username, không phải PK';
COMMENT ON COLUMN iam.iam_memberships.full_name IS 'Tên hiển thị lấy từ hồ sơ nhân sự';
COMMENT ON COLUMN iam.iam_memberships.membership_status IS 'ACTIVE, ON_LEAVE, EXITED; không đồng nghĩa trạng thái account';
COMMENT ON COLUMN iam.iam_memberships.joined_at IS 'Ngày bắt đầu tham gia';
COMMENT ON COLUMN iam.iam_memberships.left_at IS 'Ngày rời doanh nghiệp';
COMMENT ON COLUMN iam.iam_memberships.created_at IS 'Thời điểm ghi nhận';

-- Tài khoản đăng nhập: IT cấp tài khoản cho Membership. Trong draft: một Membership tối đa một account đang hoạt động, một account chỉ có một Membership; liên kết lịch sử cần bảo toàn. Quy tắc nhiều account theo thời gian còn chờ quyết định.
CREATE TABLE iam.iam_user_accounts (
    user_account_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    membership_id UUID NOT NULL,
    username VARCHAR(80) NOT NULL,
    account_status VARCHAR(20) NOT NULL DEFAULT 'PROVISIONED',
    created_by_account_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    CONSTRAINT ck_account_status CHECK (account_status IN ('PROVISIONED','ACTIVE','LOCKED','DISABLED'))
);
COMMENT ON TABLE iam.iam_user_accounts IS 'IT cấp tài khoản cho Membership. Trong draft: một Membership tối đa một account đang hoạt động, một account chỉ có một Membership; liên kết lịch sử cần bảo toàn. Quy tắc nhiều account theo thời gian còn chờ quyết định.';
COMMENT ON COLUMN iam.iam_user_accounts.user_account_id IS 'Khóa account bất biến';
COMMENT ON COLUMN iam.iam_user_accounts.membership_id IS 'Chủ thể nhân sự được cấp account';
COMMENT ON COLUMN iam.iam_user_accounts.username IS 'Khởi tạo bằng employee_code; không dùng làm PK';
COMMENT ON COLUMN iam.iam_user_accounts.account_status IS 'PROVISIONED, ACTIVE, SUSPENDED, DISABLED';
COMMENT ON COLUMN iam.iam_user_accounts.created_by_account_id IS 'IT tạo tài khoản';
COMMENT ON COLUMN iam.iam_user_accounts.created_at IS 'Thời điểm cấp';
COMMENT ON COLUMN iam.iam_user_accounts.activated_at IS 'Thời điểm đã hoàn tất đổi mật khẩu lần đầu';
COMMENT ON COLUMN iam.iam_user_accounts.disabled_at IS 'Khóa/vô hiệu hóa account; không xóa lịch sử';

-- Mật khẩu và vòng đời xác thực cấp 1: IT cấp mật khẩu tạm; chỉ lưu hash. Đổi mật khẩu bắt buộc trong lần đăng nhập đầu. Cấp 1 được xác lập khi người dùng đổi mật khẩu thành công.
CREATE TABLE iam.iam_credentials (
    credential_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID NOT NULL,
    password_hash TEXT NOT NULL,
    password_changed_at TIMESTAMPTZ,
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    failed_attempt_count INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_failed_count CHECK (failed_attempt_count >= 0)
);
COMMENT ON TABLE iam.iam_credentials IS 'IT cấp mật khẩu tạm; chỉ lưu hash. Đổi mật khẩu bắt buộc trong lần đăng nhập đầu. Cấp 1 được xác lập khi người dùng đổi mật khẩu thành công.';
COMMENT ON COLUMN iam.iam_credentials.credential_id IS 'Khóa credential';
COMMENT ON COLUMN iam.iam_credentials.user_account_id IS 'Tài khoản sở hữu credential';
COMMENT ON COLUMN iam.iam_credentials.password_hash IS 'Hash password bằng Argon2id hay thuật toán an toàn tương đương';
COMMENT ON COLUMN iam.iam_credentials.password_changed_at IS 'Lần đổi mật khẩu thành công';
COMMENT ON COLUMN iam.iam_credentials.must_change_password IS 'TRUE khi đang dùng mật khẩu tạm';
COMMENT ON COLUMN iam.iam_credentials.failed_attempt_count IS 'Bộ đếm lỗi nếu triển khai khóa đăng nhập đơn giản';
COMMENT ON COLUMN iam.iam_credentials.locked_until IS 'Thời điểm mở khóa tự động';
COMMENT ON COLUMN iam.iam_credentials.updated_at IS 'Thời điểm cập nhật';

-- Xác minh email và cấp 2: Email xác minh xác lập Assurance Level 2 theo quy ước nội bộ; KHÔNG phải MFA. Token xác minh không lưu plaintext.
CREATE TABLE iam.iam_account_verifications (
    verification_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID NOT NULL,
    email VARCHAR(320) NOT NULL,
    email_verified_at TIMESTAMPTZ,
    verification_token_hash TEXT,
    sent_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT ck_verification_status CHECK (status IN ('PENDING','VERIFIED','EXPIRED','REVOKED')),
    CONSTRAINT ck_verification_expiry CHECK (expires_at IS NULL OR sent_at IS NULL OR expires_at > sent_at)
);
COMMENT ON TABLE iam.iam_account_verifications IS 'Email xác minh xác lập Assurance Level 2 theo quy ước nội bộ; KHÔNG phải MFA. Token xác minh không lưu plaintext.';
COMMENT ON COLUMN iam.iam_account_verifications.verification_id IS 'Khóa quy trình xác minh';
COMMENT ON COLUMN iam.iam_account_verifications.user_account_id IS 'Tài khoản xác minh';
COMMENT ON COLUMN iam.iam_account_verifications.email IS 'Email liên kết, cần chuẩn hóa';
COMMENT ON COLUMN iam.iam_account_verifications.email_verified_at IS 'Bằng chứng đã kiểm soát email';
COMMENT ON COLUMN iam.iam_account_verifications.verification_token_hash IS 'Hash token xác minh đang chờ';
COMMENT ON COLUMN iam.iam_account_verifications.sent_at IS 'Lần gửi gần nhất';
COMMENT ON COLUMN iam.iam_account_verifications.expires_at IS 'Hạn xác minh';
COMMENT ON COLUMN iam.iam_account_verifications.consumed_at IS 'Thời điểm tiêu thụ token';
COMMENT ON COLUMN iam.iam_account_verifications.status IS 'PENDING, VERIFIED, EXPIRED, REVOKED';

-- Gói quyền và chức năng: Role là pack permission mặc định. Account có thể được cấp nhiều Role; không có Active Role / Role Switching.
CREATE TABLE iam.iam_roles (
    role_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    role_code VARCHAR(80) NOT NULL,
    role_name VARCHAR(150) NOT NULL,
    role_description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false
);
COMMENT ON TABLE iam.iam_roles IS 'Role là pack permission mặc định; Account có thể có nhiều Role, quyền hiệu lực tổng hợp từ các Role và ngoại lệ trực tiếp.';
COMMENT ON COLUMN iam.iam_roles.role_id IS 'Khóa Role';
COMMENT ON COLUMN iam.iam_roles.role_code IS 'Mã Role ổn định';
COMMENT ON COLUMN iam.iam_roles.role_name IS 'Tên vai trò';
COMMENT ON COLUMN iam.iam_roles.role_description IS 'Nhiệm vụ và phạm vi áp dụng';
COMMENT ON COLUMN iam.iam_roles.is_active IS 'Vai trò có đang sử dụng';
COMMENT ON COLUMN iam.iam_roles.is_system IS 'Phân biệt role chuẩn do IT quản lý';

-- Quyền nguyên tử: Mỗi permission mô tả quyền với tài nguyên/hành động; UI feature và backend action đều phải kiểm tra quyền.
CREATE TABLE iam.iam_permissions (
    permission_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    permission_code VARCHAR(160) NOT NULL,
    module_code VARCHAR(80) NOT NULL,
    resource_code VARCHAR(100) NOT NULL,
    operation VARCHAR(30) NOT NULL,
    minimum_assurance_level SMALLINT NOT NULL DEFAULT 1,
    permission_description TEXT,
    CONSTRAINT ck_min_assurance CHECK (minimum_assurance_level BETWEEN 1 AND 2)
);
COMMENT ON TABLE iam.iam_permissions IS 'Mỗi permission mô tả quyền với tài nguyên/hành động; UI feature và backend action đều phải kiểm tra quyền.';
COMMENT ON COLUMN iam.iam_permissions.permission_id IS 'Khóa quyền';
COMMENT ON COLUMN iam.iam_permissions.permission_code IS 'Ví dụ inventory.stock.read';
COMMENT ON COLUMN iam.iam_permissions.module_code IS 'Tên module';
COMMENT ON COLUMN iam.iam_permissions.resource_code IS 'Đối tượng nghiệp vụ';
COMMENT ON COLUMN iam.iam_permissions.operation IS 'READ, CREATE, UPDATE, DELETE, APPROVE, EXPORT';
COMMENT ON COLUMN iam.iam_permissions.minimum_assurance_level IS 'Cấp assurance tối thiểu, mặc định 1; không tự cấp permission';
COMMENT ON COLUMN iam.iam_permissions.permission_description IS 'Ý nghĩa thực thi';

-- Quyền bên trong Role: Join N:N Role - Permission, định nghĩa pack quyền.
CREATE TABLE iam.iam_role_permissions (
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);
COMMENT ON TABLE iam.iam_role_permissions IS 'Join N:N Role - Permission, định nghĩa pack quyền.';
COMMENT ON COLUMN iam.iam_role_permissions.role_id IS 'Role được cấu hình';
COMMENT ON COLUMN iam.iam_role_permissions.permission_id IS 'Quyền thuộc role';
COMMENT ON COLUMN iam.iam_role_permissions.created_at IS 'Lúc cấu hình';

-- Cấp Role cho Account: IT có thể gán trước khi account được kích hoạt hoặc sau đó; trạng thái account/assurance vẫn kiểm soát thực thi.
CREATE TABLE iam.iam_user_roles (
    user_role_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID NOT NULL,
    role_id UUID NOT NULL,
    assigned_by_id UUID,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
COMMENT ON TABLE iam.iam_user_roles IS 'IT có thể gán trước khi account được kích hoạt hoặc sau đó; trạng thái account/assurance vẫn kiểm soát thực thi.';
COMMENT ON COLUMN iam.iam_user_roles.user_role_id IS 'Khóa cấp role';
COMMENT ON COLUMN iam.iam_user_roles.user_account_id IS 'Account được cấp';
COMMENT ON COLUMN iam.iam_user_roles.role_id IS 'Gói quyền';
COMMENT ON COLUMN iam.iam_user_roles.assigned_by_id IS 'Account cấp';
COMMENT ON COLUMN iam.iam_user_roles.assigned_at IS 'Ngày cấp';
COMMENT ON COLUMN iam.iam_user_roles.revoked_at IS 'Ngày thu hồi';

-- Quyền lẻ / ngoại lệ: Cấp bổ sung ALLOW hoặc từ chối DENY theo account. DENY ưu tiên hơn ALLOW. Lưu lý do, người cấp và vòng đời.
CREATE TABLE iam.iam_user_permissions (
    user_permission_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    effect VARCHAR(10) NOT NULL,
    reason TEXT,
    assigned_by_id UUID,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT ck_grant_effect CHECK (effect IN ('ALLOW','DENY')),
    CONSTRAINT ck_grant_expiry CHECK (expires_at IS NULL OR expires_at > assigned_at)
);
COMMENT ON TABLE iam.iam_user_permissions IS 'Cấp bổ sung ALLOW hoặc từ chối DENY theo account. DENY ưu tiên hơn ALLOW. Lưu lý do, người cấp và vòng đời.';
COMMENT ON COLUMN iam.iam_user_permissions.user_permission_id IS 'Khóa ngoại lệ';
COMMENT ON COLUMN iam.iam_user_permissions.user_account_id IS 'Account nhận ngoại lệ';
COMMENT ON COLUMN iam.iam_user_permissions.permission_id IS 'Quyền cụ thể';
COMMENT ON COLUMN iam.iam_user_permissions.effect IS 'ALLOW hoặc DENY; DENY có ưu tiên cao hơn';
COMMENT ON COLUMN iam.iam_user_permissions.reason IS 'Lý do nghiệp vụ và phê duyệt';
COMMENT ON COLUMN iam.iam_user_permissions.assigned_by_id IS 'Người cấp';
COMMENT ON COLUMN iam.iam_user_permissions.assigned_at IS 'Ngày bắt đầu';
COMMENT ON COLUMN iam.iam_user_permissions.expires_at IS 'Hết hạn tùy chọn';
COMMENT ON COLUMN iam.iam_user_permissions.revoked_at IS 'Thời điểm thu hồi';

-- Phiên đăng nhập: Một account có thể có nhiều phiên; session gắn với Account, không mang Active Role.
CREATE TABLE iam.iam_sessions (
    session_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_account_id UUID NOT NULL,
    session_token_hash TEXT NOT NULL,
    assurance_level_snapshot SMALLINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    CONSTRAINT ck_session_assurance CHECK (assurance_level_snapshot BETWEEN 0 AND 2),
    CONSTRAINT ck_session_expiry CHECK (expires_at > created_at)
);
COMMENT ON TABLE iam.iam_sessions IS 'Phiên đăng nhập của Account; không có Active Role hay cơ chế Role Switching.';
COMMENT ON COLUMN iam.iam_sessions.session_id IS 'Định danh phiên xác thực';
COMMENT ON COLUMN iam.iam_sessions.user_account_id IS 'Account được xác thực';
COMMENT ON COLUMN iam.iam_sessions.session_token_hash IS 'Hash mã phiên; không lưu token thô';
COMMENT ON COLUMN iam.iam_sessions.assurance_level_snapshot IS 'Assurance tại lúc tạo; phải kiểm tra lại nếu thay đổi';
COMMENT ON COLUMN iam.iam_sessions.created_at IS 'Lúc mở phiên';
COMMENT ON COLUMN iam.iam_sessions.expires_at IS 'Hết hạn';
COMMENT ON COLUMN iam.iam_sessions.revoked_at IS 'Thu hồi';
COMMENT ON COLUMN iam.iam_sessions.last_seen_at IS 'Hoạt động cuối';

-- Nhật ký truy cập và thay đổi: Lưu đăng nhập, đổi mật khẩu, xác minh, gán/thu hồi quyền và các hành động nhạy cảm. Không ghi mật khẩu hoặc token.
CREATE TABLE iam.iam_audit_logs (
    audit_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    actor_account_id UUID,
    membership_id UUID,
    session_id UUID,
    action_code VARCHAR(120) NOT NULL,
    target_type VARCHAR(80) NOT NULL,
    target_id UUID,
    outcome VARCHAR(20) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB,
    CONSTRAINT ck_audit_outcome CHECK (outcome IN ('SUCCESS','FAILURE','DENIED'))
);
COMMENT ON TABLE iam.iam_audit_logs IS 'Lưu đăng nhập, đổi mật khẩu, xác minh, gán/thu hồi quyền và các hành động nhạy cảm. Không ghi mật khẩu hoặc token.';
COMMENT ON COLUMN iam.iam_audit_logs.audit_id IS 'Khóa sự kiện';
COMMENT ON COLUMN iam.iam_audit_logs.actor_account_id IS 'Tài khoản thực hiện, NULL nếu system';
COMMENT ON COLUMN iam.iam_audit_logs.membership_id IS 'Định danh nhân sự snapshot/truy vấn';
COMMENT ON COLUMN iam.iam_audit_logs.session_id IS 'Phiên thực hiện';
COMMENT ON COLUMN iam.iam_audit_logs.action_code IS 'LOGIN, CHANGE_PASSWORD, VERIFY_EMAIL, GRANT_PERMISSION...';
COMMENT ON COLUMN iam.iam_audit_logs.target_type IS 'Loại đối tượng thay đổi';
COMMENT ON COLUMN iam.iam_audit_logs.target_id IS 'Khóa đối tượng';
COMMENT ON COLUMN iam.iam_audit_logs.outcome IS 'SUCCESS, DENIED, FAILED';
COMMENT ON COLUMN iam.iam_audit_logs.occurred_at IS 'Thời điểm phát sinh';
COMMENT ON COLUMN iam.iam_audit_logs.metadata IS 'Thông tin đã loại secret và dữ liệu nhạy cảm';

ALTER TABLE iam.iam_user_accounts ADD CONSTRAINT fk_user_accounts_membership_id FOREIGN KEY (membership_id) REFERENCES iam.iam_memberships(membership_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_user_accounts ADD CONSTRAINT fk_user_accounts_created_by_account_id FOREIGN KEY (created_by_account_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_credentials ADD CONSTRAINT fk_credentials_user_account_id FOREIGN KEY (user_account_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_account_verifications ADD CONSTRAINT fk_account_verifications_user_account_id FOREIGN KEY (user_account_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_role_permissions ADD CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (role_id) REFERENCES iam.iam_roles(role_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_role_permissions ADD CONSTRAINT fk_role_permissions_permission_id FOREIGN KEY (permission_id) REFERENCES iam.iam_permissions(permission_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_user_roles ADD CONSTRAINT fk_user_roles_user_account_id FOREIGN KEY (user_account_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_user_roles ADD CONSTRAINT fk_user_roles_role_id FOREIGN KEY (role_id) REFERENCES iam.iam_roles(role_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_user_roles ADD CONSTRAINT fk_user_roles_assigned_by_id FOREIGN KEY (assigned_by_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_user_permissions ADD CONSTRAINT fk_user_permissions_user_account_id FOREIGN KEY (user_account_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_user_permissions ADD CONSTRAINT fk_user_permissions_permission_id FOREIGN KEY (permission_id) REFERENCES iam.iam_permissions(permission_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_user_permissions ADD CONSTRAINT fk_user_permissions_assigned_by_id FOREIGN KEY (assigned_by_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_sessions ADD CONSTRAINT fk_sessions_user_account_id FOREIGN KEY (user_account_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_audit_logs ADD CONSTRAINT fk_audit_logs_actor_account_id FOREIGN KEY (actor_account_id) REFERENCES iam.iam_user_accounts(user_account_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_audit_logs ADD CONSTRAINT fk_audit_logs_membership_id FOREIGN KEY (membership_id) REFERENCES iam.iam_memberships(membership_id) ON DELETE RESTRICT;
ALTER TABLE iam.iam_audit_logs ADD CONSTRAINT fk_audit_logs_session_id FOREIGN KEY (session_id) REFERENCES iam.iam_sessions(session_id) ON DELETE RESTRICT;

-- Idempotent uniqueness and protection for current operating model.
CREATE UNIQUE INDEX uq_iam_membership_employee ON iam.iam_memberships(employee_id);
CREATE UNIQUE INDEX uq_iam_membership_code ON iam.iam_memberships(employee_code);
CREATE UNIQUE INDEX uq_iam_account_username ON iam.iam_user_accounts (lower(username));
-- At most one non-disabled account per membership; past accounts remain for history.
CREATE UNIQUE INDEX uq_iam_membership_current_account ON iam.iam_user_accounts(membership_id) WHERE disabled_at IS NULL;
CREATE UNIQUE INDEX uq_iam_credential_account ON iam.iam_credentials(user_account_id);
CREATE UNIQUE INDEX uq_iam_role_code ON iam.iam_roles(lower(role_code));
CREATE UNIQUE INDEX uq_iam_permission_code ON iam.iam_permissions(lower(permission_code));
CREATE UNIQUE INDEX uq_iam_user_active_role ON iam.iam_user_roles(user_account_id,role_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_iam_user_active_direct_permission ON iam.iam_user_permissions(user_account_id,permission_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_iam_session_token_hash ON iam.iam_sessions(session_token_hash);
CREATE INDEX ix_iam_account_membership ON iam.iam_user_accounts(membership_id);
CREATE INDEX ix_iam_verification_account_status ON iam.iam_account_verifications(user_account_id,status);
CREATE INDEX ix_iam_user_roles_account ON iam.iam_user_roles(user_account_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_iam_user_permission_account ON iam.iam_user_permissions(user_account_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_iam_sessions_account_expiry ON iam.iam_sessions(user_account_id,expires_at DESC);
CREATE INDEX ix_iam_audit_account_time ON iam.iam_audit_logs(actor_account_id,occurred_at DESC);
CREATE INDEX ix_iam_audit_member_time ON iam.iam_audit_logs(membership_id,occurred_at DESC);
CREATE INDEX ix_iam_audit_time ON iam.iam_audit_logs(occurred_at DESC);

-- Application checks required: effective permissions combine all active assigned Roles + direct ALLOW, minus direct DENY;
-- current assurance level must be computed from credential change + verified email;
-- account/membership must be ACTIVE for business operations;
-- DENY overrides role/direct ALLOW and min_assurance is a separate gate;
-- external employee_id/organization_id/branch_id references require integration validation.
COMMIT;
