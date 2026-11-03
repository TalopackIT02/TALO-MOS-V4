import { describe, expect, it } from 'vitest';
import { ConfigError, MODULE_READER_ROLE, loadConfig } from '../../../src/config/env.js';

// MODULE_HOST_READONLY_SECURITY_FIX — configuration of the readOnly executor. The URL is optional (absent → readOnly fails
// closed), but when present it must be the reader role on the SAME server / database as DATABASE_URL. Values never appear
// in error messages.

const API = 'postgresql://talo_app:secret-a@127.0.0.1:5433/talo_mos_v4_test';
const reader = (user: string, host = '127.0.0.1', port = '5433', db = 'talo_mos_v4_test') => `postgresql://${user}:secret-r@${host}:${port}/${db}`;
const issues = (env: Record<string, string>) => {
  try { loadConfig({ NODE_ENV: 'test', DATABASE_URL: API, ...env }); return []; } catch (e) { return e instanceof ConfigError ? [...e.issues] : ['OTHER']; }
};

describe('MODULE_READER_DATABASE_URL', () => {
  it('absent → undefined (the Host then refuses module reads, 503)', () => {
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: API }).moduleReaderDatabaseUrl).toBeUndefined();
  });
  it('accepted only as role talo_module_reader on the same server and database', () => {
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: API, MODULE_READER_DATABASE_URL: reader(MODULE_READER_ROLE) }).moduleReaderDatabaseUrl).toBe(reader(MODULE_READER_ROLE));
    expect(issues({ MODULE_READER_DATABASE_URL: reader('talo_app') })).toEqual(['MODULE_READER_DATABASE_URL must use role talo_module_reader']);
    expect(issues({ MODULE_READER_DATABASE_URL: reader(MODULE_READER_ROLE, '10.0.0.9') })).toEqual(['MODULE_READER_DATABASE_URL must target the same server and database as DATABASE_URL']);
    expect(issues({ MODULE_READER_DATABASE_URL: reader(MODULE_READER_ROLE, '127.0.0.1', '5433', 'talo_mos_v4_dev') })).toEqual(['MODULE_READER_DATABASE_URL must target the same server and database as DATABASE_URL']);
    expect(issues({ MODULE_READER_DATABASE_URL: 'mysql://talo_module_reader:x@h/db' })).toEqual(['MODULE_READER_DATABASE_URL must be a postgresql:// connection string']);
  });
  it('requires DATABASE_URL and never echoes secrets', () => {
    let msg = '';
    try { loadConfig({ NODE_ENV: 'test', MODULE_READER_DATABASE_URL: reader('talo_app') }); } catch (e) { msg = e instanceof Error ? e.message : ''; }
    expect(msg).toContain('MODULE_READER_DATABASE_URL');
    expect(msg).not.toContain('secret-r');
  });
});
