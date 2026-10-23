// FMI-01 — Module package reader (READ ONLY), shared by the Foundation module scanner (backend/src) and the Host build-time
// loader (modules-sync.mjs), so that both compute the SAME package hash.
//   walkPackage(dir)  → the regular files of one package (relative POSIX paths) + safety issues; never follows a symbolic
//                       link / junction, never descends into excluded folders, never reads a sensitive file.
//   hashPackage(dir, walk) → deterministic SHA-256 of the package, or null (limit exceeded / unsafe / changed meanwhile).
// Hash definition TALO-PACKAGE-HASH-1:
//   files sorted by the UTF-8 bytes of their relative path ('/' separators); per file sha256 of the content, where text
//   files (TEXT_EXT) have CRLF normalised to LF (so that a Git checkout with autocrlf gives the same hash);
//   digest = sha256("TALO-PACKAGE-HASH-1\n" + Σ "<byteLength(path)>:<path>:<sha256 hex>\n").
//   Each file is lstat'ed before and after it is read (size, mtime, inode) and the tree is listed again at the end: any
//   difference → changed = true and no hash.
// No write, no import of package code, no child process.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const HASH_FORMAT = 'TALO-PACKAGE-HASH-1';
export const LIMITS = Object.freeze({ files: 1500, bytes: 25 * 1024 * 1024 });
// Never walked (build output, dependencies, VCS, generated code).
export const EXCLUDED_DIRS = Object.freeze(['.git', 'node_modules', 'dist', 'build', 'coverage', 'generated', 'installed-modules']);
// Never read; their presence is an issue (a package must not carry secrets or keys).
const SENSITIVE = [/^\.env(\..*)?$/i, /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, /^\.npmrc$/i, /^\.pgpass$/i];
const TEXT_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|md|css|scss|html|txt|yml|yaml|svg|sql|csv)$/i;

export const isSensitiveName = (name) => SENSITIVE.some((re) => re.test(name));
const toPosix = (p) => p.split(sep).join('/');
const statKey = (st) => `${st.size}:${Math.trunc(st.mtimeMs)}:${st.ino}`;

// Lists the package. issues: { code: 'PATH_UNSAFE' | 'SENSITIVE_FILE' | 'SCAN_LIMIT_EXCEEDED', path, message }.
export function walkPackage(dir, limits = LIMITS) {
  const files = [];
  const issues = [];
  let bytes = 0;
  let limited = false;
  const root = realpathSync(dir);
  const visit = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      if (limited) return;
      const full = join(abs, name);
      const rel = toPosix(relative(dir, full));
      let st;
      try {
        st = lstatSync(full);
      } catch {
        issues.push({ code: 'PATH_UNSAFE', path: rel, message: 'Không đọc được thông tin tệp.' });
        continue;
      }
      if (st.isSymbolicLink()) {
        issues.push({ code: 'PATH_UNSAFE', path: rel, message: 'Liên kết tượng trưng / junction không được phép trong package.' });
        continue;
      }
      if (st.isDirectory()) {
        if (EXCLUDED_DIRS.includes(name)) continue;
        // Defence in depth (reparse points not reported as links): the real path must stay inside the package.
        const real = realpathSync(full);
        if (real !== join(root, relative(dir, full))) {
          issues.push({ code: 'PATH_UNSAFE', path: rel, message: 'Thư mục trỏ ra ngoài package.' });
          continue;
        }
        visit(full);
        continue;
      }
      if (!st.isFile()) {
        issues.push({ code: 'PATH_UNSAFE', path: rel, message: 'Loại tệp không được hỗ trợ.' });
        continue;
      }
      if (isSensitiveName(name)) {
        issues.push({ code: 'SENSITIVE_FILE', path: rel, message: 'Tệp có thể chứa bí mật; không được đọc và không được phép trong package.' });
        continue;
      }
      files.push({ path: rel, size: st.size, key: statKey(st) });
      bytes += st.size;
      if (!limited && (files.length > limits.files || bytes > limits.bytes)) {
        limited = true;
        issues.push({ code: 'SCAN_LIMIT_EXCEEDED', path: rel, message: `Package vượt giới hạn ${limits.files} tệp / ${limits.bytes} byte.` });
      }
      if (limited) return;
    }
  };
  visit(dir);
  return { files, issues, bytes, limited };
}

const byUtf8 = (a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8'));

// { hash: hex64 | null, changed: boolean }
export function hashPackage(dir, walk) {
  if (walk.limited || walk.issues.length > 0) return { hash: null, changed: false };
  const total = createHash('sha256').update(`${HASH_FORMAT}\n`);
  const sorted = [...walk.files].sort(byUtf8);
  for (const f of sorted) {
    const full = join(dir, ...f.path.split('/'));
    let content;
    try {
      content = readFileSync(full);
    } catch {
      return { hash: null, changed: true };
    }
    const after = lstatSync(full, { throwIfNoEntry: false });
    if (!after || !after.isFile() || statKey(after) !== f.key) return { hash: null, changed: true };
    const data = TEXT_EXT.test(f.path) ? Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : content;
    const digest = createHash('sha256').update(data).digest('hex');
    total.update(`${Buffer.byteLength(f.path, 'utf8')}:${f.path}:${digest}\n`);
  }
  // The tree must be the same at the end (added / removed / replaced files).
  const again = walkPackage(dir);
  const same = again.files.length === walk.files.length && again.files.every((f, i) => f.path === walk.files[i]?.path && f.key === walk.files[i]?.key);
  if (!same || again.issues.length > 0) return { hash: null, changed: true };
  return { hash: total.digest('hex'), changed: false };
}
