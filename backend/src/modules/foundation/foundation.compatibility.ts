import { z } from 'zod';
import { canonicalDigest } from './foundation.json.js';
import type { Mic } from './foundation.mic.js';

// FBE-04 — minimal compatibility comparison for B13 / B14 (owner decisions Q8, Q9, Q10). Pure functions only.
//   Areas FUNCTION / ACTION / DATA, keyed FUNCTION:<functionKey>, ACTION:<functionKey>.<actionKey>, DATA:<resourceKey>.
//   A definition is the MIC element (mic02 / mic03 / mic06); its hash is the SHA-256 (RFC 8785) of that element — the
//   same value as B05 / B06 definition_hash and B10 contract_hash.
//   INITIAL_REGISTRATION: every definition ADDED / INFO; check_result PASS.
//   CHANGE (against the stored MIC of mic09.fromVersion): ADDED → INFO, MODIFIED / REMOVED → WARNING; any WARNING →
//   WARN, else PASS. BLOCKING / BLOCK are never produced; API and the other N-10 areas are not compared.
//   database_fingerprint stays NULL (N-07 PENDING).

export type CompatibilityEnvironment = 'DEV' | 'TEST' | 'PROD';

// Q8: NODE_ENV → B13.environment.
export function compatibilityEnvironment(nodeEnv: 'development' | 'test' | 'production'): CompatibilityEnvironment {
  if (nodeEnv === 'production') return 'PROD';
  if (nodeEnv === 'test') return 'TEST';
  return 'DEV';
}

export type ChangeArea = 'FUNCTION' | 'ACTION' | 'DATA';

export interface Definition {
  readonly area: ChangeArea;
  readonly objectKey: string;
  readonly value: unknown;
  readonly hash: string;
}

export interface PlannedChange {
  readonly changeArea: ChangeArea;
  readonly objectKey: string;
  readonly changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
  readonly severity: 'INFO' | 'WARNING';
  readonly previousValue: unknown;
  readonly proposedValue: unknown;
}

export interface CompatibilityResult {
  readonly checkResult: 'PASS' | 'WARN';
  readonly changes: readonly PlannedChange[];
}

export type CompatibilityPlan =
  | { readonly kind: 'INITIAL_REGISTRATION'; readonly proposed: readonly Definition[] }
  | { readonly kind: 'CHANGE'; readonly fromVersion: string; readonly proposed: readonly Definition[] };

export class CompatibilitySourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompatibilitySourceError';
  }
}

const AREA_ORDER: readonly ChangeArea[] = ['FUNCTION', 'ACTION', 'DATA'];
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function definition(area: ChangeArea, objectKey: string, value: unknown): Definition {
  return { area, objectKey: `${area}:${objectKey}`, value, hash: canonicalDigest(value).sha256 };
}

interface Sections {
  readonly functions: readonly { readonly functionKey: string }[];
  readonly actions: readonly { readonly functionKey: string; readonly actionKey: string }[];
  readonly data: readonly { readonly resourceKey: string }[];
}

function definitionsOf(sections: Sections): Definition[] {
  return [
    ...sections.functions.map((f) => definition('FUNCTION', f.functionKey, f)),
    ...sections.actions.map((a) => definition('ACTION', `${a.functionKey}.${a.actionKey}`, a)),
    ...sections.data.map((d) => definition('DATA', d.resourceKey, d)),
  ];
}

export function proposedDefinitions(mic: Mic): Definition[] {
  return definitionsOf({ functions: mic.mic02Functions, actions: mic.mic03Actions, data: mic.mic06DataResources });
}

// The stored MIC of the from-version. Only the compared sections are read; anything else is ignored.
const storedSections = z.object({
  mic02Functions: z.array(z.looseObject({ functionKey: z.string() })),
  mic03Actions: z.array(z.looseObject({ functionKey: z.string(), actionKey: z.string() })),
  mic06DataResources: z.array(z.looseObject({ resourceKey: z.string() })),
});

// Fails closed: a from-version whose stored MIC has no comparable sections cannot be compared (SUBMIT rolls back).
export function previousDefinitions(manifest: unknown): Definition[] {
  const parsed = storedSections.safeParse(manifest);
  if (!parsed.success) throw new CompatibilitySourceError('from-version manifest has no comparable MIC sections');
  return definitionsOf({ functions: parsed.data.mic02Functions, actions: parsed.data.mic03Actions, data: parsed.data.mic06DataResources });
}

function index(definitions: readonly Definition[]): Map<string, Definition> {
  const map = new Map<string, Definition>();
  for (const d of definitions) {
    if (map.has(d.objectKey)) throw new CompatibilitySourceError(`duplicate definition ${d.area}`);
    map.set(d.objectKey, d);
  }
  return map;
}

// previous = null: INITIAL_REGISTRATION (no from-version).
export function compareDefinitions(previous: readonly Definition[] | null, proposed: readonly Definition[]): CompatibilityResult {
  const before = index(previous ?? []);
  const after = index(proposed);
  const changes: PlannedChange[] = [];
  for (const area of AREA_ORDER) {
    const keys = new Set<string>();
    for (const d of [...before.values(), ...after.values()]) if (d.area === area) keys.add(d.objectKey);
    for (const objectKey of [...keys].sort(byCodeUnit)) {
      const p = before.get(objectKey);
      const n = after.get(objectKey);
      if (p === undefined && n !== undefined) {
        changes.push({ changeArea: area, objectKey, changeType: 'ADDED', severity: 'INFO', previousValue: null, proposedValue: n.value });
      } else if (p !== undefined && n === undefined) {
        changes.push({ changeArea: area, objectKey, changeType: 'REMOVED', severity: 'WARNING', previousValue: p.value, proposedValue: null });
      } else if (p !== undefined && n !== undefined && p.hash !== n.hash) {
        changes.push({ changeArea: area, objectKey, changeType: 'MODIFIED', severity: 'WARNING', previousValue: p.value, proposedValue: n.value });
      }
    }
  }
  return { checkResult: changes.some((c) => c.severity === 'WARNING') ? 'WARN' : 'PASS', changes };
}
