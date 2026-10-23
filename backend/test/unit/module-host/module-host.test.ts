import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { HOST_CAPABILITIES as SCRIPT_CAPABILITIES, parseDeployments, syncModules, validateManifest } from '../../../scripts/modules-sync.mjs';
import { hashPackage, walkPackage } from '../../../scripts/module-package.mjs';
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

  // DI-01 — multi-module Host: every installed package is checked, whatever their number. Problems of a package list:
  // invalid / duplicate module key, Host handshake failure (protocol / capability), manifest ≠ entry capability list.
  const MODULE_KEY = /^[A-Z][A-Z0-9_]{0,79}$/;
  function installedProblems(list: readonly InstalledModule[]): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const m of list) {
      const key = m.manifest.moduleKey;
      if (!MODULE_KEY.test(key)) problems.push(`${key}: invalid module key`);
      if (seen.has(key)) problems.push(`${key}: duplicate module key`);
      seen.add(key);
      for (const p of handshake(m)) problems.push(`${key}: ${p}`);
      if ([...m.manifest.requiredCapabilities].sort().join() !== [...m.entry.REQUIRED_CAPABILITIES].sort().join()) problems.push(`${key}: manifest / entry capabilities differ`);
    }
    return problems;
  }

  it('the checker itself detects an invalid key, a duplicate key, a protocol or capability mismatch', () => {
    const good: InstalledModule = { manifest: manifest('GOOD'), entry: entry(HOST_PROTOCOL, ['session']) };
    expect(installedProblems([good])).toEqual([]);
    expect(installedProblems([
      good, { manifest: manifest('GOOD'), entry: entry(HOST_PROTOCOL, ['session']) }, { manifest: manifest('bad-key'), entry: entry(HOST_PROTOCOL, ['session']) },
      { manifest: manifest('OLD', 'TALO-MODULE-HOST-0'), entry: entry('TALO-MODULE-HOST-0', ['session']) },
      { manifest: manifest('GREEDY', HOST_PROTOCOL, ['rawSql']), entry: entry(HOST_PROTOCOL, ['rawSql']) },
      { manifest: manifest('DRIFT', HOST_PROTOCOL, ['session']), entry: entry(HOST_PROTOCOL, ['session', 'logger']) },
    ])).toEqual([
      'GOOD: duplicate module key', 'bad-key: invalid module key', 'OLD: host protocol', 'GREEDY: capability rawSql', 'DRIFT: manifest / entry capabilities differ',
    ]);
  });

  it('every installed package (generated registry) passes the handshake and is mounted — no fixed package list', () => {
    expect(INSTALLED_MODULES.length).toBeGreaterThan(0);
    expect(installedProblems(INSTALLED_MODULES)).toEqual([]);
    expect(mountModules(INSTALLED_MODULES, deps, deps.logger)).toHaveLength(INSTALLED_MODULES.length);
  });

  // FMI-01: modules/ may also hold candidate packages (scanned, not deployed). The installed set is the deployment lock.
  it('every DEPLOYED package (module-deployments.json) is valid and installed: an invalid deployed package fails here', () => {
    const modulesDir = join(import.meta.dirname, '..', '..', '..', '..', 'modules');
    const lock = parseDeployments(JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'module-deployments.json'), 'utf8')));
    const deployed = [...lock.keys()].sort();
    for (const f of deployed) {
      expect([f, validateManifest(JSON.parse(readFileSync(join(modulesDir, f, 'module.json'), 'utf8')), f, join(modulesDir, f))]).toEqual([f, []]);
    }
    expect(INSTALLED_MODULES.map((m) => m.manifest.moduleKey).sort()).toEqual(deployed);
    expect(INSTALLED_MODULES.map((m) => `${m.manifest.moduleKey}@${m.manifest.packageVersion}`).sort()).toEqual(deployed.map((k) => `${k}@${lock.get(k)?.packageVersion}`));
  });

  it('SYSTEM_TEST and DATA_INSPECTOR are both recognised and pass the handshake (independent packages)', () => {
    for (const key of ['SYSTEM_TEST', 'DATA_INSPECTOR']) {
      const m = INSTALLED_MODULES.find((x) => x.manifest.moduleKey === key);
      expect([key, m === undefined ? 'missing' : handshake(m)]).toEqual([key, []]);
    }
  });
});

// FMI-01 T20 — runtime guard: a candidate copied into modules/ never replaces the deployed code through modules:sync
// (predev / prebuild / pretest / pretypecheck). Synthetic packages in a temporary folder; the real repository is only read.
describe('FMI-01 deployment lock (modules:sync runtime guard)', () => {
  const lockOf = (modules: string, keys: readonly string[]) => ({
    format: 'TALO-MODULE-DEPLOYMENT-1',
    modules: keys.map((k) => {
      const dir = join(modules, k);
      const manifest = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8'));
      return { moduleKey: k, packageVersion: manifest.packageVersion, packageHash: hashPackage(dir, walkPackage(dir)).hash };
    }),
  });
  const fresh = (name: string) => {
    const base = join(root, `fmi01-${name}`);
    const modules = join(base, 'modules');
    const out = join(base, 'backend', 'installed-modules');
    pkg(modules, 'LIVE_PKG');
    return { modules, out };
  };

  it('baseline risk reproduced: WITHOUT a lock (legacy) a candidate folder is installed by the sync', () => {
    const { modules, out } = fresh('legacy');
    pkg(modules, 'CANDIDATE_PKG');
    expect(syncModules({ target: 'backend', modulesDir: modules, outDir: out, log: () => undefined })).toEqual(['CANDIDATE_PKG', 'LIVE_PKG']);
  });

  it('WITH the lock: a new candidate folder is skipped (candidate only); the deployed package is installed unchanged', () => {
    const { modules, out } = fresh('candidate');
    const deployments = lockOf(modules, ['LIVE_PKG']);
    pkg(modules, 'CANDIDATE_PKG');
    pkg(modules, 'BROKEN_CANDIDATE', { hostProtocol: 'X' });
    const log: string[] = [];
    expect(syncModules({ target: 'backend', modulesDir: modules, outDir: out, deployments, log: (l) => log.push(l) })).toEqual(['LIVE_PKG']);
    expect(log.some((l) => l.includes('skip CANDIDATE_PKG: not in the deployment lock'))).toBe(true);
    expect(readFileSync(join(out, 'registry.ts'), 'utf8')).not.toContain('CANDIDATE');
  });

  it('a candidate copied OVER the deployed folder (new version or same version, other content) stops the sync before installed-modules is touched', () => {
    const { modules, out } = fresh('overwrite');
    const deployments = lockOf(modules, ['LIVE_PKG']);
    syncModules({ target: 'backend', modulesDir: modules, outDir: out, deployments, log: () => undefined });
    const installed = readFileSync(join(out, 'LIVE_PKG', 'backend', 'index.ts'), 'utf8');
    pkg(modules, 'LIVE_PKG', { packageVersion: '0.2.0' }, { 'backend/index.ts': 'export const CANDIDATE = true;\n' });
    expect(() => syncModules({ target: 'backend', modulesDir: modules, outDir: out, deployments, log: () => undefined })).toThrow(/packageVersion 0\.2\.0 ≠ deployed 0\.1\.0.*left unchanged|left unchanged.*0\.2\.0/);
    expect(readFileSync(join(out, 'LIVE_PKG', 'backend', 'index.ts'), 'utf8')).toBe(installed);
    pkg(modules, 'LIVE_PKG', {}, { 'backend/index.ts': 'export const CANDIDATE = true;\n' }); // same 0.1.0, other code
    expect(() => syncModules({ target: 'backend', modulesDir: modules, outDir: out, deployments, log: () => undefined })).toThrow(/content differs/);
    expect(readFileSync(join(out, 'LIVE_PKG', 'backend', 'index.ts'), 'utf8')).toBe(installed);
    expect(readFileSync(join(out, 'registry.ts'), 'utf8')).toContain('LIVE_PKG');
  });

  it('a deployed package folder that disappeared, or an invalid lock, stops the sync (fail closed, nothing removed)', () => {
    const { modules, out } = fresh('missing');
    const deployments = lockOf(modules, ['LIVE_PKG']);
    syncModules({ target: 'backend', modulesDir: modules, outDir: out, deployments, log: () => undefined });
    rmSync(join(modules, 'LIVE_PKG'), { recursive: true, force: true });
    expect(() => syncModules({ target: 'backend', modulesDir: modules, outDir: out, deployments, log: () => undefined })).toThrow(/LIVE_PKG: deployed package folder missing/);
    expect(existsSync(join(out, 'LIVE_PKG', 'backend', 'index.ts'))).toBe(true);
    for (const bad of [{}, { format: 'X', modules: [] }, { format: 'TALO-MODULE-DEPLOYMENT-1', modules: [{ moduleKey: 'x', packageVersion: '1', packageHash: 'y' }] }]) {
      expect(() => syncModules({ target: 'backend', modulesDir: modules, outDir: out, deployments: bad, log: () => undefined })).toThrow(/deployment lock/);
    }
    expect(existsSync(join(out, 'registry.ts'))).toBe(true);
  });

  it('the CLI refuses to sync without a lock file (exit 1) and leaves installed-modules unchanged', () => {
    const { modules, out } = fresh('cli');
    syncModules({ target: 'backend', modulesDir: modules, outDir: out, log: () => undefined });
    const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'modules-sync.mjs');
    expect(() => execFileSync(process.execPath, [script, 'backend', '--modules', modules, '--out', out, '--deployments', join(modules, 'none.json')], { stdio: 'pipe' })).toThrow();
    expect(readFileSync(join(out, 'registry.ts'), 'utf8')).toContain('LIVE_PKG');
  });

  it('the real repository: the lock pins exactly the installed SYSTEM_TEST 1.1.1 + DATA_INSPECTOR 0.1.0 and reproduces today\'s registry', () => {
    const repo = join(import.meta.dirname, '..', '..', '..', '..');
    const deployments = JSON.parse(readFileSync(join(repo, 'backend', 'module-deployments.json'), 'utf8'));
    const lock = parseDeployments(deployments);
    expect([...lock.entries()].map(([k, v]) => `${k}@${v.packageVersion}`).sort()).toEqual(['DATA_INSPECTOR@0.1.0', 'SYSTEM_TEST@1.1.1']);
    for (const [k, v] of lock) {
      const dir = join(repo, 'modules', k);
      expect([k, hashPackage(dir, walkPackage(dir)).hash]).toEqual([k, v.packageHash]);
    }
    for (const target of ['backend', 'frontend'] as const) {
      const out = join(root, `fmi01-real-${target}`, 'installed-modules');
      expect(syncModules({ target, modulesDir: join(repo, 'modules'), outDir: out, deployments, log: () => undefined })).toEqual(['DATA_INSPECTOR', 'SYSTEM_TEST']);
      expect(readFileSync(join(out, 'registry.ts'), 'utf8')).toBe(readFileSync(join(repo, target, 'src', 'installed-modules', 'registry.ts'), 'utf8'));
    }
  });
});
