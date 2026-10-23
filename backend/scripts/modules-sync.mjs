// MOD-TEST-02 — Host module loader, build-time part (Foundation side; no module is named here).
//   node backend/scripts/modules-sync.mjs <backend|frontend> [--modules <dir>] [--out <dir>] [--deployments <file>]
//   node backend/scripts/modules-sync.mjs hash <MODULE_KEY>        (read only: version + package hash for the lock)
// Discovers the packages in <repo>/modules/*/module.json, validates each manifest (package format, Host protocol, required
// capabilities, entries inside the package, screen routes), copies the valid package's backend + mic (backend target) or
// frontend (frontend target) files into <app>/src/installed-modules/<moduleKey>/ and writes a static registry.ts that
// imports the entries. An invalid package is reported and skipped; no package → empty registry (the Host still builds).
// No eval, no code execution, no network, no IAM / lifecycle action: loading is not approval (Foundation API decides).
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPackage, walkPackage } from './module-package.mjs';

export const PACKAGE_FORMAT = 'TALO-MODULE-PACKAGE-1';
export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';
// Capabilities this Host provides (backend/src/module-host/capabilities.ts).
export const HOST_CAPABILITIES = ['session', 'authorize', 'evaluate', 'lifecycle', 'readOnly', 'menuRoutes', 'inspectManifest', 'sqlstate', 'regressionResults', 'logger'];

const KEYS = ['packageFormat', 'moduleKey', 'name', 'packageVersion', 'contractVersion', 'hostProtocol', 'backendEntry', 'frontendEntry', 'micEntry', 'frontend', 'requiredCapabilities'];
const MODULE_KEY = /^[A-Z][A-Z0-9_]{0,79}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ENTRY = /^(backend|frontend|mic)\/[A-Za-z0-9_.-]+\.(ts|tsx)$/;
const SCREEN_KEY = /^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/;
const ROUTE = /^\/[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;
const COPY_EXT = /\.(ts|tsx|css|json)$/;
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

// Returns the list of problems of one manifest (empty = valid).
export function validateManifest(m, folder, packageDir) {
  const p = [];
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return ['module.json is not an object'];
  for (const k of Object.keys(m)) if (!KEYS.includes(k)) p.push(`unknown field ${k}`);
  if (m.packageFormat !== PACKAGE_FORMAT) p.push('packageFormat');
  if (!MODULE_KEY.test(String(m.moduleKey)) || m.moduleKey !== folder) p.push('moduleKey (K01, equal to the folder name)');
  if (!isText(m.name, 150)) p.push('name');
  if (!SEMVER.test(String(m.packageVersion))) p.push('packageVersion');
  if (!isText(m.contractVersion, 40)) p.push('contractVersion');
  if (m.hostProtocol !== HOST_PROTOCOL) p.push(`hostProtocol (this Host speaks ${HOST_PROTOCOL})`);
  for (const [field, dir] of [['backendEntry', 'backend'], ['frontendEntry', 'frontend'], ['micEntry', 'mic']]) {
    const e = m[field];
    if (typeof e !== 'string' || !ENTRY.test(e) || !e.startsWith(`${dir}/`)) p.push(field);
    else if (!existsSync(join(packageDir, e)) || !lstatSync(join(packageDir, e)).isFile()) p.push(`${field} file missing`);
  }
  if (!Array.isArray(m.requiredCapabilities) || m.requiredCapabilities.some((c) => typeof c !== 'string')) p.push('requiredCapabilities');
  else for (const c of m.requiredCapabilities) if (!HOST_CAPABILITIES.includes(c)) p.push(`capability not provided by this Host: ${c}`);
  const screens = m.frontend?.screens;
  if (typeof m.frontend !== 'object' || m.frontend === null || !Array.isArray(screens) || screens.length === 0) p.push('frontend.screens');
  else {
    for (const s of screens) {
      if (!SCREEN_KEY.test(String(s?.screenKey)) || !isText(s?.name, 150) || !isText(s?.description, 400)) p.push('screen screenKey / name / description');
      if (!Array.isArray(s?.tabs) || s.tabs.length === 0 || s.tabs.some((t) => !isText(t?.label, 100) || !ROUTE.test(String(t?.path)))) p.push('screen tabs (label, route path)');
    }
  }
  return p;
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const st = lstatSync(src);
    if (st.isSymbolicLink()) throw new Error(`symbolic link refused: ${src}`);
    if (st.isDirectory()) copyTree(src, join(to, name));
    else if (st.isFile() && COPY_EXT.test(name)) copyFileSync(src, join(to, name));
  }
}

const importPath = (entry, target) => `./${entry.replace(/\.(ts|tsx)$/, target === 'backend' ? '.js' : '')}`;

// FMI-01 — deployment lock (backend/module-deployments.json, committed): the packages the Host may load, pinned by
// moduleKey + packageVersion + packageHash (TALO-PACKAGE-HASH-1, module-package.mjs). `modules/` is also the drop zone of
// candidate packages (Foundation › Quét Module reads every folder); with a lock, a folder that is not listed is skipped
// (candidate only), and a listed package whose folder no longer matches its pinned version / hash stops the sync BEFORE
// installed-modules is touched — the previously installed code keeps running. Without a lock (tests / legacy) every
// valid package is loaded, as before.
export const DEPLOYMENT_FORMAT = 'TALO-MODULE-DEPLOYMENT-1';
const HEX64 = /^[0-9a-f]{64}$/;

export function parseDeployments(value) {
  if (typeof value !== 'object' || value === null || value.format !== DEPLOYMENT_FORMAT || !Array.isArray(value.modules)) {
    throw new Error(`deployment lock: format must be ${DEPLOYMENT_FORMAT} with a modules list`);
  }
  const map = new Map();
  for (const d of value.modules) {
    if (typeof d !== 'object' || d === null || !MODULE_KEY.test(String(d.moduleKey)) || !SEMVER.test(String(d.packageVersion)) || !HEX64.test(String(d.packageHash))) {
      throw new Error('deployment lock: each entry needs moduleKey (K01), packageVersion (SemVer) and packageHash (64 hex)');
    }
    if (map.has(d.moduleKey)) throw new Error(`deployment lock: ${d.moduleKey} listed twice`);
    map.set(d.moduleKey, { packageVersion: d.packageVersion, packageHash: d.packageHash });
  }
  return map;
}

export function syncModules({ target, modulesDir, outDir, deployments, log = (line) => process.stdout.write(`${line}\n`) }) {
  if (target !== 'backend' && target !== 'frontend') throw new Error('target must be backend or frontend');
  if (basename(outDir) !== 'installed-modules') throw new Error('refused: output directory must be named installed-modules');
  const lock = deployments === undefined ? null : parseDeployments(deployments);
  const plan = planSync({ modulesDir, lock, log });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const { folder, manifest } of plan) {
    const dir = join(modulesDir, folder);
    for (const sub of target === 'backend' ? ['backend', 'mic'] : ['frontend']) copyTree(join(dir, sub), join(outDir, folder, sub));
    log(`[modules] ${target}: ${manifest.moduleKey} ${manifest.packageVersion} (${manifest.contractVersion}, ${manifest.hostProtocol})`);
  }
  writeFileSync(join(outDir, 'registry.ts'), registrySource(target, plan.map((p) => p.manifest)));
  return plan.map((p) => p.manifest.moduleKey);
}

// Every check happens here, before installed-modules is removed; a lock mismatch throws (nothing is changed).
function planSync({ modulesDir, lock, log }) {
  const plan = [];
  const routes = new Set();
  const mismatches = [];
  const folders = existsSync(modulesDir) ? readdirSync(modulesDir).filter((f) => lstatSync(join(modulesDir, f)).isDirectory()).sort() : [];
  for (const folder of folders) {
    const dir = join(modulesDir, folder);
    const file = join(dir, 'module.json');
    if (!existsSync(file)) {
      log(`[modules] skip ${folder}: no module.json`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      log(`[modules] skip ${folder}: module.json is not valid JSON`);
      continue;
    }
    const problems = validateManifest(manifest, folder, dir);
    const paths = problems.length === 0 ? manifest.frontend.screens.flatMap((s) => s.tabs.map((t) => t.path)) : [];
    const clash = paths.filter((r, i) => routes.has(r) || paths.indexOf(r) !== i);
    if (clash.length > 0) problems.push(`route already used: ${clash.join(', ')}`);
    if (problems.length > 0) {
      log(`[modules] skip ${folder}: ${problems.join('; ')}`);
      continue;
    }
    if (lock !== null) {
      const pinned = lock.get(manifest.moduleKey);
      if (pinned === undefined) {
        log(`[modules] skip ${folder}: not in the deployment lock (candidate only — scan it in Foundation › Quét Module)`);
        continue;
      }
      if (manifest.packageVersion !== pinned.packageVersion) {
        mismatches.push(`${folder}: packageVersion ${manifest.packageVersion} ≠ deployed ${pinned.packageVersion}`);
        continue;
      }
      const walk = walkPackage(dir);
      const { hash } = hashPackage(dir, walk);
      if (hash !== pinned.packageHash) {
        mismatches.push(`${folder}: package content differs from the deployed ${pinned.packageVersion} (hash ${hash === null ? 'unavailable' : hash.slice(0, 12)})`);
        continue;
      }
    }
    for (const r of paths) routes.add(r);
    plan.push({ folder, manifest });
  }
  if (lock !== null) {
    for (const key of lock.keys()) if (!plan.some((p) => p.manifest.moduleKey === key) && !mismatches.some((m) => m.startsWith(`${key}:`))) mismatches.push(`${key}: deployed package folder missing or invalid`);
    if (mismatches.length > 0) {
      throw new Error(`deployment lock mismatch — installed-modules left unchanged: ${mismatches.join('; ')}`);
    }
  }
  return plan;
}

function registrySource(target, loaded) {
  const head = '// GENERATED by backend/scripts/modules-sync.mjs (MOD-TEST-02 Host loader) — do not edit, not committed.\n';
  const meta = (m) => JSON.stringify({ moduleKey: m.moduleKey, name: m.name, packageVersion: m.packageVersion, contractVersion: m.contractVersion,
    hostProtocol: m.hostProtocol, requiredCapabilities: m.requiredCapabilities, ...(target === 'frontend' ? { screens: m.frontend.screens } : {}) });
  const imports = loaded.map((m, i) => `import * as m${i} from '${importPath(target === 'backend' ? `${m.moduleKey}/${m.backendEntry}` : `${m.moduleKey}/${m.frontendEntry}`, target)}';\n`).join('');
  const type = target === 'backend' ? `import type { InstalledModule } from '../module-host/contract.js';\n` : `import type { InstalledModule } from '../routes/moduleScreens';\n`;
  const items = loaded.map((m, i) => `  { manifest: ${meta(m)}, entry: m${i} },\n`).join('');
  return `${head}${type}${imports}\nexport const INSTALLED_MODULES: readonly InstalledModule[] = [\n${items}];\n`;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [target, ...rest] = process.argv.slice(2);
  const arg = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const modulesDir = resolve(arg('--modules') ?? join(repo, 'modules'));
  try {
    if (target === 'hash') {
      // Read only: prints what a maintainer pins in module-deployments.json after the package has been accepted.
      const folder = rest[0] ?? '';
      if (!MODULE_KEY.test(folder)) throw new Error('usage: modules-sync.mjs hash <MODULE_KEY>');
      const dir = join(modulesDir, folder);
      const manifest = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8'));
      const walk = walkPackage(dir);
      const { hash, changed } = hashPackage(dir, walk);
      if (hash === null) throw new Error(`no stable hash for ${folder}: ${changed ? 'package changed while reading' : walk.issues.map((i) => `${i.code} ${i.path}`).join('; ')}`);
      process.stdout.write(`${JSON.stringify({ moduleKey: manifest.moduleKey, packageVersion: manifest.packageVersion, packageHash: hash })}\n`);
    } else {
      const app = target === 'frontend' ? 'frontend' : 'backend';
      const lockFile = resolve(arg('--deployments') ?? join(repo, 'backend', 'module-deployments.json'));
      if (!existsSync(lockFile)) throw new Error(`deployment lock ${basename(lockFile)} missing — refusing to sync (installed-modules left unchanged)`);
      const deployments = JSON.parse(readFileSync(lockFile, 'utf8'));
      syncModules({ target, modulesDir, outDir: resolve(arg('--out') ?? join(repo, app, 'src', 'installed-modules')), deployments });
    }
  } catch (error) {
    process.stderr.write(`[modules] ${error instanceof Error ? error.message : 'sync failed'}\n`);
    process.exit(1);
  }
}
