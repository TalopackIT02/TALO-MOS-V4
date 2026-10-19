// MOD-TEST-02 — Host module loader, build-time part (Foundation side; no module is named here).
//   node backend/scripts/modules-sync.mjs <backend|frontend> [--modules <dir>] [--out <dir>]
// Discovers the packages in <repo>/modules/*/module.json, validates each manifest (package format, Host protocol, required
// capabilities, entries inside the package, screen routes), copies the valid package's backend + mic (backend target) or
// frontend (frontend target) files into <app>/src/installed-modules/<moduleKey>/ and writes a static registry.ts that
// imports the entries. An invalid package is reported and skipped; no package → empty registry (the Host still builds).
// No eval, no code execution, no network, no IAM / lifecycle action: loading is not approval (Foundation API decides).
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function syncModules({ target, modulesDir, outDir, log = (line) => process.stdout.write(`${line}\n`) }) {
  if (target !== 'backend' && target !== 'frontend') throw new Error('target must be backend or frontend');
  if (basename(outDir) !== 'installed-modules') throw new Error('refused: output directory must be named installed-modules');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const loaded = [];
  const routes = new Set();
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
    for (const r of paths) routes.add(r);
    for (const sub of target === 'backend' ? ['backend', 'mic'] : ['frontend']) copyTree(join(dir, sub), join(outDir, folder, sub));
    loaded.push(manifest);
    log(`[modules] ${target}: ${manifest.moduleKey} ${manifest.packageVersion} (${manifest.contractVersion}, ${manifest.hostProtocol})`);
  }
  writeFileSync(join(outDir, 'registry.ts'), registrySource(target, loaded));
  return loaded.map((m) => m.moduleKey);
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
  const app = target === 'frontend' ? 'frontend' : 'backend';
  try {
    syncModules({ target, modulesDir: resolve(arg('--modules') ?? join(repo, 'modules')), outDir: resolve(arg('--out') ?? join(repo, app, 'src', 'installed-modules')) });
  } catch (error) {
    process.stderr.write(`[modules] ${error instanceof Error ? error.message : 'sync failed'}\n`);
    process.exit(1);
  }
}
