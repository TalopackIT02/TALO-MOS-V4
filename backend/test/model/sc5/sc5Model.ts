// AUTH-SC5-V1 — executable model of the login concurrency / lockout protocol (no database, no Argon2).
//
// The model abstracts each PostgreSQL step to an atomic event:
//   RESERVE  — one single-statement UPDATE on iam_credentials (row-locked, atomic).
//   FINISH   — Argon2 verify (outside any transaction, no DB state) followed, if the password is correct, by the
//              SUCCESS transaction. SUCCESS is atomic in the model because it holds FOR NO KEY UPDATE locks on the
//              account and credential rows (READ COMMITTED, re-reading after the locks are acquired).
//   TICK     — the database clock advances one unit.
//   WRITER   — a privileged eligibility writer (membership EXITED / account DISABLED).
// The scheduler explores every interleaving of these events and checks the SC-5 invariants after each step.
// Negative-control protocols ("naive", "post-increment", no lock coupling, no AS-1 revoke) must violate them,
// which proves the checks are able to detect the bugs they guard against.

export type CounterProtocol =
  | 'H-b' // CAS on a strictly monotonic version (updated_at bumped on every credential write)
  | 'H-a' // cycle anchor (updated_at changed only when a new cycle starts)
  | 'naive' // B0 draft D: SUCCESS always resets — negative control for stale SUCCESS
  | 'post-increment'; // count failures after verify — negative control for G1

export interface Params {
  readonly N: number; // failed attempts per cycle (contract: 5)
  readonly T: number; // lock duration in clock units (contract: 15 min)
  readonly D: number; // attempt deadline: RESERVE → SUCCESS decision (must be < T)
}

export interface Options {
  readonly protocol: CounterProtocol;
  readonly lockCoupling: boolean; // SUCCESS locks the account row and re-reads eligibility under the lock
  readonly writerRevokes: boolean; // writer protocol: lock account rows, change status, revoke sessions
  readonly activationRevokesOthers: boolean; // AS-1: activation login revokes other sessions under the lock
}

export type RequestKind = 'correct' | 'wrong';
export interface RequestSpec {
  readonly kind: RequestKind;
}

export interface Scenario {
  readonly params: Params;
  readonly options: Options;
  readonly requests: readonly RequestSpec[];
  readonly initial: { readonly c: number; readonly L: number | null };
  readonly ticks: number; // how many TICK events may be interleaved
  readonly writer: boolean; // whether one WRITER event (eligibility invalidation) is interleaved
  readonly mustChange: boolean; // account in activation state (first-time password change)
}

interface Captured {
  readonly slot: number;
  readonly ver: number;
  readonly anchor: number;
  readonly hash: string;
  readonly reservedAt: number;
  readonly cycle: number; // ground truth, not visible to the protocol
}

type Phase = 'new' | 'reserved' | 'checked' | 'done';
interface Req {
  readonly id: number;
  readonly kind: RequestKind;
  phase: Phase;
  cap?: Captured;
  outcome?: string;
}

interface Session {
  readonly reqId: number;
  readonly activation: boolean;
  revoked: boolean;
}

export interface World {
  now: number;
  c: number;
  L: number | null;
  ver: number; // H-b version / last-write stamp
  anchor: number; // H-a cycle anchor
  hash: string;
  cycle: number; // ground-truth cycle id
  eligible: boolean; // membership/account eligibility (AD-3)
  writerDone: boolean;
  ticksLeft: number;
  sessions: Session[];
  verifiesPerCycle: Map<number, number>;
  reqs: Req[];
}

export interface ExploreResult {
  readonly interleavings: number;
  readonly violations: ReadonlyMap<string, string>; // invariant → first counter-example trace
  readonly outcomes: ReadonlyMap<string, number>;
}

const CORRECT_HASH = 'hash:correct';

function clone(w: World): World {
  return {
    ...w,
    sessions: w.sessions.map((s) => ({ ...s })),
    verifiesPerCycle: new Map(w.verifiesPerCycle),
    reqs: w.reqs.map((r) => ({ ...r })),
  };
}

function locked(w: World): boolean {
  return w.L !== null && w.L > w.now;
}

function startCycle(w: World): void {
  w.cycle += 1;
  w.anchor += 1;
}

// One atomic credential write: every write bumps the version (H-b requirement on all credential writers).
function bumpVersion(w: World): void {
  w.ver += 1;
}

function reserve(w: World, r: Req, s: Scenario, fail: (inv: string) => void): void {
  const { N, T } = s.params;
  const expired = w.L !== null && w.L <= w.now;
  if (s.options.protocol === 'post-increment') {
    // Negative control: nothing reserved before verify; only "locked" is checked.
    if (locked(w)) {
      r.phase = 'done';
      r.outcome = 'REJECTED_LOCKED(dummy)';
      return;
    }
    if (expired) {
      w.c = 0;
      w.L = null;
      startCycle(w);
      bumpVersion(w);
    }
    r.cap = { slot: w.c, ver: w.ver, anchor: w.anchor, hash: w.hash, reservedAt: w.now, cycle: w.cycle };
  } else {
    if (locked(w) || (!expired && w.c >= N)) {
      r.phase = 'done';
      r.outcome = 'REJECTED_LOCKED(dummy)';
      return;
    }
    if (expired) {
      w.c = 1;
      w.L = 1 >= N ? w.now + T : null;
      startCycle(w);
    } else {
      w.c += 1;
      if (w.c >= N) w.L = w.now + T;
    }
    bumpVersion(w);
    r.cap = { slot: w.c, ver: w.ver, anchor: w.anchor, hash: w.hash, reservedAt: w.now, cycle: w.cycle };
  }
  // A real Argon2 verification will run for this request (G1 accounting per ground-truth cycle).
  const used = (w.verifiesPerCycle.get(w.cycle) ?? 0) + 1;
  w.verifiesPerCycle.set(w.cycle, used);
  if (used > N) fail('G1: more than N real verifications in one cycle');
  r.phase = 'reserved';
}

function resetCounter(w: World, r: Req, fail: (inv: string) => void): void {
  if (r.cap && r.cap.cycle !== w.cycle) fail('STALE-RESET: a request from an older cycle reset the counter/lock');
  w.c = 0;
  w.L = null;
  bumpVersion(w);
  startCycle(w);
}

function issueSession(w: World, r: Req, s: Scenario): void {
  if (s.mustChange && s.options.activationRevokesOthers) {
    for (const session of w.sessions) session.revoked = true;
  }
  w.sessions.push({ reqId: r.id, activation: s.mustChange, revoked: false });
  r.outcome = s.mustChange ? 'ACTIVATION_SESSION' : 'AUTHENTICATED';
}

// FINISH = verify (outside a transaction) + SUCCESS transaction when the password is correct.
function finish(w: World, r: Req, s: Scenario, fail: (inv: string) => void): void {
  const cap = r.cap;
  if (!cap) throw new Error('finish without reservation');
  const correct = r.kind === 'correct' && cap.hash === CORRECT_HASH;
  if (!correct) {
    if (s.options.protocol === 'post-increment') {
      // Negative control: count after verify, then lock.
      w.c += 1;
      if (w.c >= s.params.N) w.L = w.now + s.params.T;
      bumpVersion(w);
    }
    r.phase = 'done';
    r.outcome = 'FAIL_401';
    return;
  }

  // ---- SUCCESS transaction (atomic: account + credential row locks held) ----
  if (w.hash !== cap.hash) {
    r.phase = 'done';
    r.outcome = 'CREDENTIAL_CHANGED_401';
    return;
  }
  const protocol = s.options.protocol;
  if (protocol !== 'naive' && protocol !== 'post-increment' && w.now - cap.reservedAt > s.params.D) {
    r.phase = 'done';
    r.outcome = 'ATTEMPT_EXPIRED_401';
    return;
  }
  const mayReset =
    protocol === 'naive' || protocol === 'post-increment'
      ? true
      : protocol === 'H-b'
        ? w.ver === cap.ver
        : w.anchor === cap.anchor;
  if (mayReset) resetCounter(w, r, fail);

  if (locked(w)) {
    // Never issue a session while the credential is locked by someone else's reservation.
    r.phase = 'done';
    r.outcome = 'LOCKED_401';
    return;
  }

  if (s.options.lockCoupling) {
    if (!w.eligible) {
      r.phase = 'done';
      r.outcome = 'NOT_ALLOWED_403';
      return;
    }
    issueSession(w, r, s);
    r.phase = 'done';
  } else {
    // Negative control: eligibility checked now, session inserted in a later, separate step.
    if (!w.eligible) {
      r.phase = 'done';
      r.outcome = 'NOT_ALLOWED_403';
      return;
    }
    r.phase = 'checked';
  }
}

function insertAfterCheck(w: World, r: Req, s: Scenario): void {
  issueSession(w, r, s);
  r.phase = 'done';
}

function writer(w: World, s: Scenario): void {
  // Privileged writer protocol: lock the account rows FOR NO KEY UPDATE, change eligibility, revoke sessions.
  w.eligible = false;
  if (s.options.writerRevokes) for (const session of w.sessions) session.revoked = true;
  w.writerDone = true;
}

function checkStateInvariants(w: World, s: Scenario, fail: (inv: string) => void): void {
  if (w.c > s.params.N) fail('COUNTER: c exceeds N');
  if (s.options.protocol !== 'post-increment' && w.c === s.params.N && w.L === null) fail('COUNTER: c = N without a lock');
  if (!w.eligible && w.sessions.some((x) => !x.revoked)) fail('AD-3: live session for an ineligible account');
  if (w.sessions.filter((x) => x.activation && !x.revoked).length > 1) fail('AS-1: more than one live activation session');
}

export function initialWorld(s: Scenario): World {
  return {
    now: 0,
    c: s.initial.c,
    L: s.initial.L,
    ver: 0,
    anchor: 0,
    hash: CORRECT_HASH,
    cycle: 0,
    eligible: true,
    writerDone: false,
    ticksLeft: s.ticks,
    sessions: [],
    verifiesPerCycle: new Map(),
    reqs: s.requests.map((spec, id) => ({ id, kind: spec.kind, phase: 'new' })),
  };
}

// Exhaustive depth-first exploration of all event interleavings.
export function explore(s: Scenario, onFinal?: (w: World) => void): ExploreResult {
  const violations = new Map<string, string>();
  const outcomes = new Map<string, number>();
  let interleavings = 0;

  const visit = (w: World, trace: string[]): void => {
    const events: { label: string; apply: (next: World, fail: (inv: string) => void) => void }[] = [];
    for (const r of w.reqs) {
      if (r.phase === 'new') events.push({ label: `R${r.id}:${r.kind}:reserve`, apply: (n, f) => reserve(n, n.reqs[r.id]!, s, f) });
      if (r.phase === 'reserved') events.push({ label: `R${r.id}:finish`, apply: (n, f) => finish(n, n.reqs[r.id]!, s, f) });
      if (r.phase === 'checked') events.push({ label: `R${r.id}:insert-session`, apply: (n) => insertAfterCheck(n, n.reqs[r.id]!, s) });
    }
    const requestsPending = events.length > 0;
    if (w.ticksLeft > 0 && requestsPending) events.push({ label: 'tick', apply: (n) => { n.now += 1; n.ticksLeft -= 1; } });
    // The writer may run at any point, including after every login finished (sessions already issued).
    if (s.writer && !w.writerDone) events.push({ label: 'WRITER', apply: (n) => writer(n, s) });

    if (events.length === 0) {
      interleavings += 1;
      const key = w.reqs.map((r) => `${r.kind}:${r.outcome ?? '?'}`).join(' | ');
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
      onFinal?.(w);
      return;
    }
    for (const event of events) {
      const next = clone(w);
      const nextTrace = [...trace, event.label];
      const fail = (inv: string) => {
        if (!violations.has(inv)) violations.set(inv, nextTrace.join(' → '));
      };
      event.apply(next, fail);
      checkStateInvariants(next, s, fail);
      visit(next, nextTrace);
    }
  };

  visit(initialWorld(s), []);
  return { interleavings, violations, outcomes };
}

// Deterministic sequential run (one event at a time, in the given order) for contract scenarios.
export function runSequential(s: Scenario, order: readonly string[]): { world: World; violations: string[] } {
  const w = initialWorld(s);
  const violations: string[] = [];
  const fail = (inv: string) => violations.push(inv);
  for (const label of order) {
    if (label === 'tick') {
      w.now += 1;
      continue;
    }
    const match = /^R(\d+):(reserve|finish)$/.exec(label);
    if (!match) throw new Error(`bad label ${label}`);
    const r = w.reqs[Number(match[1])];
    if (!r) throw new Error(`no request ${label}`);
    if (match[2] === 'reserve') reserve(w, r, s, fail);
    else if (r.phase === 'reserved') finish(w, r, s, fail);
    checkStateInvariants(w, s, fail);
  }
  return { world: w, violations };
}
