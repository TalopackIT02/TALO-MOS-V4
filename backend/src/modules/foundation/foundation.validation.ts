import { z } from 'zod';
import { FoundationError } from './foundation.errors.js';

// POST /api/foundation/modules body. Strict: module_id, timestamps, is_enabled and the actor cannot be supplied by the
// client — any unknown key is a 400. Limits follow fnd_modules (module_key VARCHAR(80) + CHECK D-01, module_name
// VARCHAR(150), module_type CHECK INTERNAL/EXTERNAL).

export const MODULE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
export const MODULE_TYPES = ['INTERNAL', 'EXTERNAL'] as const;

const registerModuleSchema = z.strictObject({
  moduleKey: z.string().max(80).regex(MODULE_KEY_PATTERN),
  moduleName: z.string().max(150).refine((value) => value.trim().length > 0),
  moduleType: z.enum(MODULE_TYPES),
  description: z.string().nullable().optional(),
});

export interface RegisterModuleInput {
  readonly moduleKey: string;
  readonly moduleName: string;
  readonly moduleType: (typeof MODULE_TYPES)[number];
  readonly description: string | null;
}

export function parseRegisterModule(body: unknown): RegisterModuleInput {
  const result = registerModuleSchema.safeParse(body);
  if (!result.success) {
    // Only known field names are echoed; unknown keys (client text) are reported as a fixed marker.
    const fields = [...new Set(result.error.issues.map((issue) => (issue.code === 'unrecognized_keys' ? 'UNKNOWN_FIELD' : String(issue.path[0] ?? ''))))];
    throw new FoundationError(400, 'VALIDATION_ERROR', { details: { fields: fields.filter((f) => f !== '').sort() } });
  }
  const { moduleKey, moduleName, moduleType, description } = result.data;
  return { moduleKey, moduleName, moduleType, description: description ?? null };
}
