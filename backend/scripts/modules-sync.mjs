// MOD-TEST-02 — Host module loader, build-time part (Foundation side; no module is named here).
//   node backend/scripts/modules-sync.mjs <backend|frontend> [--modules <dir>] [--out <dir>] [--deployments <file>]
//   node backend/scripts/modules-sync.mjs hash <MODULE_KEY>        (read only: version + package hash for the lock)
//   node backend/scripts/modules-sync.mjs adopt <MODULE_KEY> --from <dir>  (store the release already pinned in the lock)
// FMI-02/03: the CLI builds installed-modules from backend/module-releases/<KEY>/<version>/ (the immutable release store,
// one release per lock entry, hash verified) — never from modules/, which only holds candidates for Foundation › Quét
// Module. The discovery described below is kept for the Host tests (syncModules without releasesDir).
// Discovers the packages in <repo>/modules/*/module.json, validates each manifest (package format, Host protocol, required
// capabilities, entries inside the package, screen routes), copies the valid package's backend + mic (backend target) or
// frontend (frontend target) files into <app>/src/installed-modules/<moduleKey>/ and writes a static registry.ts that
// imports the entries. An invalid package is reported and skipped; no package → empty registry (the Host still builds).
// No eval, no code execution, no network, no IAM / lifecycle action: loading is not approval (Foundation API decides).
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

// FMI-02/03 — installed release store (backend/module-releases/<MODULE_KEY>/<packageVersion>/): the only source of the
// Host build when `releasesDir` is given. Each release is an immutable copy of an accepted package (written once by
// writeRelease, never overwritten); `modules/` stays the candidate drop zone and is NOT read by the sync at all.
export const releaseDir = (releasesDir, moduleKey, packageVersion) => join(releasesDir, moduleKey, packageVersion);

export function syncModules({ target, modulesDir, releasesDir, outDir, deployments, log = (line) => process.stdout.write(`${line}\n`) }) {
  if (target !== 'backend' && target !== 'frontend') throw new Error('target must be backend or frontend');
  if (basename(outDir) !== 'installed-modules') throw new Error('refused: output directory must be named installed-modules');
  const lock = deployments === undefined ? null : parseDeployments(deployments);
  if (releasesDir !== undefined && lock === null) throw new Error('refused: a release store needs a deployment lock');
  const plan = releasesDir !== undefined ? planReleases({ releasesDir, lock }) : planSync({ modulesDir, lock, log });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const { dir, folder, manifest } of plan) {
    for (const sub of target === 'backend' ? ['backend', 'mic'] : ['frontend']) copyTree(join(dir, sub), join(outDir, folder, sub));
    log(`[modules] ${target}: ${manifest.moduleKey} ${manifest.packageVersion} (${manifest.contractVersion}, ${manifest.hostProtocol})`);
  }
  writeFileSync(join(outDir, 'registry.ts'), registrySource(target, plan));
  return plan.map((p) => p.manifest.moduleKey);
}

// Every locked release must exist, be valid, carry the pinned version and hash, and not share a route — otherwise
// nothing is changed (throws before installed-modules is touched).
function planReleases({ releasesDir, lock }) {
  const plan = [];
  const routes = new Set();
  const problems = [];
  for (const [moduleKey, pinned] of [...lock.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const dir = releaseDir(releasesDir, moduleKey, pinned.packageVersion);
    const checked = checkRelease(dir, moduleKey, pinned);
    if (checked.problem !== null) {
      problems.push(`${moduleKey} ${pinned.packageVersion}: ${checked.problem}`);
      continue;
    }
    const paths = checked.manifest.frontend.screens.flatMap((s) => s.tabs.map((t) => t.path));
    const clash = paths.filter((r, i) => routes.has(r) || paths.indexOf(r) !== i);
    if (clash.length > 0) {
      problems.push(`${moduleKey}: route already used: ${clash.join(', ')}`);
      continue;
    }
    for (const r of paths) routes.add(r);
    plan.push({ dir, folder: moduleKey, manifest: checked.manifest, packageHash: pinned.packageHash });
  }
  if (problems.length > 0) throw new Error(`deployment lock mismatch — installed-modules left unchanged: ${problems.join('; ')}`);
  return plan;
}

// { manifest, problem }: problem === null when the release folder is a valid package of exactly the pinned version + hash.
export function checkRelease(dir, moduleKey, pinned) {
  if (!existsSync(dir) || !lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) return { manifest: null, problem: 'release folder missing' };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8'));
  } catch {
    return { manifest: null, problem: 'module.json missing or not JSON' };
  }
  const invalid = validateManifest(manifest, moduleKey, dir);
  if (invalid.length > 0) return { manifest: null, problem: invalid.join('; ') };
  if (manifest.packageVersion !== pinned.packageVersion) return { manifest: null, problem: `packageVersion ${manifest.packageVersion} ≠ ${pinned.packageVersion}` };
  const { hash } = hashPackage(dir, walkPackage(dir));
  if (hash !== pinned.packageHash) return { manifest: null, problem: `package hash ${hash === null ? 'unavailable' : hash.slice(0, 12)} ≠ pinned ${pinned.packageHash.slice(0, 12)}` };
  return { manifest, problem: null };
}

// Writes an accepted package into the store: exact bytes of every package file (walkPackage list) into a temporary
// sibling folder, hash verified, then renamed into place. An existing release is never overwritten: same hash → kept
// (idempotent), different hash → refused. Returns { dir, created }.
export function writeRelease({ releasesDir, moduleKey, packageVersion, sourceDir, expectedHash }) {
  if (!MODULE_KEY.test(String(moduleKey)) || !SEMVER.test(String(packageVersion)) || !HEX64.test(String(expectedHash))) throw new Error('release: invalid key / version / hash');
  const dir = releaseDir(releasesDir, moduleKey, packageVersion);
  const walk = walkPackage(sourceDir);
  const source = hashPackage(sourceDir, walk);
  if (source.hash !== expectedHash) throw new Error(`release source hash ${source.hash === null ? 'unavailable' : source.hash.slice(0, 12)} ≠ expected ${expectedHash.slice(0, 12)}`);
  if (existsSync(dir)) {
    const { hash } = hashPackage(dir, walkPackage(dir));
    if (hash !== expectedHash) throw new Error(`release ${moduleKey} ${packageVersion} already exists with another content (immutable)`);
    return { dir, created: false };
  }
  copyPackage(sourceDir, dir, expectedHash, walk);
  return { dir, created: true };
}

// Copies the files of a package (walkPackage list, exact bytes) to `dest` (must not exist) through a temporary sibling
// folder; the copy must hash to `expectedHash`, otherwise nothing is left behind.
export function copyPackage(sourceDir, dest, expectedHash, walk = walkPackage(sourceDir)) {
  if (existsSync(dest)) throw new Error('copy: destination exists');
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  try {
    for (const f of walk.files) {
      const to = join(tmp, ...f.path.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(sourceDir, ...f.path.split('/')), to);
    }
    const copied = hashPackage(tmp, walkPackage(tmp));
    if (copied.hash !== expectedHash) throw new Error('copy hash differs from the source');
    renameSync(tmp, dest);
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  return dest;
}

// The lock as written by the installer: sorted, one entry per module, written to a temporary file then renamed.
export function writeDeployments(file, entries) {
  const modules = [...entries].sort((a, b) => (a.moduleKey < b.moduleKey ? -1 : 1))
    .map((e) => ({ moduleKey: e.moduleKey, packageVersion: e.packageVersion, packageHash: e.packageHash }));
  const value = { format: DEPLOYMENT_FORMAT, modules };
  parseDeployments(value);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
  return value;
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
    let packageHash;
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
      packageHash = hash;
    } else packageHash = hashPackage(dir, walkPackage(dir)).hash;
    for (const r of paths) routes.add(r);
    plan.push({ dir, folder, manifest, packageHash });
  }
  if (lock !== null) {
    for (const key of lock.keys()) if (!plan.some((p) => p.manifest.moduleKey === key) && !mismatches.some((m) => m.startsWith(`${key}:`))) mismatches.push(`${key}: deployed package folder missing or invalid`);
    if (mismatches.length > 0) {
      throw new Error(`deployment lock mismatch — installed-modules left unchanged: ${mismatches.join('; ')}`);
    }
  }
  return plan;
}

// FMI-02/03: packageHash (TALO-PACKAGE-HASH-1 of the copied source) identifies the release the Host really runs.
function registrySource(target, plan) {
  const loaded = plan.map((p) => p.manifest);
  const head = '// GENERATED by backend/scripts/modules-sync.mjs (MOD-TEST-02 Host loader) — do not edit, not committed.\n';
  const meta = (m, i) => JSON.stringify({ moduleKey: m.moduleKey, name: m.name, packageVersion: m.packageVersion, packageHash: plan[i]?.packageHash ?? null,
    contractVersion: m.contractVersion, hostProtocol: m.hostProtocol, requiredCapabilities: m.requiredCapabilities, ...(target === 'frontend' ? { screens: m.frontend.screens } : {}) });
  const imports = loaded.map((m, i) => `import * as m${i} from '${importPath(target === 'backend' ? `${m.moduleKey}/${m.backendEntry}` : `${m.moduleKey}/${m.frontendEntry}`, target)}';\n`).join('');
  const type = target === 'backend' ? `import type { InstalledModule } from '../module-host/contract.js';\n` : `import type { InstalledModule } from '../routes/moduleScreens';\n`;
  const items = loaded.map((m, i) => `  { manifest: ${meta(m, i)}, entry: m${i} },\n`).join('');
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
  const releasesDir = resolve(arg('--releases') ?? join(repo, 'backend', 'module-releases'));
  const lockFile = resolve(arg('--deployments') ?? join(repo, 'backend', 'module-deployments.json'));
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
    } else if (target === 'adopt') {
      // One-time migration (FMI-02/03): copies a package into the release store ONLY when its hash is the one already
      // pinned in the lock — it can store the release that runs today, never bless a new candidate.
      const key = rest[0] ?? '';
      const from = arg('--from');
      if (!MODULE_KEY.test(key) || from === undefined) throw new Error('usage: modules-sync.mjs adopt <MODULE_KEY> --from <package dir>');
      const pinned = parseDeployments(JSON.parse(readFileSync(lockFile, 'utf8'))).get(key);
      if (pinned === undefined) throw new Error(`${key} is not in the deployment lock`);
      const { dir, created } = writeRelease({ releasesDir, moduleKey: key, packageVersion: pinned.packageVersion, sourceDir: resolve(from), expectedHash: pinned.packageHash });
      process.stdout.write(`${JSON.stringify({ moduleKey: key, packageVersion: pinned.packageVersion, packageHash: pinned.packageHash, release: dir, created })}\n`);
    } else {
      const app = target === 'frontend' ? 'frontend' : 'backend';
      if (!existsSync(lockFile)) throw new Error(`deployment lock ${basename(lockFile)} missing — refusing to sync (installed-modules left unchanged)`);
      const deployments = JSON.parse(readFileSync(lockFile, 'utf8'));
      // FMI-02/03: the Host is built from the release store only (modules/ = candidates, never read here).
      syncModules({ target, releasesDir, outDir: resolve(arg('--out') ?? join(repo, app, 'src', 'installed-modules')), deployments });
    }
  } catch (error) {
    process.stderr.write(`[modules] ${error instanceof Error ? error.message : 'sync failed'}\n`);
    process.exit(1);
  }
}
