import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/env.js';
import { describeDatabaseUrl } from '../../src/config/database.js';

function issuesOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies local development defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
      appOrigins: ['http://127.0.0.1:5173'],
      trustProxy: false,
      databaseUrl: undefined,
      logLevel: 'info',
    });
  });

  it('treats empty values (e.g. "PORT=") as unset', () => {
    expect(loadConfig({ PORT: '', HOST: '', DATABASE_URL: '' })).toMatchObject({ port: 3000, host: '127.0.0.1', databaseUrl: undefined });
  });

  it('requires APP_ORIGIN in production (no implicit default)', () => {
    expect(issuesOf({ NODE_ENV: 'production' })).toContain('APP_ORIGIN is required in production');
    expect(issuesOf({ NODE_ENV: 'production' })).toContain('PWNED_PASSWORDS_DIR is required in production');
    expect(issuesOf({ PWNED_PASSWORDS_FORMAT: 'binary' }).length).toBeGreaterThan(0);
  });

  it('parses a comma-separated origin list and rejects non-origins', () => {
    expect(loadConfig({ APP_ORIGIN: 'https://a.internal, https://b.internal:8443' }).appOrigins).toEqual(['https://a.internal', 'https://b.internal:8443']);
    expect(issuesOf({ APP_ORIGIN: 'https://a.internal/path' }).length).toBeGreaterThan(0);
    expect(issuesOf({ APP_ORIGIN: 'ftp://a.internal' }).length).toBeGreaterThan(0);
    expect(issuesOf({ APP_ORIGIN: 'not a url' }).length).toBeGreaterThan(0);
  });

  it('keeps trust proxy off unless explicitly configured, and rejects "true"', () => {
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: '10.8.0.1, 10.8.0.0/24' }).trustProxy).toEqual(['10.8.0.1', '10.8.0.0/24']);
    expect(issuesOf({ TRUST_PROXY: 'true' })).toContain('TRUST_PROXY=true is not allowed; use a hop count or explicit proxy addresses');
    expect(issuesOf({ TRUST_PROXY: '0' }).length).toBeGreaterThan(0);
  });

  it('validates PORT and DATABASE_URL', () => {
    expect(issuesOf({ PORT: '70000' })).toContain('PORT must be an integer between 1 and 65535');
    expect(issuesOf({ DATABASE_URL: 'mysql://x' })).toContain('DATABASE_URL must be a postgresql:// connection string');
  });

  it('never echoes configuration values in error messages', () => {
    const secretUrl = 'mysql://user:TopSecret@host/db';
    const issues = issuesOf({ DATABASE_URL: secretUrl, NODE_ENV: 'bogus' });
    expect(issues.join(' ')).not.toContain('TopSecret');
    expect(issues.join(' ')).not.toContain('bogus');
  });
});

describe('.env.example', () => {
  it('is accepted by loadConfig and contains only placeholders for credentials', () => {
    const example = parseEnv(readFileSync(resolve(import.meta.dirname, '../../../.env.example'), 'utf8'));
    const config = loadConfig(example);
    expect(config).toMatchObject({ host: '127.0.0.1', port: 3000, appOrigins: ['http://127.0.0.1:5173'], trustProxy: false });
    expect(example['DATABASE_URL']).toMatch(/<app_user>:<app_password>@/);
  });
});

describe('describeDatabaseUrl', () => {
  it('returns host, port and database without credentials', () => {
    const target = describeDatabaseUrl('postgresql://admin:pa%40ss@127.0.0.1:5433/talo_mos_v4_dev?sslmode=disable');
    expect(target).toEqual({ host: '127.0.0.1', port: '5433', database: 'talo_mos_v4_dev' });
    expect(JSON.stringify(target)).not.toContain('pa');
  });
});
