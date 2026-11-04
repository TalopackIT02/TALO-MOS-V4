import { createHash } from 'node:crypto';
import { z } from 'zod';

// MOD-TEST-01 — Full Regression results (TAB 3). The API never starts a process: Full Regression is run by the local CLI
// runner of the Host (backend/test/system-test/regression.cli.ts --module SYSTEM_CONTROLLER_CENTER, fixed suite list,
// localhost database only), which writes one redacted JSON file in this format. MOD-TEST-02: the file location belongs to
// the Host; the module receives its text through the `regressionResults` capability (never a path from a request) and
// validates it here. A missing file means "not run yet"; an invalid file is reported as such.
// SCC 0.1.3 — format 2 adds WHERE the run happened (environment TEST / CLONE, database host:port) and WHAT was tested
// (source commit, working-tree state, deployment lock). Format 1 is still read (artifacts written before 0.1.3).

export const REGRESSION_FORMAT = 'TALO-SYSTEM-CONTROLLER-CENTER-REGRESSION-1';
export const REGRESSION_FORMAT_V2 = 'TALO-SYSTEM-CONTROLLER-CENTER-REGRESSION-2';

export const SUITE_STATUSES = ['PASS', 'FAIL', 'TIMEOUT', 'NOT_RUN'] as const;
export const REGRESSION_ENVIRONMENTS = ['TEST', 'CLONE'] as const;

export const regressionSuiteSchema = z.strictObject({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(60),
  label: z.string().min(1).max(200),
  command: z.string().min(1).max(300), // fixed display text of the runner's command (no secrets, no request data)
  status: z.enum(SUITE_STATUSES),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().min(0),
  tests: z.strictObject({ passed: z.number().int().min(0), failed: z.number().int().min(0), skipped: z.number().int().min(0) }).nullable(),
  summary: z.array(z.string().max(400)).max(40),
});

const common = {
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  startedAt: z.string().max(40),
  finishedAt: z.string().max(40),
  status: z.enum(['PASS', 'FAIL', 'ABORTED']),
  suites: z.array(regressionSuiteSchema).max(40),
};

export const regressionRunSchema = z.strictObject({
  format: z.literal(REGRESSION_FORMAT),
  target: z.strictObject({ database: z.string().max(80), host: z.string().max(120), nodeEnv: z.string().max(20) }),
  ...common,
});

export const regressionRunSchemaV2 = z.strictObject({
  format: z.literal(REGRESSION_FORMAT_V2),
  environment: z.enum(REGRESSION_ENVIRONMENTS),
  target: z.strictObject({ database: z.string().max(80), host: z.string().max(120), port: z.string().regex(/^[0-9]{1,5}$/), nodeEnv: z.string().max(20) }),
  source: z.strictObject({
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    dirty: z.boolean(), // the working tree had uncommitted changes (the candidate under test)
    lock: z.array(z.strictObject({ moduleKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(80), packageVersion: z.string().max(40), packageHash: z.string().regex(/^[0-9a-f]{64}$/) })).max(100),
  }),
  ...common,
});

export type RegressionSuite = z.infer<typeof regressionSuiteSchema>;
export type RegressionRunV1 = z.infer<typeof regressionRunSchema>;
export type RegressionRunV2 = z.infer<typeof regressionRunSchemaV2>;
export type RegressionRun = RegressionRunV1 | RegressionRunV2;

// sha256 = digest of the artifact text as read (lets the reader compare it with the runner's checksum file).
export type RegressionRead = { readonly state: 'NOT_RUN' } | { readonly state: 'INVALID' } | { readonly state: 'AVAILABLE'; readonly run: RegressionRun; readonly sha256: string };

// text = null: no result written yet.
export function parseRegressionResults(text: string | null): RegressionRead {
  if (text === null) return { state: 'NOT_RUN' };
  if (text.length > 512 * 1024) return { state: 'INVALID' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { state: 'INVALID' };
  }
  const v2 = regressionRunSchemaV2.safeParse(json);
  const parsed = v2.success ? v2 : regressionRunSchema.safeParse(json);
  return parsed.success ? { state: 'AVAILABLE', run: parsed.data, sha256: createHash('sha256').update(text, 'utf8').digest('hex') } : { state: 'INVALID' };
}

// Environment of an artifact as far as it can be known: format 1 carries none (UNKNOWN).
export const environmentOf = (run: RegressionRun): 'TEST' | 'CLONE' | 'UNKNOWN' => ('environment' in run ? run.environment : 'UNKNOWN');
