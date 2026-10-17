import { canonicalDigest } from './foundation.json.js';
import type { Mic } from './foundation.mic.js';

// FBE-04 — Data Contract plan (B10 / B11 / B12) built from a VALIDATED MIC-1.0 (owner decisions Q3, Q4, Q7).
//   B10.resource_key   = mic06.resourceKey          B10.data_owner_key = mic06.ownerKey, else mic01.moduleKey
//   B10.schema_version = mic01.moduleVersion        B10.contract_spec  = the mic06 element
//   B10.contract_hash  = SHA-256 (RFC 8785) of contract_spec
//   B11: one row per mic06.columns element; default_expression stays NULL (not declared by the MIC).
//   B12: one row per mic06.access element; approval_mode = approvalMode, else UNSPECIFIED; is_enabled stays FALSE
//        (column default; enabling a rule belongs to the review phase, not to SUBMIT).
// The plan keeps the MIC order.

export type MicDataResource = Mic['mic06DataResources'][number];
export type ApprovalMode = 'REQUIRED' | 'NOT_REQUIRED' | 'UNSPECIFIED';

export interface PlannedField {
  readonly fieldName: string;
  readonly fieldType: string;
  readonly isRequired: boolean;
  readonly isPrimaryKey: boolean;
  readonly referencesTarget: string | null;
  readonly description: string | null;
}

export interface PlannedAccessRule {
  readonly functionKey: string;
  readonly actionKey: string;
  readonly dataOperation: MicDataResource['access'][number]['operation'];
  readonly approvalMode: ApprovalMode;
  readonly workflowKey: string | null;
}

export interface PlannedContract {
  readonly resourceKey: string;
  readonly dataOwnerKey: string;
  readonly interfaceKind: MicDataResource['interfaceKind'];
  readonly schemaName: string | null;
  readonly tableName: string | null;
  readonly schemaVersion: string;
  readonly contractSpec: MicDataResource;
  readonly contractHash: string;
  readonly fields: readonly PlannedField[];
  readonly access: readonly PlannedAccessRule[];
}

export function dataPlan(mic: Mic): PlannedContract[] {
  return mic.mic06DataResources.map((r) => ({
    resourceKey: r.resourceKey,
    dataOwnerKey: r.ownerKey ?? mic.mic01Identity.moduleKey,
    interfaceKind: r.interfaceKind,
    schemaName: r.schema ?? null,
    tableName: r.table ?? null,
    schemaVersion: mic.mic01Identity.moduleVersion,
    contractSpec: r,
    contractHash: canonicalDigest(r).sha256,
    fields: r.columns.map((c) => ({
      fieldName: c.name,
      fieldType: c.type,
      isRequired: c.required ?? false,
      isPrimaryKey: c.primaryKey ?? false,
      referencesTarget: c.references ?? null,
      description: c.description ?? null,
    })),
    access: r.access.map((a) => ({
      functionKey: a.functionKey,
      actionKey: a.actionKey,
      dataOperation: a.operation,
      approvalMode: a.approvalMode ?? 'UNSPECIFIED',
      workflowKey: a.workflowKey ?? null,
    })),
  }));
}
