import { z } from 'zod';
import { SEMVER_PATTERN } from './foundation.versions.validation.js';

// FBE-02B — MIC-1.0 (owner-approved P-16 field specification, P-17 cross-validation, MIC-09 two-way rule and the 15
// validation error codes). No IAM permission is looked up. Every object is strict; required strings and provided
// optional strings are non-empty.
// FBE-04 (owner decisions Q2–Q6): MIC-06 extended in place (label stays MIC-1.0) with resourceKey, ownerKey, typed
// columns and access rules, so that B10–B12 can be materialised at SUBMIT; 7 DATA_* cross-validation codes.

export const MIC_STANDARD = 'MIC-1.0';
const K01 = /^[A-Z][A-Z0-9_]*$/;

export const MIC_ERROR_CODES = [
  'MIC_SCHEMA_INVALID',
  'IDENTITY_MODULE_KEY_MISMATCH',
  'IDENTITY_MODULE_VERSION_MISMATCH',
  'IDENTITY_MIC_STANDARD_MISMATCH',
  'FUNCTION_KEY_DUPLICATE',
  'ACTION_KEY_DUPLICATE',
  'ACTION_FUNCTION_UNKNOWN',
  'NAVIGATION_FUNCTION_UNKNOWN',
  'API_ACTION_UNKNOWN',
  'IAM_MAPPING_MISSING',
  'IAM_MAPPING_DUPLICATE',
  'IAM_MAPPING_UNKNOWN_ACTION',
  'IAM_MAPPING_K05_MISMATCH',
  'COMPATIBILITY_KIND_INVALID',
  'COMPATIBILITY_FROM_VERSION_INVALID',
  'DATA_RESOURCE_KEY_DUPLICATE',
  'DATA_FIELD_DUPLICATE',
  'DATA_DIRECT_DB_TARGET_MISSING',
  'DATA_REFERENCE_INVALID',
  'DATA_ACCESS_ACTION_UNKNOWN',
  'DATA_ACCESS_DUPLICATE',
  'DATA_WORKFLOW_REQUIRED',
] as const;
export type MicErrorCode = (typeof MIC_ERROR_CODES)[number];

const text = () => z.string().min(1);
const key = (max?: number) => (max === undefined ? z.string().min(1).regex(K01) : z.string().min(1).max(max).regex(K01));
const texts = () => z.array(text());
// Q5: K10 schema.table.column (backend check only; DB constraint N-14 stays PENDING).
const REFERENCE_TARGET = /^[a-z_][a-z0-9_]*[.][a-z_][a-z0-9_]*[.][a-z_][a-z0-9_]*$/;
const blank = (value: string | undefined) => value === undefined || value.trim() === '';

export const micSchema = z.strictObject({
  mic01Identity: z.strictObject({
    moduleKey: key(80),
    moduleName: text().max(150),
    moduleVersion: z.string().min(1).max(40).regex(SEMVER_PATTERN),
    micStandard: z.literal(MIC_STANDARD),
  }),
  mic02Functions: z.array(z.strictObject({
    functionKey: key(100),
    name: text().max(150), // FBE-03 (owner-approved P-16 amendment): = B05.display_name VARCHAR(150)
    description: text().optional(),
  })),
  mic03Actions: z.array(z.strictObject({
    functionKey: key(),
    actionKey: key(30),
    name: text(),
    nature: text(),
  })),
  mic04Navigation: z.array(z.strictObject({
    routePath: text().optional(),
    screenKey: text().optional(),
    menuLabel: text(),
    functionKey: key().optional(), // absent = parent menu (K08)
  })),
  mic05Api: z.array(z.strictObject({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    path: text(),
    functionKey: key(),
    actionKey: key(),
    errors: texts(),
  })),
  mic06DataResources: z.array(z.strictObject({
    resourceKey: key(120), // B10.resource_key
    ownerKey: key(80).optional(), // B10.data_owner_key; absent = moduleKey (Q4)
    interfaceKind: z.enum(['API', 'VIEW', 'EVENT', 'DIRECT_DB']),
    schema: text().max(100).optional(), // B10.schema_name VARCHAR(100)
    table: text().max(100).optional(), // B10.table_name VARCHAR(100)
    columns: z.array(z.strictObject({ // one B11 row each
      name: text().max(100),
      type: text().max(100),
      required: z.boolean().optional(),
      primaryKey: z.boolean().optional(),
      references: text().max(250).optional(),
      description: text().optional(),
    })),
    relations: texts(), // kept in contract_spec only
    access: z.array(z.strictObject({ // one B12 row each
      functionKey: key(),
      actionKey: key(),
      operation: z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
      approvalMode: z.enum(['REQUIRED', 'NOT_REQUIRED']).optional(), // absent = UNSPECIFIED
      workflowKey: text().max(120).optional(),
    })),
  })),
  mic07IamMapping: z.array(z.strictObject({
    functionKey: key(),
    actionKey: key(),
    moduleCode: text(),
    resourceCode: text(),
    operation: text(),
    minimumAssuranceLevel: z.number().int().min(1).refine(Number.isSafeInteger),
  })),
  mic08EventsAudit: z.strictObject({
    eventCodes: texts(),
    auditActionCodes: texts(),
  }),
  mic09Compatibility: z.strictObject({
    kind: z.enum(['INITIAL_REGISTRATION', 'CHANGE']),
    fromVersion: z.string().regex(SEMVER_PATTERN).optional(),
    changes: texts(),
  }),
  mic10Manifest: z.strictObject({
    manifestVersion: z.literal(MIC_STANDARD),
    hashAlgorithm: z.literal('SHA-256'),
    testEvidence: z.array(z.strictObject({
      name: text(),
      result: z.enum(['PASS', 'FAIL', 'NOT_TESTED']),
      reference: text(),
    })).min(1),
  }),
});

export type Mic = z.infer<typeof micSchema>;

export interface MicContext {
  readonly moduleKey: string; // B01.module_key
  readonly moduleVersion: string; // B02.module_version of the submitted version
  readonly contractVersion: string; // B02.contract_version
  readonly otherVersions: readonly { readonly moduleVersion: string; readonly status: string }[]; // same module, excluding this version
}

export type MicValidation = { readonly ok: true; readonly mic: Mic } | { readonly ok: false; readonly errors: readonly MicErrorCode[] };

const CHANGE_ELIGIBLE = new Set(['APPROVED', 'ACTIVE', 'RETIRED']);
const pair = (functionKey: string, actionKey: string) => `${functionKey}\u0000${actionKey}`;

export function validateMic(manifest: unknown, ctx: MicContext): MicValidation {
  const parsed = micSchema.safeParse(manifest);
  if (!parsed.success) return { ok: false, errors: ['MIC_SCHEMA_INVALID'] };
  const mic = parsed.data;
  const found = new Set<MicErrorCode>();

  // P-17 2–4: identity against B01 / B02.
  if (mic.mic01Identity.moduleKey !== ctx.moduleKey) found.add('IDENTITY_MODULE_KEY_MISMATCH');
  if (mic.mic01Identity.moduleVersion !== ctx.moduleVersion) found.add('IDENTITY_MODULE_VERSION_MISMATCH');
  if (mic.mic01Identity.micStandard !== ctx.contractVersion) found.add('IDENTITY_MIC_STANDARD_MISMATCH');

  // 5: function keys unique.
  const functions = new Set<string>();
  for (const f of mic.mic02Functions) {
    if (functions.has(f.functionKey)) found.add('FUNCTION_KEY_DUPLICATE');
    functions.add(f.functionKey);
  }

  // 6: (functionKey, actionKey) unique; function declared.
  const actions = new Set<string>();
  for (const a of mic.mic03Actions) {
    const p = pair(a.functionKey, a.actionKey);
    if (actions.has(p)) found.add('ACTION_KEY_DUPLICATE');
    actions.add(p);
    if (!functions.has(a.functionKey)) found.add('ACTION_FUNCTION_UNKNOWN');
  }

  // 7: navigation functionKey, when present, is declared (absent = parent menu).
  for (const n of mic.mic04Navigation) {
    if (n.functionKey !== undefined && !functions.has(n.functionKey)) found.add('NAVIGATION_FUNCTION_UNKNOWN');
  }

  // 8: every API references a declared action pair.
  for (const api of mic.mic05Api) {
    if (!actions.has(pair(api.functionKey, api.actionKey))) found.add('API_ACTION_UNKNOWN');
  }

  // 9–10: exactly one IAM mapping per action, none extra, K05 identity mapping.
  const mappings = new Map<string, number>();
  for (const m of mic.mic07IamMapping) {
    const p = pair(m.functionKey, m.actionKey);
    mappings.set(p, (mappings.get(p) ?? 0) + 1);
    if (!actions.has(p)) found.add('IAM_MAPPING_UNKNOWN_ACTION');
    if (m.moduleCode !== mic.mic01Identity.moduleKey || m.resourceCode !== m.functionKey || m.operation !== m.actionKey) {
      found.add('IAM_MAPPING_K05_MISMATCH');
    }
  }
  for (const p of actions) {
    const n = mappings.get(p) ?? 0;
    if (n === 0) found.add('IAM_MAPPING_MISSING');
    if (n > 1) found.add('IAM_MAPPING_DUPLICATE');
  }

  // 11: MIC-09 two-way rule against the version history of the module.
  const eligible = ctx.otherVersions.some((v) => CHANGE_ELIGIBLE.has(v.status));
  const compat = mic.mic09Compatibility;
  if (compat.kind === 'INITIAL_REGISTRATION') {
    if (eligible) found.add('COMPATIBILITY_KIND_INVALID');
    if (compat.fromVersion !== undefined) found.add('COMPATIBILITY_FROM_VERSION_INVALID');
  } else {
    if (!eligible) found.add('COMPATIBILITY_KIND_INVALID');
    if (compat.fromVersion === undefined || !ctx.otherVersions.some((v) => v.moduleVersion === compat.fromVersion)) {
      found.add('COMPATIBILITY_FROM_VERSION_INVALID');
    }
  }

  // FBE-04 (Q6): MIC-06 data resources — B10 / B11 / B12 keys, N-11, K10 (Q5), D-09, same-version actions.
  const resources = new Set<string>();
  for (const r of mic.mic06DataResources) {
    if (resources.has(r.resourceKey)) found.add('DATA_RESOURCE_KEY_DUPLICATE');
    resources.add(r.resourceKey);
    if (r.interfaceKind === 'DIRECT_DB' && (blank(r.schema) || blank(r.table))) found.add('DATA_DIRECT_DB_TARGET_MISSING');
    const fields = new Set<string>();
    for (const c of r.columns) {
      if (fields.has(c.name)) found.add('DATA_FIELD_DUPLICATE');
      fields.add(c.name);
      if (c.references !== undefined && !REFERENCE_TARGET.test(c.references)) found.add('DATA_REFERENCE_INVALID');
    }
    const rules = new Set<string>();
    for (const a of r.access) {
      if (!actions.has(pair(a.functionKey, a.actionKey))) found.add('DATA_ACCESS_ACTION_UNKNOWN');
      const rule = pair(pair(a.functionKey, a.actionKey), a.operation);
      if (rules.has(rule)) found.add('DATA_ACCESS_DUPLICATE');
      rules.add(rule);
      if (a.approvalMode === 'REQUIRED' && blank(a.workflowKey)) found.add('DATA_WORKFLOW_REQUIRED');
    }
  }

  // 12: testEvidence non-empty is enforced by the schema (FAIL / NOT_TESTED are accepted).
  if (found.size > 0) return { ok: false, errors: MIC_ERROR_CODES.filter((c) => found.has(c)) };
  return { ok: true, mic };
}
