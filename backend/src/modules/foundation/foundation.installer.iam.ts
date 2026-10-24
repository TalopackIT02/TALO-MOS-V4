import { z } from 'zod';
import { IAM_ADMIN_PERMISSIONS, IamAdminRepository } from '../iam-admin/iam.admin.repository.js';
import type { FoundationDb } from './foundation.repository.js';
import type { IamCatalog, IamPermissionRow } from './foundation.installer.service.js';

// FMI-03 — IAM catalog for the installer, through the IAM Management repository exactly as POST /api/iam/admin/permissions
// does: authorise iam.permissions.manage (IAM DENIED audit on refusal), then createPermission() (K05 triple must match
// the ACTIVE, hash-intact MIC-07; platform IAM / FOUNDATION codes refused; IAM audit). Nothing is assigned here.

const row = z.object({ permission_code: z.string(), module_code: z.string(), resource_code: z.string(), operation: z.string(), minimum_assurance_level: z.coerce.number() });

export function createIamCatalog(db: FoundationDb, rootAccountId: string | null): IamCatalog {
  const repo = new IamAdminRepository(db, rootAccountId);
  return {
    permission: IAM_ADMIN_PERMISSIONS.permissions,
    async existing(moduleCode: string): Promise<IamPermissionRow[]> {
      const rows = await db.query(`SELECT permission_code, module_code, resource_code, operation, minimum_assurance_level FROM iam.iam_permissions WHERE module_code = $1`, [moduleCode]);
      return rows.map((r) => row.parse(r)).map((r) => ({ permissionCode: r.permission_code, moduleCode: r.module_code, resourceCode: r.resource_code, operation: r.operation, minimumAssuranceLevel: r.minimum_assurance_level }));
    },
    async assignments(moduleCode: string): Promise<number> {
      const [r] = await db.query(`SELECT (SELECT count(*) FROM iam.iam_role_permissions rp JOIN iam.iam_permissions p ON p.permission_id = rp.permission_id WHERE p.module_code = $1)
        + (SELECT count(*) FROM iam.iam_user_permissions up JOIN iam.iam_permissions p ON p.permission_id = up.permission_id WHERE p.module_code = $1 AND up.effect = 'ALLOW') AS n`, [moduleCode]);
      return Number((r as { n?: unknown } | undefined)?.n ?? 0);
    },
    // REV01-D2: the privileges the real write path needs, at COLUMN level (the TEST grants are column grants; a table-level
    // has_table_privilege(…,'INSERT') is false for them and was a false IAM_DB_GRANT_MISSING): INSERT of the six columns
    // createPermission() writes (permission_id has its default), SELECT of the RETURNING / duplicate-check columns, and
    // INSERT of the IAM audit columns mutation() writes. Checked on THIS connection (current_user).
    async writable(): Promise<boolean> {
      const [r] = await db.query(`
        SELECT (SELECT bool_and(has_column_privilege('iam.iam_permissions', c, 'INSERT')) FROM unnest(ARRAY['permission_code','module_code','resource_code','operation','minimum_assurance_level','permission_description']) AS c)
           AND (SELECT bool_and(has_column_privilege('iam.iam_permissions', c, 'SELECT')) FROM unnest(ARRAY['permission_id','permission_code','module_code','resource_code','operation','minimum_assurance_level']) AS c)
           AND (SELECT bool_and(has_column_privilege('iam.iam_audit_logs', c, 'INSERT')) FROM unnest(ARRAY['actor_account_id','action_code','target_type','target_id','outcome','metadata']) AS c) AS ok`, []);
      return typeof r === 'object' && r !== null && 'ok' in r && r.ok === true;
    },
    async create(actor, data) {
      await repo.authorize(actor, IAM_ADMIN_PERMISSIONS.permissions);
      await repo.createPermission(actor, data);
    },
  };
}
