import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

// MOD-TEST-01 — Full Regression results (TAB 3). The API never starts a process: Full Regression is run by the local CLI
// runner (backend/test/system-test/regression.cli.ts, fixed suite list, TEST database on localhost only), which writes
// one redacted JSON file. The API only reads that file from a fixed server-side location (never a path from a request)
// and returns it after schema validation. A missing file means "not run yet"; an invalid file is reported as such.

export const REGRESSION_FORMAT = 'TALO-SYSTEM-TEST-REGRESSION-1';

export function regressionResultsDir(): string {
  return join(tmpdir(), 'talo-mos-v4-system-test');
}

export function regressionResultsFile(): string {
  return join(regressionResultsDir(), 'regression-latest.json');
}

export const SUITE_STATUSES = ['PASS', 'FAIL', 'TIMEOUT', 'NOT_RUN'] as const;

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

export const regressionRunSchema = z.strictObject({
  format: z.literal(REGRESSION_FORMAT),
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  startedAt: z.string().max(40),
  finishedAt: z.string().max(40),
  target: z.strictObject({ database: z.string().max(80), host: z.string().max(120), nodeEnv: z.string().max(20) }),
  status: z.enum(['PASS', 'FAIL', 'ABORTED']),
  suites: z.array(regressionSuiteSchema).max(40),
});

export type RegressionSuite = z.infer<typeof regressionSuiteSchema>;
export type RegressionRun = z.infer<typeof regressionRunSchema>;

export type RegressionRead = { readonly state: 'NOT_RUN' } | { readonly state: 'INVALID' } | { readonly state: 'AVAILABLE'; readonly run: RegressionRun };

export async function readRegressionResults(file: string): Promise<RegressionRead> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') return { state: 'NOT_RUN' };
    return { state: 'INVALID' };
  }
  if (text.length > 512 * 1024) return { state: 'INVALID' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { state: 'INVALID' };
  }
  const parsed = regressionRunSchema.safeParse(json);
  return parsed.success ? { state: 'AVAILABLE', run: parsed.data } : { state: 'INVALID' };
}
