import { canonicalDigest } from './foundation.json.js';
import type { Mic } from './foundation.mic.js';

// FBE-03 — Function / Action registry plan built from a VALIDATED MIC-1.0 (owner decisions I-1 … I-6).
//   B05.display_name    = mic02.name            B05.definition_hash = SHA-256 (RFC 8785) of the mic02 element
//   B06.description     = mic03.name            B06.action_spec     = the mic03 element
//   B06.definition_hash = SHA-256 (RFC 8785) of action_spec
// route_key / retired_at / replaces_function_id stay NULL and is_deprecated FALSE (column defaults; never written).
// The plan keeps the MIC order; the repository decides the write order.

export type MicFunction = Mic['mic02Functions'][number];
export type MicAction = Mic['mic03Actions'][number];

export interface PlannedAction {
  readonly actionKey: string;
  readonly description: string;
  readonly actionSpec: MicAction;
  readonly definitionHash: string;
}

export interface PlannedFunction {
  readonly functionKey: string;
  readonly displayName: string;
  readonly definitionHash: string;
  readonly actions: readonly PlannedAction[];
}

export function registryPlan(mic: Mic): PlannedFunction[] {
  return mic.mic02Functions.map((f) => ({
    functionKey: f.functionKey,
    displayName: f.name,
    definitionHash: canonicalDigest(f).sha256,
    actions: mic.mic03Actions
      .filter((a) => a.functionKey === f.functionKey)
      .map((a) => ({ actionKey: a.actionKey, description: a.name, actionSpec: a, definitionHash: canonicalDigest(a).sha256 })),
  }));
}
