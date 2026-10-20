import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// AUTH-SC5-V1 test harness (role talo_test_harness, test database only).
// The harness role has no password; it is reached through `docker exec … psql` inside the development container.
// Each PsqlSession is ONE real PostgreSQL connection, so harness transactions (writer simulation) genuinely interleave
// with the talo_app connections used by the protocol under test.

// TALO_PG_CONTAINER: a disposable clone of the test database (IAM Phase B dry run); default = the development container.
export const CONTAINER = process.env['TALO_PG_CONTAINER'] ?? 'talo-mos-v4-postgres';
export const TEST_DB = 'talo_mos_v4_test';
export const HARNESS_ROLE = 'talo_test_harness';

export interface PsqlResult {
  readonly rows: string[][];
  readonly error: boolean;
  readonly sqlstate: string;
  readonly message: string;
}

const END = '__SC5_END__';

export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function uuidArray(ids: readonly string[]): string {
  return `ARRAY[${ids.map(lit).join(',')}]::uuid[]`;
}

export class PsqlSession {
  private readonly proc: ChildProcessWithoutNullStreams;
  private stdout = '';
  private rows: string[][] = [];
  private current: { resolve: (r: PsqlResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | undefined;
  private closed = false;

  constructor(role: string = HARNESS_ROLE) {
    this.proc = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=0', '-U', role, '-d', TEST_DB]);
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.proc.stderr.on('data', () => {}); // error details are read through psql variables, not stderr
    this.proc.on('exit', () => {
      this.closed = true;
      this.current?.reject(new Error('psql session exited'));
    });
  }

  private onData(chunk: string): void {
    this.stdout += chunk;
    let newline: number;
    while ((newline = this.stdout.indexOf('\n')) >= 0) {
      const line = this.stdout.slice(0, newline).replace(/\r$/, '');
      this.stdout = this.stdout.slice(newline + 1);
      if (line.startsWith(END)) {
        const [, error, sqlstate, ...message] = line.split('|');
        const pending = this.current;
        this.current = undefined;
        const rows = this.rows;
        this.rows = [];
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve({ rows, error: error === 'true', sqlstate: sqlstate ?? '', message: message.join('|') });
        }
      } else if (line !== '') {
        this.rows.push(line.split('\t'));
      }
    }
  }

  // Sends one statement; resolves when PostgreSQL has finished it (blocks while it waits on a lock).
  query(sql: string, timeoutMs = 20_000): Promise<PsqlResult> {
    if (this.closed) return Promise.reject(new Error('psql session closed'));
    if (this.current) return Promise.reject(new Error('psql session busy'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`psql timeout after ${timeoutMs} ms: ${sql.slice(0, 80)}`)), timeoutMs);
      this.current = { resolve, reject, timer };
      this.proc.stdin.write(`${sql.trim().replace(/;?\s*$/, ';')}\n\\echo ${END}|:ERROR|:SQLSTATE|:LAST_ERROR_MESSAGE\n`);
    });
  }

  async ok(sql: string, timeoutMs?: number): Promise<string[][]> {
    const result = await this.query(sql, timeoutMs);
    if (result.error) throw new Error(`harness SQL failed [${result.sqlstate}] ${result.message}: ${sql.slice(0, 120)}`);
    return result.rows;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.proc.stdin.end('\\q\n');
    await new Promise<void>((resolve) => {
      if (this.closed) resolve();
      else this.proc.once('exit', () => resolve());
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures — synthetic data, tagged with the run id; every row is created and later deleted by explicit UUID.
// ---------------------------------------------------------------------------------------------------------------

export interface FixtureAccount {
  readonly membershipId: string;
  readonly accountId: string;
  readonly credentialId: string;
  readonly username: string;
  readonly employeeCode: string;
  readonly passwordHash: string;
}

export interface FixtureOptions {
  readonly membershipStatus?: 'ACTIVE' | 'ON_LEAVE' | 'EXITED';
  readonly accountStatus?: 'PROVISIONED' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
  readonly mustChangePassword?: boolean;
  readonly failedAttempts?: number;
  readonly extraDisabledAccount?: boolean; // historical, disabled account on the same membership
}

export class Sc5Fixtures {
  readonly runId: string;
  private seq = 0;
  readonly memberships: string[] = [];
  readonly accounts: string[] = [];

  constructor(private readonly harness: PsqlSession) {
    this.runId = `SC5T-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  }

  hashFor(accountId: string): string {
    return `${this.runId}:hash:${accountId}`; // placeholder; the protocol tests decide correct/wrong, Argon2 is not under test
  }

  async create(options: FixtureOptions = {}): Promise<FixtureAccount & { readonly extraAccountId?: string }> {
    this.seq += 1;
    const membershipId = randomUUID();
    const accountId = randomUUID();
    const credentialId = randomUUID();
    const employeeCode = `${this.runId}-M${this.seq}`;
    const username = `${this.runId}-u${this.seq}`.toLowerCase();
    const status = options.accountStatus ?? 'ACTIVE';
    const mustChange = options.mustChangePassword ?? false;

    // Data safety: no collision with existing ids, codes or usernames.
    const collisionRows = await this.harness.ok(`
      SELECT (SELECT count(*) FROM iam.iam_memberships WHERE membership_id = ${lit(membershipId)} OR employee_code = ${lit(employeeCode)})
           + (SELECT count(*) FROM iam.iam_user_accounts WHERE user_account_id = ${lit(accountId)} OR lower(username) = lower(${lit(username)}))
           + (SELECT count(*) FROM iam.iam_credentials WHERE credential_id = ${lit(credentialId)})`);
    if (collisionRows[0]?.[0] !== '0') throw new Error('fixture collision with existing data');

    this.memberships.push(membershipId);
    this.accounts.push(accountId);
    await this.harness.ok('BEGIN');
    await this.harness.ok(`
      INSERT INTO iam.iam_memberships (membership_id, employee_id, employee_code, full_name, membership_status, joined_at)
      VALUES (${lit(membershipId)}, ${lit(randomUUID())}, ${lit(employeeCode)}, ${lit(`SC5 synthetic ${this.seq}`)},
              ${lit(options.membershipStatus ?? 'ACTIVE')}, current_date - 30)`);
    let extraAccountId: string | undefined;
    if (options.extraDisabledAccount) {
      extraAccountId = randomUUID();
      this.accounts.push(extraAccountId);
      await this.harness.ok(`
        INSERT INTO iam.iam_user_accounts (user_account_id, membership_id, username, account_status, disabled_at)
        VALUES (${lit(extraAccountId)}, ${lit(membershipId)}, ${lit(`${username}-old`)}, 'DISABLED', statement_timestamp() - interval '1 day')`);
    }
    await this.harness.ok(`
      INSERT INTO iam.iam_user_accounts (user_account_id, membership_id, username, account_status, activated_at, disabled_at)
      VALUES (${lit(accountId)}, ${lit(membershipId)}, ${lit(username)}, ${lit(status)},
              ${status === 'ACTIVE' ? 'statement_timestamp()' : 'NULL'},
              ${status === 'DISABLED' ? 'statement_timestamp()' : 'NULL'})`);
    await this.harness.ok(`
      INSERT INTO iam.iam_credentials (credential_id, user_account_id, password_hash, password_changed_at, must_change_password, failed_attempt_count)
      VALUES (${lit(credentialId)}, ${lit(accountId)}, ${lit(this.hashFor(accountId))},
              ${mustChange ? 'NULL' : 'statement_timestamp()'}, ${mustChange}, ${options.failedAttempts ?? 0})`);
    await this.harness.ok('COMMIT');
    return { membershipId, accountId, credentialId, username, employeeCode, passwordHash: this.hashFor(accountId), ...(extraAccountId ? { extraAccountId } : {}) };
  }

  // Scoped cleanup: only rows provably owned by this run (UUID lists + run tag), FK order, one transaction.
  async cleanup(): Promise<{ deleted: Record<string, number> }> {
    if (this.memberships.length === 0) return { deleted: {} };
    const accounts = uuidArray(this.accounts);
    const memberships = uuidArray(this.memberships);
    const tag = `${this.runId}-%`;
    // Ownership proof: every account to delete belongs to a membership of this run, every membership carries the tag.
    const foreignRows = await this.harness.ok(`
      SELECT (SELECT count(*) FROM iam.iam_user_accounts WHERE user_account_id = ANY(${accounts}) AND NOT (membership_id = ANY(${memberships})))
           + (SELECT count(*) FROM iam.iam_memberships WHERE membership_id = ANY(${memberships}) AND employee_code NOT LIKE ${lit(tag)})`);
    if (foreignRows[0]?.[0] !== '0') throw new Error('cleanup refused: ownership could not be proven');
    const deleted: Record<string, number> = {};
    await this.harness.ok('BEGIN');
    const steps: [string, string][] = [
      ['audit', `DELETE FROM iam.iam_audit_logs WHERE metadata->>'run' = ${lit(this.runId)} AND (target_id = ANY(${accounts}) OR actor_account_id = ANY(${accounts}) OR membership_id = ANY(${memberships}))`],
      ['sessions', `DELETE FROM iam.iam_sessions WHERE user_account_id = ANY(${accounts})`],
      ['credentials', `DELETE FROM iam.iam_credentials WHERE user_account_id = ANY(${accounts})`],
      ['accounts', `DELETE FROM iam.iam_user_accounts WHERE user_account_id = ANY(${accounts}) AND membership_id = ANY(${memberships})`],
      ['memberships', `DELETE FROM iam.iam_memberships WHERE membership_id = ANY(${memberships}) AND employee_code LIKE ${lit(tag)}`],
    ];
    for (const [name, sql] of steps) {
      const result = await this.harness.query(`WITH d AS (${sql} RETURNING 1) SELECT count(*) FROM d`);
      if (result.error) {
        await this.harness.query('ROLLBACK');
        throw new Error(`cleanup failed at ${name} [${result.sqlstate}] ${result.message}`);
      }
      deleted[name] = Number(result.rows[0]?.[0] ?? 0);
    }
    await this.harness.ok('COMMIT');
    this.memberships.length = 0;
    this.accounts.length = 0;
    return { deleted };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Inspection helpers (harness reads; values compared in SQL to keep microsecond precision).
// ---------------------------------------------------------------------------------------------------------------

export interface CredentialState {
  readonly c: number;
  readonly lockedUntil: string | null;
  readonly locked: boolean;
  readonly version: string;
  readonly hash: string;
}

export async function credentialState(h: PsqlSession, accountId: string): Promise<CredentialState> {
  const [row] = await h.ok(`
    SELECT failed_attempt_count, coalesce(locked_until::text, ''), (locked_until IS NOT NULL AND locked_until > statement_timestamp()),
           updated_at::text, password_hash
      FROM iam.iam_credentials WHERE user_account_id = ${lit(accountId)}`);
  if (!row) throw new Error('credential not found');
  return { c: Number(row[0]), lockedUntil: row[1] ? row[1] : null, locked: row[2] === 't', version: row[3] ?? '', hash: row[4] ?? '' };
}

export async function liveSessions(h: PsqlSession, accountId: string): Promise<{ total: number; live: number; liveActivation: number }> {
  const [row] = await h.ok(`
    SELECT count(*), count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > statement_timestamp()),
           count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > statement_timestamp() AND assurance_level_snapshot = 0)
      FROM iam.iam_sessions WHERE user_account_id = ${lit(accountId)}`);
  return { total: Number(row?.[0]), live: Number(row?.[1]), liveActivation: Number(row?.[2]) };
}

export async function sqlTrue(h: PsqlSession, expression: string): Promise<boolean> {
  const [row] = await h.ok(`SELECT (${expression})`);
  return row?.[0] === 't';
}

// ---------------------------------------------------------------------------------------------------------------
// Writer protocol (privileged eligibility writer, simulated by the harness): lock account rows in UUID order,
// change eligibility, revoke sessions, commit — all in one transaction. Steps are exposed so tests can interleave.
// ---------------------------------------------------------------------------------------------------------------

export const writer = {
  begin: (h: PsqlSession) => h.ok('BEGIN'),
  lockAccountsOfMembership: (h: PsqlSession, membershipId: string, order: 'ASC' | 'DESC' = 'ASC') =>
    h.query(`SELECT user_account_id FROM iam.iam_user_accounts WHERE membership_id = ${lit(membershipId)} ORDER BY user_account_id ${order} FOR NO KEY UPDATE`),
  lockAccount: (h: PsqlSession, accountId: string) =>
    h.query(`SELECT user_account_id FROM iam.iam_user_accounts WHERE user_account_id = ${lit(accountId)} FOR NO KEY UPDATE`),
  exitMembership: (h: PsqlSession, membershipId: string) =>
    h.ok(`UPDATE iam.iam_memberships SET membership_status = 'EXITED',
            left_at = greatest(joined_at, (statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
          WHERE membership_id = ${lit(membershipId)}`),
  setLeftAt: (h: PsqlSession, membershipId: string, dateExpression: string) =>
    h.ok(`UPDATE iam.iam_memberships SET left_at = ${dateExpression} WHERE membership_id = ${lit(membershipId)}`),
  setMembershipStatus: (h: PsqlSession, membershipId: string, status: string) =>
    h.ok(`UPDATE iam.iam_memberships SET membership_status = ${lit(status)} WHERE membership_id = ${lit(membershipId)}`),
  setAccountStatus: (h: PsqlSession, accountId: string, status: 'LOCKED' | 'DISABLED') =>
    h.ok(`UPDATE iam.iam_user_accounts SET account_status = ${lit(status)},
            disabled_at = ${status === 'DISABLED' ? 'statement_timestamp()' : 'NULL'}
          WHERE user_account_id = ${lit(accountId)}`),
  revokeMembershipSessions: (h: PsqlSession, membershipId: string) =>
    h.ok(`UPDATE iam.iam_sessions SET revoked_at = statement_timestamp()
          WHERE revoked_at IS NULL AND user_account_id IN (SELECT user_account_id FROM iam.iam_user_accounts WHERE membership_id = ${lit(membershipId)})`),
  revokeAccountSessions: (h: PsqlSession, accountId: string) =>
    h.ok(`UPDATE iam.iam_sessions SET revoked_at = statement_timestamp() WHERE revoked_at IS NULL AND user_account_id = ${lit(accountId)}`),
  commit: (h: PsqlSession) => h.ok('COMMIT'),
  rollback: (h: PsqlSession) => h.query('ROLLBACK'),
};

// Credential writers outside authentication must bump the version too (H-b contract).
export const credentialWriter = {
  expireLock: (h: PsqlSession, accountId: string) =>
    h.ok(`UPDATE iam.iam_credentials SET locked_until = statement_timestamp() - interval '1 second',
            updated_at = greatest(statement_timestamp(), updated_at + interval '1 microsecond')
          WHERE user_account_id = ${lit(accountId)} AND locked_until IS NOT NULL`),
  changePassword: (h: PsqlSession, accountId: string, newHash: string) =>
    h.ok(`UPDATE iam.iam_credentials SET password_hash = ${lit(newHash)},
            updated_at = greatest(statement_timestamp(), updated_at + interval '1 microsecond')
          WHERE user_account_id = ${lit(accountId)}`),
};
