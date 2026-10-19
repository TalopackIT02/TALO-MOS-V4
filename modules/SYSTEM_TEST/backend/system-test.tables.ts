// MOD-TEST-01 — Data Viewer allowlist (server code only). A request names a table by its key (B01…B14); the schema,
// table, columns and ORDER BY come from this list and nowhere else — never from the request. Columns are the scalar
// columns of the Foundation tables; JSON documents (MIC, contract / action specs, compatibility values, event states)
// and B07 / B08 metadata are left out (owner rule: approved safe audit fields only). B08.session_id is left out too.
// IAM tables are not listed (first version). Whether the API role may read a table is asked to PostgreSQL at runtime
// (has_column_privilege); no grant is assumed here.

export interface ViewerTable {
  readonly tableKey: string;
  readonly label: string;
  readonly schema: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly hiddenColumns: readonly string[];
  // Deterministic order (uuid / timestamp / integer columns, no collation involved): the last column is the primary key.
  readonly orderBy: readonly string[];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function table(tableKey: string, label: string, name: string, columns: readonly string[], hiddenColumns: readonly string[], orderBy: readonly string[]): ViewerTable {
  for (const id of [name, ...columns, ...hiddenColumns, ...orderBy]) {
    if (!IDENTIFIER.test(id)) throw new Error(`invalid identifier in the viewer allowlist: ${tableKey}`);
  }
  for (const id of orderBy) if (!columns.includes(id)) throw new Error(`ORDER BY column not shown: ${tableKey}`);
  return { tableKey, label, schema: 'foundation', table: name, columns, hiddenColumns, orderBy };
}

export const VIEWER_TABLES: readonly ViewerTable[] = [
  table('B01', 'Module', 'fnd_modules',
    ['module_id', 'module_key', 'module_name', 'description', 'module_type', 'is_enabled', 'created_at', 'updated_at', 'created_by_account_id'], [],
    ['created_at', 'module_id']),
  table('B02', 'Phiên bản Module', 'fnd_module_versions',
    ['version_id', 'module_id', 'module_version', 'contract_version', 'status', 'manifest_hash', 'submitted_by_account_id', 'created_at',
      'reviewed_by_account_id', 'reviewed_at', 'activated_at'], ['manifest_json'],
    ['created_at', 'version_id']),
  table('B03', 'Function', 'fnd_functions',
    ['function_id', 'module_id', 'function_key', 'created_at', 'retired_at', 'replaces_function_id'], [],
    ['created_at', 'function_id']),
  table('B04', 'Action', 'fnd_actions',
    ['action_id', 'function_id', 'action_key', 'created_at', 'retired_at'], [],
    ['created_at', 'action_id']),
  table('B05', 'Function theo phiên bản', 'fnd_version_functions',
    ['version_function_id', 'version_id', 'function_id', 'display_name', 'route_key', 'definition_hash', 'is_deprecated'], [],
    ['version_id', 'version_function_id']),
  table('B06', 'Action theo phiên bản', 'fnd_version_actions',
    ['version_action_id', 'version_function_id', 'action_id', 'description', 'definition_hash', 'is_deprecated'], ['action_spec'],
    ['version_function_id', 'version_action_id']),
  table('B07', 'Sự kiện Module', 'fnd_module_events',
    ['event_id', 'module_id', 'version_id', 'event_type', 'actor_account_id', 'occurred_at', 'correlation_id'], ['before_state', 'after_state'],
    ['occurred_at', 'event_id']),
  table('B08', 'Nhật ký Audit', 'fnd_audit_logs',
    ['audit_id', 'event_id', 'module_id', 'version_id', 'actor_account_id', 'action_code', 'target_type', 'target_id', 'outcome', 'occurred_at',
      'recorded_at', 'correlation_id', 'source_service'], ['session_id', 'metadata'],
    ['occurred_at', 'audit_id']),
  table('B09', 'Mục điều hướng', 'fnd_navigation_items',
    ['navigation_id', 'parent_id', 'module_id', 'function_id', 'menu_title', 'sort_order', 'is_visible', 'created_at'], [],
    ['created_at', 'navigation_id']),
  table('B10', 'Data Contract', 'fnd_data_contracts',
    ['data_contract_id', 'version_id', 'resource_key', 'data_owner_key', 'interface_kind', 'schema_name', 'table_name', 'schema_version',
      'contract_hash', 'created_at'], ['contract_spec'],
    ['created_at', 'data_contract_id']),
  table('B11', 'Trường dữ liệu', 'fnd_data_fields',
    ['field_id', 'data_contract_id', 'field_name', 'field_type', 'is_required', 'default_expression', 'is_primary_key', 'references_target', 'description'], [],
    ['data_contract_id', 'field_id']),
  table('B12', 'Quy tắc truy cập dữ liệu', 'fnd_data_access_rules',
    ['access_rule_id', 'data_contract_id', 'version_action_id', 'data_operation', 'approval_mode', 'workflow_key', 'is_enabled', 'created_at'], [],
    ['created_at', 'access_rule_id']),
  table('B13', 'Kiểm tra tương thích', 'fnd_compatibility_checks',
    ['check_id', 'module_id', 'from_version_id', 'to_version_id', 'environment', 'check_result', 'database_fingerprint', 'started_at', 'completed_at'], [],
    ['started_at', 'check_id']),
  table('B14', 'Thay đổi tương thích', 'fnd_compatibility_changes',
    ['change_id', 'check_id', 'change_area', 'object_key', 'change_type', 'severity', 'resolution_status', 'details'], ['previous_value', 'proposed_value'],
    ['check_id', 'change_id']),
];

export function viewerTable(tableKey: string): ViewerTable | undefined {
  return VIEWER_TABLES.find((t) => t.tableKey === tableKey);
}

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 100;
export const PAGE_MAX = 100_000;

const quote = (id: string) => `"${id}"`;

// SELECT built only from allowlist identifiers (validated above); paging values are bind parameters $1 / $2.
export function rowsSql(t: ViewerTable): string {
  const cols = t.columns.map((c) => `${quote(c)}::text AS ${quote(c)}`).join(', ');
  const order = t.orderBy.map(quote).join(', ');
  return `SELECT ${cols} FROM ${quote(t.schema)}.${quote(t.table)} ORDER BY ${order} LIMIT $1 OFFSET $2`;
}

export function countSql(t: ViewerTable): string {
  return `SELECT count(*)::int AS n FROM ${quote(t.schema)}.${quote(t.table)}`;
}
