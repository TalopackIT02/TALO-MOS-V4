import { z } from 'zod';

// Runtime configuration. Local development, test and the future VPN deployment share this code;
// they differ only in the environment values supplied by the deployment.

export type TrustProxySetting = false | number | string[];

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly appOrigins: readonly string[];
  readonly trustProxy: TrustProxySetting;
  readonly databaseUrl: string | undefined;
  // Directory of the offline Pwned Passwords dataset (outside Git, outside the database). Required in production.
  readonly pwnedPasswordsDir: string | undefined;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const DEV_DEFAULT_ORIGIN = 'http://127.0.0.1:5173';

// Treat empty strings (e.g. "PORT=" in .env) as "not set".
const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().optional());

const RawEnv = z.object({
  NODE_ENV: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['development', 'test', 'production']).default('development')),
  HOST: optionalString,
  PORT: optionalString,
  APP_ORIGIN: optionalString,
  TRUST_PROXY: optionalString,
  DATABASE_URL: optionalString,
  PWNED_PASSWORDS_DIR: optionalString,
  LOG_LEVEL: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['debug', 'info', 'warn', 'error']).default('info')),
});

function parsePort(value: string | undefined, issues: string[]): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push('PORT must be an integer between 1 and 65535');
    return 3000;
  }
  return port;
}

function parseOrigins(value: string | undefined, nodeEnv: AppConfig['nodeEnv'], issues: string[]): string[] {
  if (value === undefined) {
    if (nodeEnv === 'production') {
      issues.push('APP_ORIGIN is required in production');
      return [];
    }
    return [DEV_DEFAULT_ORIGIN];
  }
  const origins: string[] = [];
  for (const entry of value.split(',').map((item) => item.trim()).filter((item) => item !== '')) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      issues.push('APP_ORIGIN contains an invalid URL');
      continue;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== entry) {
      issues.push('APP_ORIGIN entries must be bare origins such as https://erp.example.internal');
      continue;
    }
    origins.push(url.origin);
  }
  if (origins.length === 0 && issues.length === 0) issues.push('APP_ORIGIN must contain at least one origin');
  return origins;
}

// Express "trust proxy": disabled unless explicitly configured. Accepts "false", a hop count, or a
// comma-separated list of proxy addresses/subnets. "true" is rejected because it trusts every X-Forwarded-* hop.
function parseTrustProxy(value: string | undefined, issues: string[]): TrustProxySetting {
  if (value === undefined || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') {
    issues.push('TRUST_PROXY=true is not allowed; use a hop count or explicit proxy addresses');
    return false;
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1) {
      issues.push('TRUST_PROXY hop count must be at least 1');
      return false;
    }
    return hops;
  }
  const entries = value.split(',').map((item) => item.trim()).filter((item) => item !== '');
  if (entries.length === 0) {
    issues.push('TRUST_PROXY is empty');
    return false;
  }
  return entries;
}

function parseDatabaseUrl(value: string | undefined, issues: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (!/^postgres(ql)?:\/\//.test(value)) {
    issues.push('DATABASE_URL must be a postgresql:// connection string');
    return undefined;
  }
  return value;
}

// Never includes environment values in error messages, only variable names.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = RawEnv.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.')} is invalid`));
  }
  const raw = parsed.data;
  const issues: string[] = [];
  const config: AppConfig = {
    nodeEnv: raw.NODE_ENV,
    host: raw.HOST ?? '127.0.0.1',
    port: parsePort(raw.PORT, issues),
    appOrigins: parseOrigins(raw.APP_ORIGIN, raw.NODE_ENV, issues),
    trustProxy: parseTrustProxy(raw.TRUST_PROXY, issues),
    databaseUrl: parseDatabaseUrl(raw.DATABASE_URL, issues),
    pwnedPasswordsDir: raw.PWNED_PASSWORDS_DIR,
    logLevel: raw.LOG_LEVEL,
  };
  if (config.nodeEnv === 'production' && config.pwnedPasswordsDir === undefined) issues.push('PWNED_PASSWORDS_DIR is required in production');
  if (issues.length > 0) throw new ConfigError(issues);
  return Object.freeze(config);
}
