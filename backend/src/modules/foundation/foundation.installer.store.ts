import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// FMI-02/03 — local installer store (spec 03: "không thêm bảng DB khi chưa có phê duyệt schema"). One folder on the
// server, never a request value:
//   candidates/<candidateId>/candidate.json      Candidate Workspace record (stands BEFORE B02)
//   candidates/<candidateId>/package/             immutable snapshot of the scanned package (hash verified)
//   candidates/<candidateId>/runs/<runId>/        run.json, report.json, report.txt, logs/<check>.log
//   installs/<installId>.json                     installer transaction (prepare plan + commit / continue steps)
// Every JSON write goes to a temporary file in the same folder, then rename (atomic replace). A record that cannot be
// parsed is reported as missing (never guessed). The folder carries its own .gitignore (generated data).

export const DEFAULT_INSTALLER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../var/installer');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isStoreId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

export class InstallerStore {
  constructor(readonly root: string = DEFAULT_INSTALLER_ROOT) {}

  init(): void {
    mkdirSync(join(this.root, 'candidates'), { recursive: true });
    mkdirSync(join(this.root, 'installs'), { recursive: true });
    const base = dirname(this.root);
    if (!existsSync(join(base, '.gitignore'))) writeFileSync(join(base, '.gitignore'), '# FMI-02/03 installer data (generated, never committed)\n*\n');
  }

  newId(): string {
    return randomUUID();
  }

  candidateDir(candidateId: string): string {
    return join(this.root, 'candidates', this.id(candidateId));
  }

  packageDir(candidateId: string): string {
    return join(this.candidateDir(candidateId), 'package');
  }

  runDir(candidateId: string, runId: string): string {
    return join(this.candidateDir(candidateId), 'runs', this.id(runId));
  }

  readCandidate<T>(candidateId: string): T | null {
    return this.read<T>(join(this.candidateDir(candidateId), 'candidate.json'));
  }

  writeCandidate(candidateId: string, value: object): void {
    this.write(join(this.candidateDir(candidateId), 'candidate.json'), value);
  }

  listCandidates<T>(): T[] {
    const dir = join(this.root, 'candidates');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((d) => ID.test(d)).flatMap((d) => {
      const c = this.read<T>(join(dir, d, 'candidate.json'));
      return c === null ? [] : [c];
    });
  }

  readRun<T>(candidateId: string, runId: string): T | null {
    return this.read<T>(join(this.runDir(candidateId, runId), 'run.json'));
  }

  writeRun(candidateId: string, runId: string, value: object): void {
    this.write(join(this.runDir(candidateId, runId), 'run.json'), value);
  }

  writeRunFile(candidateId: string, runId: string, name: string, content: string): string {
    const file = join(this.runDir(candidateId, runId), name);
    this.writeText(file, content);
    return file;
  }

  readRunFile(candidateId: string, runId: string, name: string): string | null {
    const file = join(this.runDir(candidateId, runId), name);
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  readInstall<T>(installId: string): T | null {
    return this.read<T>(join(this.root, 'installs', `${this.id(installId)}.json`));
  }

  writeInstall(installId: string, value: object): void {
    this.write(join(this.root, 'installs', `${this.id(installId)}.json`), value);
  }

  listInstalls<T>(): T[] {
    const dir = join(this.root, 'installs');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => ID.test(f.replace(/\.json$/, ''))).flatMap((f) => {
      const v = this.read<T>(join(dir, f));
      return v === null ? [] : [v];
    });
  }

  remove(candidateId: string): void {
    rmSync(this.candidateDir(candidateId), { recursive: true, force: true });
  }

  private id(value: string): string {
    if (!ID.test(value)) throw new Error('installer store: invalid id');
    return value;
  }

  private read<T>(file: string): T | null {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  private write(file: string, value: object): void {
    this.writeText(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  private writeText(file: string, content: string): void {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, file);
  }
}
