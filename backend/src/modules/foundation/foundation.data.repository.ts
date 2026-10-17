import { z } from 'zod';
import type { PlannedContract } from './foundation.data.js';
import type { SqlExecutor } from './foundation.repository.js';

// FBE-04 — materialisation of B10 fnd_data_contracts / B11 fnd_data_fields / B12 fnd_data_access_rules inside the
// SUBMIT transaction, after B03–B06 (owner decision Q1). Bind parameters only; INSERT only (no UPDATE / DELETE).
//   B10 / B11 in MIC order. B12.version_action_id is resolved from the B06 rows of THIS version only (B06 → B05 with
//   version_id = the locked version): a Data Contract and its Version Action always belong to the same Version
//   (backend rule required by the DDL). An unresolved action or a count mismatch throws → the whole SUBMIT rolls back.
//   default_expression (B11) and is_enabled (B12) are never written (NULL / FALSE column defaults).

export const DATA_SQL = {
  insertContract: `
    INSERT INTO foundation.fnd_data_contracts
      (version_id, resource_key, data_owner_key, interface_kind, schema_name, table_name, schema_version, contract_spec, contract_hash)
    VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
    RETURNING data_contract_id::text AS data_contract_id`,
  insertField: `
    INSERT INTO foundation.fnd_data_fields
      (data_contract_id, field_name, field_type, is_required, is_primary_key, references_target, description)
    VALUES ($1::uuid, $2, $3, $4::boolean, $5::boolean, $6, $7)`,
  versionActions: `
    SELECT f.function_key, a.action_key, va.version_action_id::text AS version_action_id
      FROM foundation.fnd_version_actions AS va
      JOIN foundation.fnd_version_functions AS vf ON vf.version_function_id = va.version_function_id
      JOIN foundation.fnd_actions AS a ON a.action_id = va.action_id
      JOIN foundation.fnd_functions AS f ON f.function_id = a.function_id
     WHERE vf.version_id = $1::uuid`,
  insertAccessRule: `
    INSERT INTO foundation.fnd_data_access_rules (data_contract_id, version_action_id, data_operation, approval_mode, workflow_key)
    VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
} as const;

const contractIdRow = z.object({ data_contract_id: z.string() });
const versionActionRow = z.object({ function_key: z.string(), action_key: z.string(), version_action_id: z.string() });

const pairKey = (functionKey: string, actionKey: string) => JSON.stringify([functionKey, actionKey]);

export interface MaterializedData {
  readonly contracts: number;
  readonly fields: number;
  readonly accessRules: number;
}

export async function materializeData(tx: SqlExecutor, versionId: string, plan: readonly PlannedContract[]): Promise<MaterializedData> {
  // 1. B10 / B11, in MIC order.
  const contractIds: string[] = [];
  let fields = 0;
  for (const c of plan) {
    const rows = (await tx.query(DATA_SQL.insertContract, [
      versionId, c.resourceKey, c.dataOwnerKey, c.interfaceKind, c.schemaName, c.tableName, c.schemaVersion, JSON.stringify(c.contractSpec), c.contractHash,
    ])).map((r) => contractIdRow.parse(r));
    const [row] = rows;
    if (rows.length !== 1 || row === undefined) throw new Error(`data: expected exactly one data_contract, got ${rows.length}`);
    contractIds.push(row.data_contract_id);
    for (const f of c.fields) {
      await tx.execute(DATA_SQL.insertField, [row.data_contract_id, f.fieldName, f.fieldType, f.isRequired, f.isPrimaryKey, f.referencesTarget, f.description]);
      fields += 1;
    }
  }

  // 2. B12, resolved against the B06 rows of this version only.
  let accessRules = 0;
  if (plan.some((c) => c.access.length > 0)) {
    const versionActions = new Map<string, string>();
    for (const r of (await tx.query(DATA_SQL.versionActions, [versionId])).map((x) => versionActionRow.parse(x))) {
      versionActions.set(pairKey(r.function_key, r.action_key), r.version_action_id);
    }
    for (const [i, c] of plan.entries()) {
      const contractId = contractIds[i];
      if (contractId === undefined) throw new Error('data: contract not resolved');
      for (const a of c.access) {
        const versionActionId = versionActions.get(pairKey(a.functionKey, a.actionKey));
        if (versionActionId === undefined) throw new Error('data: version action not found in this version');
        await tx.execute(DATA_SQL.insertAccessRule, [contractId, versionActionId, a.dataOperation, a.approvalMode, a.workflowKey]);
        accessRules += 1;
      }
    }
  }
  return { contracts: plan.length, fields, accessRules };
}
