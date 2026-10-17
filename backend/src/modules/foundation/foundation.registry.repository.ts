import { z } from 'zod';
import type { SqlExecutor } from './foundation.repository.js';
import type { PlannedFunction } from './foundation.registry.js';

// FBE-03 — materialisation of B03 fnd_functions / B04 fnd_actions / B05 fnd_version_functions / B06 fnd_version_actions
// inside the SUBMIT transaction (phase A). Bind parameters only; INSERT only (no UPDATE / DELETE); B07–B14 untouched.
//   Identity: B03 by (module_id of the locked version, function_key); B04 by (function_id, action_key).
//   INSERT … ON CONFLICT DO NOTHING, then SELECT the stable id: a row created by a concurrent SUBMIT is reused, never
//   duplicated (the second inserter waits for the first transaction and then sees its committed row).
//   Write order of B03 / B04: function_key, then action_key, in code-unit order, so that two concurrent SUBMITs
//   touching the same keys acquire them in the same order (deadlock avoidance). B05 / B06 follow the MIC order.
//   Same Module: Functions are looked up with the version's module_id. Action of the right Function: Actions are
//   created / looked up with the function_id just resolved. Any count mismatch throws → the whole SUBMIT rolls back.
// NOT_TESTED on PostgreSQL (FBE-03-DB-PREP / VERIFY): talo_app has no privilege on B03–B06 yet.

export const REGISTRY_SQL = {
  insertFunction: `
    INSERT INTO foundation.fnd_functions (module_id, function_key) VALUES ($1::uuid, $2)
    ON CONFLICT (module_id, function_key) DO NOTHING`,
  selectFunction: `
    SELECT f.function_id::text AS function_id FROM foundation.fnd_functions AS f
     WHERE f.module_id = $1::uuid AND f.function_key = $2`,
  insertAction: `
    INSERT INTO foundation.fnd_actions (function_id, action_key) VALUES ($1::uuid, $2)
    ON CONFLICT (function_id, action_key) DO NOTHING`,
  selectAction: `
    SELECT a.action_id::text AS action_id FROM foundation.fnd_actions AS a
     WHERE a.function_id = $1::uuid AND a.action_key = $2`,
  insertVersionFunction: `
    INSERT INTO foundation.fnd_version_functions (version_id, function_id, display_name, definition_hash)
    VALUES ($1::uuid, $2::uuid, $3, $4)
    RETURNING version_function_id::text AS version_function_id`,
  insertVersionAction: `
    INSERT INTO foundation.fnd_version_actions (version_function_id, action_id, description, action_spec, definition_hash)
    VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5)`,
} as const;

const functionIdRow = z.object({ function_id: z.string() });
const actionIdRow = z.object({ action_id: z.string() });
const versionFunctionIdRow = z.object({ version_function_id: z.string() });

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const pairKey = (functionKey: string, actionKey: string) => `${functionKey}\u0000${actionKey}`;

function exactlyOne<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) throw new Error(`registry: expected exactly one ${what}, got ${rows.length}`);
  return row;
}

export interface MaterializedRegistry {
  readonly functions: number;
  readonly actions: number;
}

export async function materializeRegistry(tx: SqlExecutor, moduleId: string, versionId: string, plan: readonly PlannedFunction[]): Promise<MaterializedRegistry> {
  // 1. B03 identities, in function_key order.
  const functionIds = new Map<string, string>();
  for (const f of [...plan].sort((a, b) => byCodeUnit(a.functionKey, b.functionKey))) {
    if (functionIds.has(f.functionKey)) throw new Error('registry: duplicate function_key in plan');
    await tx.execute(REGISTRY_SQL.insertFunction, [moduleId, f.functionKey]);
    const row = exactlyOne((await tx.query(REGISTRY_SQL.selectFunction, [moduleId, f.functionKey])).map((r) => functionIdRow.parse(r)), 'function');
    functionIds.set(f.functionKey, row.function_id);
  }

  // 2. B04 identities, in (function_key, action_key) order.
  const actionIds = new Map<string, string>();
  for (const f of [...plan].sort((a, b) => byCodeUnit(a.functionKey, b.functionKey))) {
    const functionId = functionIds.get(f.functionKey);
    if (functionId === undefined) throw new Error('registry: function not resolved');
    for (const a of [...f.actions].sort((x, y) => byCodeUnit(x.actionKey, y.actionKey))) {
      const key = pairKey(f.functionKey, a.actionKey);
      if (actionIds.has(key)) throw new Error('registry: duplicate action_key in plan');
      await tx.execute(REGISTRY_SQL.insertAction, [functionId, a.actionKey]);
      const row = exactlyOne((await tx.query(REGISTRY_SQL.selectAction, [functionId, a.actionKey])).map((r) => actionIdRow.parse(r)), 'action');
      actionIds.set(key, row.action_id);
    }
  }

  // 3. B05 / B06 declarations of this version, in MIC order.
  let actions = 0;
  for (const f of plan) {
    const functionId = functionIds.get(f.functionKey);
    if (functionId === undefined) throw new Error('registry: function not resolved');
    const vf = exactlyOne(
      (await tx.query(REGISTRY_SQL.insertVersionFunction, [versionId, functionId, f.displayName, f.definitionHash])).map((r) => versionFunctionIdRow.parse(r)),
      'version_function',
    );
    for (const a of f.actions) {
      const actionId = actionIds.get(pairKey(f.functionKey, a.actionKey));
      if (actionId === undefined) throw new Error('registry: action not resolved');
      await tx.execute(REGISTRY_SQL.insertVersionAction, [vf.version_function_id, actionId, a.description, JSON.stringify(a.actionSpec), a.definitionHash]);
      actions += 1;
    }
  }
  return { functions: plan.length, actions };
}
