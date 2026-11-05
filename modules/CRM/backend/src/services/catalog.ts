import { z } from 'zod';
import type { ModuleActor } from '../../host.js';
import { CrmError } from '../errors.js';
import { P, SESSION_PERMISSIONS } from '../permissions.js';
import { CrmRuntime, parseRows, s } from '../runtime.js';

// Session (account + the CRM permissions the caller holds, evaluated by IAM — the frontend only shows / hides actions with
// it, every API re-checks), the account directory (display names) and the reference catalogues (provinces / wards /
// regions, read-only reference data of the accepted Gate 2 database).

// 3-miền grouping (INTERNAL_BUSINESS_RULE, cm_ref_province_region_map.macro_region_code): labels only.
const MACRO_REGION_NAMES: Readonly<Record<string, string>> = { NORTH: 'Miền Bắc', CENTRAL: 'Miền Trung', SOUTH: 'Miền Nam' };

const accountRow = z.object({ accountId: s, fullName: s, title: s, active: z.boolean() });
const ACCOUNT_SELECT = `SELECT ua.user_account_id::text AS "accountId", coalesce(m.full_name, ua.username) AS "fullName", coalesce(m.employee_code, '') AS title,
  (ua.account_status = 'ACTIVE' AND ua.disabled_at IS NULL) AS active
  FROM iam.iam_user_accounts AS ua LEFT JOIN iam.iam_memberships AS m ON m.membership_id = ua.membership_id`;

export class CatalogService {
  constructor(private readonly rt: CrmRuntime) {}

  async session(actor: ModuleActor) {
    return this.rt.readSelf(actor, async (ctx, q) => {
      const [row] = await q.query(`${ACCOUNT_SELECT} WHERE ua.user_account_id = $1::uuid`, [ctx.actor.userAccountId]);
      if (row === undefined) throw new CrmError(403, 'CM_PERMISSION_DENIED');
      const permissions: string[] = [];
      for (const p of SESSION_PERMISSIONS) if (await ctx.allowed(p)) permissions.push(p.permissionCode);
      return { account: accountRow.parse(row), permissions };
    });
  }

  async accounts(actor: ModuleActor) {
    return this.rt.read(actor, P.customerRead, async (_ctx, q) => parseRows(accountRow, await q.query(`${ACCOUNT_SELECT} ORDER BY 2, 1 LIMIT 5000`, [])));
  }

  async provinces(actor: ModuleActor) {
    return this.rt.read(actor, P.referenceRead, async (_ctx, q) => {
      const provinces = z.array(z.object({ code: s, name: s, region: z.string().nullable(), macro: z.string().nullable() })).parse(await q.query(`
        SELECT p.province_code::text AS code, p.province_name AS name, rm.region_code AS region, rm.macro_region_code AS macro
        FROM cm.cm_ref_provinces AS p LEFT JOIN LATERAL (SELECT region_code, macro_region_code FROM cm.cm_ref_province_region_map AS m
          WHERE m.province_code = p.province_code AND (m.valid_to IS NULL OR m.valid_to >= current_date) ORDER BY m.valid_from DESC LIMIT 1) AS rm ON true
        WHERE p.is_active ORDER BY p.province_name, p.province_code`, []));
      const wards = z.array(z.object({ province: s, code: s, name: s })).parse(await q.query(`SELECT province_code::text AS province, ward_code::text AS code,
          ward_name AS name FROM cm.cm_ref_wards WHERE is_active ORDER BY ward_name, ward_code`, []));
      return provinces.map((p) => ({ code: p.code, name: p.name, region: p.region ?? '', macro: p.macro ?? '',
        wards: wards.filter((w) => w.province === p.code).map((w) => ({ code: w.code, name: w.name })) }));
    });
  }

  async regions(actor: ModuleActor) {
    return this.rt.read(actor, P.referenceRead, async (_ctx, q) => {
      const regions = z.array(z.object({ code: s, name: s })).parse(await q.query(`SELECT region_code AS code, region_name AS name FROM cm.cm_ref_economic_regions
          WHERE is_active ORDER BY region_name`, []));
      const macros = z.array(z.object({ code: s })).parse(await q.query(`SELECT DISTINCT macro_region_code AS code FROM cm.cm_ref_province_region_map
          WHERE valid_to IS NULL OR valid_to >= current_date ORDER BY 1`, []));
      return { regions, macroRegions: macros.map((m) => ({ code: m.code, name: MACRO_REGION_NAMES[m.code] ?? m.code })) };
    });
  }
}
