// SCC 0.1.2 — controlled reads for tables whose raw rows are not shown by the generic Data Inspection page.
// Two mechanisms, both SELECT only inside the Host's READ ONLY transaction (statement timeout 5 s):
//   DB_FUNCTION         a SECURITY DEFINER reader of the approved Database Access Gate (talo_app has EXECUTE only,
//                       never SELECT on the table): foundation_read_api.read_module_events / read_data_access_rules.
//   BACKEND_PROJECTION  a fixed column list on a table talo_app may already SELECT; secret columns are never named in
//                       the SQL (iam_sessions.session_token_hash, iam_memberships.employee_id).
// Joins only reach tables talo_app may read (fnd_modules, fnd_module_versions, fnd_data_contracts, iam_user_accounts.username).
// Every statement is a constant: LIMIT / OFFSET / window travel as bind parameters; nothing from the request becomes SQL.
// Owner policy decision "SCC 0.1.2 POLICY DECISION" (28/10/2026): TALO_SYSTEM_ADMIN may see full_name / employee_code of
// memberships (employee_id withheld) and the sessions of every account (identity, state, login, last activity, expiry);
// never a token, token hash, refresh token, cookie or credential; no session termination / editing in 0.1.2.

export type ProjectionSource = 'DB_FUNCTION' | 'BACKEND_PROJECTION';

export interface ControlledProjection {
  readonly key: 'MODULE_EVENTS' | 'DATA_ACCESS_RULES' | 'IAM_MEMBERSHIPS' | 'IAM_SESSION_METADATA';
  readonly schema: string;
  readonly table: string;
  readonly source: ProjectionSource;
  readonly reader: string; // what serves the rows (function name or "SCC backend projection")
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly withheld: readonly string[]; // table columns never read
  readonly orderBy: readonly string[];
  readonly note: string;
  readonly maxOffset: number;
  // $1 = LIMIT, $2 = OFFSET (+ $3 / $4 for windowed readers); returns the SQL and the bind values.
  readonly statement: (limit: number, offset: number, now: Date) => { readonly sql: string; readonly params: readonly unknown[] };
}

const EVENTS_WINDOW_DAYS = 366;

export const CONTROLLED_SQL = {
  moduleEvents: `
    SELECT e.event_id, e.occurred_at, e.event_type, m.module_key::text AS module_key, v.module_version::text AS module_version,
           e.before_status, e.after_status, e.before_enabled, e.after_enabled, e.manifest_hash,
           a.username::text AS actor_username, e.actor_account_id, e.correlation_id, e.module_id, e.version_id
      FROM foundation_read_api.read_module_events($3::timestamptz, $4::timestamptz, NULL::uuid, ''::text, $1::int, $2::int) AS e
      LEFT JOIN foundation.fnd_modules AS m ON m.module_id = e.module_id::uuid
      LEFT JOIN foundation.fnd_module_versions AS v ON v.version_id = e.version_id::uuid
      LEFT JOIN iam.iam_user_accounts AS a ON a.user_account_id = e.actor_account_id::uuid
     ORDER BY e.occurred_at DESC, e.event_id DESC`,
  dataAccessRules: `
    SELECT r.access_rule_id, m.module_key::text AS module_key, v.module_version::text AS module_version,
           c.resource_key::text AS resource_key, r.data_operation, r.approval_mode, r.workflow_key, r.is_enabled, r.created_at,
           r.data_contract_id, r.version_action_id
      FROM foundation_read_api.read_data_access_rules(NULL::uuid, NULL::boolean, $1::int, $2::int) AS r
      LEFT JOIN foundation.fnd_data_contracts AS c ON c.data_contract_id = r.data_contract_id::uuid
      LEFT JOIN foundation.fnd_module_versions AS v ON v.version_id = c.version_id
      LEFT JOIN foundation.fnd_modules AS m ON m.module_id = v.module_id
     ORDER BY r.access_rule_id`,
  memberships: `
    SELECT ms.membership_id::text AS membership_id, ms.employee_code::text AS employee_code, ms.full_name::text AS full_name,
           ms.membership_status::text AS membership_status, ms.joined_at::text AS joined_at, ms.left_at::text AS left_at,
           ms.created_at::text AS created_at,
           (SELECT count(*) FROM iam.iam_user_accounts AS a WHERE a.membership_id = ms.membership_id)::text AS linked_accounts
      FROM iam.iam_memberships AS ms
     ORDER BY ms.membership_id
     LIMIT $1 OFFSET $2`,
  sessions: `
    SELECT s.session_id::text AS session_id, a.username::text AS username, s.user_account_id::text AS user_account_id,
           CASE WHEN s.revoked_at IS NOT NULL THEN 'REVOKED' WHEN s.expires_at <= statement_timestamp() THEN 'EXPIRED' ELSE 'ACTIVE' END AS session_state,
           s.assurance_level_snapshot::text AS assurance_level, s.created_at::text AS created_at, s.last_seen_at::text AS last_seen_at,
           s.expires_at::text AS expires_at, s.revoked_at::text AS revoked_at
      FROM iam.iam_sessions AS s
      LEFT JOIN iam.iam_user_accounts AS a ON a.user_account_id = s.user_account_id
     ORDER BY s.created_at DESC, s.session_id DESC
     LIMIT $1 OFFSET $2`,
} as const;

const t = (name: string, type = 'text') => ({ name, type });

export const CONTROLLED_PROJECTIONS: readonly ControlledProjection[] = [
  {
    key: 'MODULE_EVENTS', schema: 'foundation', table: 'fnd_module_events', source: 'DB_FUNCTION',
    reader: 'foundation_read_api.read_module_events',
    columns: [t('event_id'), t('occurred_at'), t('event_type'), t('module_key'), t('module_version'), t('before_status'), t('after_status'),
      t('before_enabled'), t('after_enabled'), t('manifest_hash'), t('actor_username'), t('actor_account_id'), t('correlation_id'), t('module_id'), t('version_id')],
    withheld: ['before_state (JSON thô)', 'after_state (JSON thô)'],
    orderBy: ['occurred_at DESC', 'event_id DESC'],
    note: `Sự kiện lifecycle B07 trong ${EVENTS_WINDOW_DAYS} ngày gần nhất, đọc qua hàm có kiểm soát; trạng thái JSON được rút gọn thành các trường đã kiểm định dạng.`,
    maxOffset: 100_000,
    statement: (limit, offset, now) => ({ sql: CONTROLLED_SQL.moduleEvents,
      params: [limit, offset, new Date(now.getTime() - EVENTS_WINDOW_DAYS * 86_400_000).toISOString(), now.toISOString()] }),
  },
  {
    key: 'DATA_ACCESS_RULES', schema: 'foundation', table: 'fnd_data_access_rules', source: 'DB_FUNCTION',
    reader: 'foundation_read_api.read_data_access_rules',
    columns: [t('access_rule_id'), t('module_key'), t('module_version'), t('resource_key'), t('data_operation'), t('approval_mode'),
      t('workflow_key'), t('is_enabled'), t('created_at'), t('data_contract_id'), t('version_action_id')],
    withheld: [],
    orderBy: ['access_rule_id'],
    note: 'Quy tắc truy cập dữ liệu MIC-06, đọc qua hàm có kiểm soát (không cấp SELECT trực tiếp cho vai trò ứng dụng).',
    maxOffset: 100_000,
    statement: (limit, offset) => ({ sql: CONTROLLED_SQL.dataAccessRules, params: [limit, offset] }),
  },
  {
    key: 'IAM_MEMBERSHIPS', schema: 'iam', table: 'iam_memberships', source: 'BACKEND_PROJECTION',
    reader: 'SCC backend projection',
    columns: [t('membership_id'), t('employee_code'), t('full_name'), t('membership_status'), t('joined_at'), t('left_at'), t('created_at'), t('linked_accounts')],
    withheld: ['employee_id'],
    orderBy: ['membership_id'],
    note: 'Dữ liệu quản trị thành viên: mã nhân viên, họ tên, trạng thái, ngày vào / rời và số tài khoản liên kết. Không hiển thị employee_id (định danh hệ thống nhân sự).',
    maxOffset: 1_000_000,
    statement: (limit, offset) => ({ sql: CONTROLLED_SQL.memberships, params: [limit, offset] }),
  },
  {
    key: 'IAM_SESSION_METADATA', schema: 'iam', table: 'iam_sessions', source: 'BACKEND_PROJECTION',
    reader: 'SCC backend projection',
    columns: [t('session_id'), t('username'), t('user_account_id'), t('session_state'), t('assurance_level'), t('created_at'), t('last_seen_at'), t('expires_at'), t('revoked_at')],
    withheld: ['session_token_hash'],
    orderBy: ['created_at DESC', 'session_id DESC'],
    note: 'Metadata phiên đăng nhập (trạng thái, thời điểm, mức xác thực). Không bao giờ đọc hay trả token / hash của phiên.',
    maxOffset: 1_000_000,
    statement: (limit, offset) => ({ sql: CONTROLLED_SQL.sessions, params: [limit, offset] }),
  },
];

export function controlledProjectionOf(schema: string, table: string): ControlledProjection | undefined {
  return CONTROLLED_PROJECTIONS.find((p) => p.schema === schema && p.table === table);
}

// Catalog classification: PostgreSQL's own catalogs are never business data (they are listed, but separately).
const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema']);
export type TableCategory = 'BUSINESS' | 'SYSTEM_CATALOG';
export function categoryOf(schema: string): TableCategory {
  return SYSTEM_SCHEMAS.has(schema) || schema.startsWith('pg_toast') || schema.startsWith('pg_temp_') ? 'SYSTEM_CATALOG' : 'BUSINESS';
}
