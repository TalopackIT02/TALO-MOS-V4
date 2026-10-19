import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { HOST_CAPABILITIES as SCRIPT_CAPABILITIES, syncModules } from '../../../scripts/modules-sync.mjs';
import { createLogger } from '../../../src/core/logging/logger.js';
import { INSTALLED_MODULES } from '../../../src/installed-modules/registry.js';
import { HOST_CAPABILITIES, HOST_PROTOCOL } from '../../../src/module-host/contract.js';
import type { InstalledModule } from '../../../src/module-host/contract.js';
import { handshake, mountModules } from '../../../src/module-host/loader.js';
import type { FoundationDb } from '../../../src/modules/foundation/foundation.repository.js';

// MOD-TEST-02 — Host module loader: build-time discovery / validation / copy / registry (scripts/modules-sync.mjs) and the
// runtime handshake + mount (src/module-host/loader.ts). The packages here are synthetic, in a temporary folder.

const root = mkdtempSync(join(tmpdir(), 'module-host-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function pkg(dir: string, key: string, overrides: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const base = join(dir, key);
  const all: Record<string, string> = {
    'backend/index.ts': `export const HOST_PROTOCOL = '${HOST_PROTOCOL}';\n`,
    'frontend/index.tsx': 'export const screens = {};\n',
    'mic/demo.mic.ts': 'export const mic = {};\n',
    ...files,
  };
  for (const [f, text] of Object.entries(all)) {
    mkdirSync(join(base, f, '..'), { recursive: true });
    writeFileSync(join(base, f), text);
  }
  const manifest = {
    packageFormat: 'TALO-MODULE-PACKAGE-1', moduleKey: key, name: `${key} demo`, packageVersion: '0.1.0', contractVersion: 'MIC-1.0',
    hostProtocol: HOST_PROTOCOL, backendEntry: 'backend/index.ts', frontendEntry: 'frontend/index.tsx', micEntry: 'mic/demo.mic.ts',
    frontend: { screens: [{ screenKey: 'demo.main', name: 'Demo', description: 'Demo screen', tabs: [{ label: 'Demo', path: `/${key.toLowerCase().replace(/_/g, '-')}` }] }] },
    requiredCapabilities: ['session', 'authorize', 'lifecycle'],
    ...overrides,
  };
  writeFileSync(join(base, 'module.json'), JSON.stringify(manifest));
}

describe('modules-sync (build-time loader)', () => {
  it('discovers a second minimal package by the same loader; skips every invalid package; copies only the target side', () => {
    const modules = join(root, 'modules');
    pkg(modules, 'DEMO_PKG');
    pkg(modules, 'BAD_PROTOCOL', { hostProtocol: 'TALO-MODULE-HOST-9' });
    pkg(modules, 'BAD_ENTRY', { backendEntry: '../escape.ts' });
    pkg(modules, 'MISSING_ENTRY', { frontendEntry: 'frontend/missing.tsx' });
    pkg(modules, 'BAD_CAPABILITY', { requiredCapabilities: ['session', 'superuser'] });
    pkg(modules, 'WRONG_FOLDER', { moduleKey: 'OTHER_KEY' });
    pkg(modules, 'ROUTE_CLASH', { frontend: { screens: [{ screenKey: 'x', name: 'X', description: 'X', tabs: [{ label: 'X', path: '/demo-pkg' }] }] } });
    pkg(modules, 'EXTRA_FIELD', { databaseUrl: 'postgresql://x' });
    mkdirSync(join(modules, 'NO_MANIFEST'), { recursive: true });
    const log: string[] = [];
    const out = join(root, 'backend', 'installed-modules');
    expect(syncModules({ target: 'backend', modulesDir: modules, outDir: out, log: (l) => log.push(l) })).toEqual(['DEMO_PKG']);
    expect(log.filter((l) => l.includes('skip')).map((l) => l.split(':')[0])).toEqual([
      '[modules] skip BAD_CAPABILITY', '[modules] skip BAD_ENTRY', '[modules] skip BAD_PROTOCOL', '[modules] skip EXTRA_FIELD', '[modules] skip MISSING_ENTRY',
      '[modules] skip NO_MANIFEST', '[modules] skip ROUTE_CLASH', '[modules] skip WRONG_FOLDER',
    ]);
    const registry = readFileSync(join(out, 'registry.ts'), 'utf8');
    expect(registry).toContain(`import * as m0 from './DEMO_PKG/backend/index.js';`);
    expect(registry).not.toMatch(/BAD_|MISSING_|WRONG_|ROUTE_CLASH|EXTRA_FIELD|postgresql/);
    expect(readFileSync(join(out, 'DEMO_PKG', 'mic', 'demo.mic.ts'), 'utf8')).toContain('mic');
    expect(() => readFileSync(join(out, 'DEMO_PKG', 'frontend', 'index.tsx'))).toThrow();
    const front = join(root, 'frontend', 'installed-modules');
    syncModules({ target: 'frontend', modulesDir: modules, outDir: front, log: () => undefined });
    expect(readFileSync(join(front, 'registry.ts'), 'utf8')).toContain(`import * as m0 from './DEMO_PKG/frontend/index';`);
    expect(readFileSync(join(front, 'registry.ts'), 'utf8')).toContain('"screens":[{"screenKey":"demo.main"');
  });

  it('no modules folder → empty registry (the Host still builds); refuses an output folder with another name', () => {
    const out = join(root, 'empty', 'installed-modules');
    expect(syncModules({ target: 'backend', modulesDir: join(root, 'does-not-exist'), outDir: out, log: () => undefined })).toEqual([]);
    expect(readFileSync(join(out, 'registry.ts'), 'utf8')).toContain('export const INSTALLED_MODULES: readonly InstalledModule[] = [\n];');
    expect(() => syncModules({ target: 'backend', modulesDir: root, outDir: join(root, 'src'), log: () => undefined })).toThrow(/installed-modules/);
  });

  it('the build-time and runtime capability lists are the same', () => {
    expect([...SCRIPT_CAPABILITIES]).toEqual([...HOST_CAPABILITIES]);
  });
});

describe('module-host loader (runtime handshake + mount)', () => {
  const NO_DB: FoundationDb = {
    query: async () => [], execute: async () => 0, transaction: async () => { throw new Error('unexpected'); },
  };
  const deps = {
    db: NO_DB, access: { loadAccessFacts: async () => ({ permissions: [], account: null, grants: [] }), insertAudit: async () => undefined },
    authService: { describeSession: async () => { throw new Error('unexpected'); } }, navigation: { menu: async () => [] },
    logger: createLogger({ level: 'error' }), secureCookie: false,
  };
  const entry = (protocol: string, caps: readonly string[]): InstalledModule['entry'] => ({
    HOST_PROTOCOL: protocol, REQUIRED_CAPABILITIES: caps, createModule: (host) => {
      const router = express.Router();
      router.get(`/${host.moduleKey.toLowerCase()}`, (_req, res) => { res.json({ moduleKey: host.moduleKey }); });
      return { router };
    },
  });
  const manifest = (moduleKey: string, hostProtocol = HOST_PROTOCOL, requiredCapabilities: readonly string[] = ['session']) => ({
    moduleKey, name: moduleKey, packageVersion: '1.0.0', contractVersion: 'MIC-1.0', hostProtocol, requiredCapabilities,
  });

  it('mounts a package only after protocol + capability handshake; a failing package is not mounted', () => {
    const good: InstalledModule = { manifest: manifest('GOOD'), entry: entry(HOST_PROTOCOL, ['session']) };
    const badProtocol: InstalledModule = { manifest: manifest('OLD', 'TALO-MODULE-HOST-0'), entry: entry('TALO-MODULE-HOST-0', []) };
    const badCapability: InstalledModule = { manifest: manifest('GREEDY', HOST_PROTOCOL, ['rawSql']), entry: entry(HOST_PROTOCOL, ['rawSql']) };
    expect(handshake(good)).toEqual([]);
    expect(handshake(badProtocol)).toEqual(['host protocol']);
    expect(handshake(badCapability)).toEqual(['capability rawSql']);
    expect(mountModules([good, badProtocol, badCapability], deps, deps.logger)).toHaveLength(1);
  });

  it('the installed SYSTEM_TEST package (copy of modules/SYSTEM_TEST) passes the handshake', () => {
    expect(INSTALLED_MODULES.map((m) => [m.manifest.moduleKey, handshake(m)])).toEqual([['SYSTEM_TEST', []]]);
  });
});
