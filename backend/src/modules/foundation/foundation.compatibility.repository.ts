import { z } from 'zod';
import { compareDefinitions, previousDefinitions } from './foundation.compatibility.js';
import type { CompatibilityEnvironment, CompatibilityPlan, CompatibilityResult, Definition } from './foundation.compatibility.js';
import type { SqlExecutor } from './foundation.repository.js';

// FBE-04 — one B13 fnd_compatibility_checks row per SUBMIT and its B14 fnd_compatibility_changes, inside the SUBMIT
// transaction after B10–B12 (owner decisions Q1, Q8–Q10). Bind parameters only; INSERT only (no UPDATE / DELETE).
//   from_version_id: the B02 row of mic09.fromVersion in the same module (CHANGE), NULL (INITIAL_REGISTRATION).
//   started_at = column default now(); completed_at = now() (same transaction time → N-13 holds);
//   database_fingerprint and resolution_status / details are never written (NULL / 'OPEN' / NULL).

export const COMPAT_SQL = {
  fromVersion: `
    SELECT v.version_id::text AS version_id, v.manifest_json FROM foundation.fnd_module_versions AS v
     WHERE v.module_id = $1::uuid AND v.module_version = $2`,
  insertCheck: `
    INSERT INTO foundation.fnd_compatibility_checks (module_id, from_version_id, to_version_id, environment, check_result, completed_at)
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, now())
    RETURNING check_id::text AS check_id`,
  // $6 / $7 are JSON text, or SQL NULL (no previous / proposed value) — never the JSON literal null.
  insertChange: `
    INSERT INTO foundation.fnd_compatibility_changes (check_id, change_area, object_key, change_type, severity, previous_value, proposed_value)
    VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
} as const;

const fromVersionRow = z.object({ version_id: z.string(), manifest_json: z.unknown() });
const checkIdRow = z.object({ check_id: z.string() });

const jsonOrNull = (value: unknown) => (value === null ? null : JSON.stringify(value));

export interface MaterializedCompatibility extends CompatibilityResult {
  readonly checkId: string;
}

export async function materializeCompatibility(
  tx: SqlExecutor, moduleId: string, versionId: string, environment: CompatibilityEnvironment, plan: CompatibilityPlan,
): Promise<MaterializedCompatibility> {
  let fromVersionId: string | null = null;
  let previous: Definition[] | null = null;
  if (plan.kind === 'CHANGE') {
    const rows = (await tx.query(COMPAT_SQL.fromVersion, [moduleId, plan.fromVersion])).map((r) => fromVersionRow.parse(r));
    const [row] = rows;
    if (rows.length !== 1 || row === undefined) throw new Error(`compatibility: expected exactly one from-version, got ${rows.length}`);
    fromVersionId = row.version_id;
    previous = previousDefinitions(row.manifest_json);
  }
  const result = compareDefinitions(previous, plan.proposed);
  const checks = (await tx.query(COMPAT_SQL.insertCheck, [moduleId, fromVersionId, versionId, environment, result.checkResult])).map((r) => checkIdRow.parse(r));
  const [check] = checks;
  if (checks.length !== 1 || check === undefined) throw new Error(`compatibility: expected exactly one check, got ${checks.length}`);
  for (const c of result.changes) {
    await tx.execute(COMPAT_SQL.insertChange, [
      check.check_id, c.changeArea, c.objectKey, c.changeType, c.severity, jsonOrNull(c.previousValue), jsonOrNull(c.proposedValue),
    ]);
  }
  return { ...result, checkId: check.check_id };
}
