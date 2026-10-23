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
    async writable(): Promise<boolean> {
      const [r] = await db.query(`SELECT has_table_privilege('iam.iam_permissions', 'INSERT') AS ok`, []);
      return typeof r === 'object' && r !== null && 'ok' in r && r.ok === true;
    },
    async create(actor, data) {
      await repo.authorize(actor, IAM_ADMIN_PERMISSIONS.permissions);
      await repo.createPermission(actor, data);
    },
  };
}
