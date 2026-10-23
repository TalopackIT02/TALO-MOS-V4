import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest } from '../../../scripts/modules-sync.mjs';
import { hashPackage, walkPackage } from '../../../scripts/module-package.mjs';
import type { PackageWalk } from '../../../scripts/module-package.mjs';

// FMI-01 — filesystem side of the Manual Module Scan. READ ONLY: lists the direct children of the trusted modules root
// (server configuration, never a request value), walks each package without following links (module-package.mjs, the same
// reader as the Host loader), reads module.json and mic/module.mic.json as DATA (JSON.parse) and computes the package hash.
// Nothing is imported, compiled, executed or written; validateManifest() is the Host loader's own pure validator.

export const MAX_FOLDERS = 250;
export const MIC_JSON_PATH = 'mic/module.mic.json';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_MIC_BYTES = 2 * 1024 * 1024;

export class ScanRootUnavailableError extends Error {
  constructor() {
    super('modules root unavailable');
    this.name = 'ScanRootUnavailableError';
  }
}

export class ScanLimitError extends Error {
  constructor() {
    super('too many package folders');
    this.name = 'ScanLimitError';
  }
}

export type JsonFile = { readonly state: 'MISSING' } | { readonly state: 'INVALID'; readonly reason: string } | { readonly state: 'OK'; readonly value: unknown };

export interface PackageFacts {
  readonly folder: string;
  // The folder entry itself is a link / junction / escapes the root: nothing inside it is read.
  readonly unsafeFolder: boolean;
  readonly walk: PackageWalk | null;
  readonly hash: string | null;
  readonly changed: boolean;
  readonly manifest: JsonFile;
  readonly manifestProblems: readonly string[];
  readonly mic: JsonFile;
  readonly legacyMicEntry: string | null; // micEntry (.ts) present in the package, used only as a format hint
}

// Direct child folders, stable order. Regular files at the root (e.g. a ZIP) are not packages and are not listed.
export function listPackageFolders(root: string): { readonly name: string; readonly unsafe: boolean }[] {
  let realRoot: string;
  let names: string[];
  try {
    const st = lstatSync(root);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new ScanRootUnavailableError();
    realRoot = realpathSync(root);
    names = readdirSync(root).sort();
  } catch {
    throw new ScanRootUnavailableError();
  }
  const out: { name: string; unsafe: boolean }[] = [];
  for (const name of names) {
    let st;
    try {
      st = lstatSync(join(root, name));
    } catch {
      out.push({ name, unsafe: true });
      continue;
    }
    if (st.isSymbolicLink()) out.push({ name, unsafe: true });
    else if (st.isDirectory()) {
      let inside = false;
      try {
        inside = realpathSync(join(root, name)) === join(realRoot, name);
      } catch {
        inside = false;
      }
      out.push({ name, unsafe: !inside });
    }
  }
  if (out.length > MAX_FOLDERS) throw new ScanLimitError();
  return out;
}

function readJson(dir: string, rel: string, walk: PackageWalk, maxBytes: number): JsonFile {
  const file = walk.files.find((f) => f.path === rel);
  if (!file) return { state: 'MISSING' };
  if (file.size > maxBytes) return { state: 'INVALID', reason: `lớn hơn ${maxBytes} byte` };
  try {
    return { state: 'OK', value: JSON.parse(readFileSync(join(dir, ...rel.split('/')), 'utf8')) };
  } catch {
    return { state: 'INVALID', reason: 'không phải JSON hợp lệ' };
  }
}

export function readPackage(root: string, folder: string, unsafe: boolean): PackageFacts {
  const missing: JsonFile = { state: 'MISSING' };
  if (unsafe) return { folder, unsafeFolder: true, walk: null, hash: null, changed: false, manifest: missing, manifestProblems: [], mic: missing, legacyMicEntry: null };
  const dir = join(root, folder);
  const walk = walkPackage(dir);
  const manifest = readJson(dir, 'module.json', walk, MAX_MANIFEST_BYTES);
  const manifestProblems = manifest.state === 'OK' ? validateManifest(manifest.value, folder, dir) : [];
  const mic = readJson(dir, MIC_JSON_PATH, walk, MAX_MIC_BYTES);
  const entry = manifest.state === 'OK' && typeof manifest.value === 'object' && manifest.value !== null && 'micEntry' in manifest.value ? manifest.value.micEntry : null;
  const legacyMicEntry = typeof entry === 'string' && entry.endsWith('.ts') && walk.files.some((f) => f.path === entry) ? entry : null;
  // Hash last: it re-checks every file read above (size / mtime / inode) and the whole tree.
  const { hash, changed } = hashPackage(dir, walk);
  return { folder, unsafeFolder: false, walk, hash, changed, manifest, manifestProblems, mic, legacyMicEntry };
}
