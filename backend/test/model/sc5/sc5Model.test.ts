import { describe, expect, it } from 'vitest';
import { explore, runSequential } from './sc5Model.js';
import type { CounterProtocol, Options, Params, RequestSpec, Scenario } from './sc5Model.js';

// AUTH-SC5-V1 model-based verification. Exhaustive interleavings on small parameters (N=2/3) cover the
// concurrency space; sequential runs check the contract values (N=5, T=15, D=2 « T).

const C: RequestSpec = { kind: 'correct' };
const W: RequestSpec = { kind: 'wrong' };
const SAFE: Omit<Options, 'protocol'> = { lockCoupling: true, writerRevokes: true, activationRevokesOthers: true };
const SMALL: Params = { N: 2, T: 3, D: 2 };
const CONTRACT: Params = { N: 5, T: 15, D: 2 };

function scenario(protocol: CounterProtocol, requests: RequestSpec[], extra: Partial<Scenario> = {}, options: Partial<Options> = {}): Scenario {
  return {
    params: SMALL,
    options: { protocol, ...SAFE, ...options },
    requests,
    initial: { c: 0, L: null },
    ticks: 0,
    writer: false,
    mustChange: false,
    ...extra,
  };
}

// Concurrency mixes that contain the stale-SUCCESS pattern (two correct + enough wrong to lock a new cycle).
const MIXES: { name: string; requests: RequestSpec[]; extra?: Partial<Scenario> }[] = [
  { name: '2 correct + 2 wrong', requests: [C, C, W, W] },
  { name: '2 correct + 3 wrong', requests: [C, C, W, W, W] },
  { name: '1 correct + 3 wrong, c=1 initially', requests: [C, W, W, W], extra: { initial: { c: 1, L: null } } },
  { name: '2 correct + 2 wrong + 2 clock ticks', requests: [C, C, W, W], extra: { ticks: 2 } },
  { name: '1 correct + 2 wrong, expired lock initially + 3 ticks', requests: [C, W, W], extra: { initial: { c: 2, L: 0 }, ticks: 3 } },
  { name: '2 correct + 2 wrong, N=3', requests: [C, C, W, W], extra: { params: { N: 3, T: 4, D: 2 } } },
  { name: '2 correct + 3 wrong, N=3 + 1 tick', requests: [C, C, W, W, W], extra: { params: { N: 3, T: 4, D: 2 }, ticks: 1 } },
];

describe.each(['H-b', 'H-a'] as const)('protocol %s — exhaustive interleavings', (protocol) => {
  for (const mix of MIXES) {
    it(`holds every invariant: ${mix.name}`, () => {
      const result = explore(scenario(protocol, mix.requests, mix.extra));
      expect(result.interleavings).toBeGreaterThan(0);
      expect(Object.fromEntries(result.violations)).toEqual({});
    });
  }
});

describe('negative controls — the checks detect the bugs they guard against', () => {
  it('naive SUCCESS (always reset) produces a stale reset of a newer cycle', () => {
    const result = explore(scenario('naive', [C, C, W, W]));
    expect([...result.violations.keys()]).toContain('STALE-RESET: a request from an older cycle reset the counter/lock');
  });

  it('post-increment (count after verify) exceeds N real verifications per cycle', () => {
    const result = explore(scenario('post-increment', [W, W, W]));
    expect([...result.violations.keys()]).toContain('G1: more than N real verifications in one cycle');
  });

  it('SUCCESS without account-row lock coupling issues a session after the writer invalidated eligibility', () => {
    const result = explore(scenario('H-b', [C], { writer: true }, { lockCoupling: false }));
    expect([...result.violations.keys()]).toContain('AD-3: live session for an ineligible account');
  });

  it('a writer that does not revoke sessions leaves a live session for an ineligible account', () => {
    const result = explore(scenario('H-b', [C], { writer: true }, { writerRevokes: false }));
    expect([...result.violations.keys()]).toContain('AD-3: live session for an ineligible account');
  });

  it('activation logins that do not revoke each other break AS-1', () => {
    const result = explore(scenario('H-b', [C, C], { mustChange: true }, { activationRevokesOthers: false }));
    expect([...result.violations.keys()]).toContain('AS-1: more than one live activation session');
  });
});

describe.each(['H-b', 'H-a'] as const)('protocol %s — eligibility (AD-3/F2-04) and AS-1', (protocol) => {
  it('lock coupling + revoking writer: no live session for an ineligible account in any interleaving', () => {
    const result = explore(scenario(protocol, [C, C, W], { writer: true, ticks: 1 }));
    expect(Object.fromEntries(result.violations)).toEqual({});
  });

  it('concurrent activation logins keep at most one live activation session', () => {
    const result = explore(scenario(protocol, [C, C, C, W], { mustChange: true }));
    expect(Object.fromEntries(result.violations)).toEqual({});
  });
});

describe.each(['H-b', 'H-a'] as const)('protocol %s — contract scenarios (N=5, T=15)', (protocol) => {
  const contract = (requests: RequestSpec[], extra: Partial<Scenario> = {}) =>
    scenario(protocol, requests, { params: CONTRACT, ...extra });

  it('4 wrong then a correct 5th attempt logs in and resets the cycle (success not counted as failure)', () => {
    const order = ['R0:reserve', 'R0:finish', 'R1:reserve', 'R1:finish', 'R2:reserve', 'R2:finish', 'R3:reserve', 'R3:finish', 'R4:reserve', 'R4:finish'];
    const { world, violations } = runSequential(contract([W, W, W, W, C]), order);
    expect(violations).toEqual([]);
    expect(world.reqs[4]?.outcome).toBe('AUTHENTICATED');
    expect({ c: world.c, L: world.L }).toEqual({ c: 0, L: null });
  });

  it('5 wrong lock for T; a correct 6th attempt is rejected without real verification', () => {
    const order = [0, 1, 2, 3, 4].flatMap((i) => [`R${i}:reserve`, `R${i}:finish`]).concat(['R5:reserve']);
    const { world, violations } = runSequential(contract([W, W, W, W, W, C]), order);
    expect(violations).toEqual([]);
    expect(world.L).toBe(15);
    expect(world.reqs[5]?.outcome).toBe('REJECTED_LOCKED(dummy)');
    expect(world.verifiesPerCycle.get(0)).toBe(5);
  });

  it('after the lock expires a new cycle starts and a correct login succeeds', () => {
    const order = [0, 1, 2, 3, 4].flatMap((i) => [`R${i}:reserve`, `R${i}:finish`]).concat(Array(15).fill('tick'), ['R5:reserve', 'R5:finish']);
    const { world, violations } = runSequential(contract([W, W, W, W, W, C]), order);
    expect(violations).toEqual([]);
    expect(world.reqs[5]?.outcome).toBe('AUTHENTICATED');
    expect({ c: world.c, L: world.L }).toEqual({ c: 0, L: null });
  });

  it('a correct attempt that exceeds the deadline D is refused and does not reset', () => {
    const order = ['R0:reserve', 'R1:reserve', 'R1:finish', 'tick', 'tick', 'tick', 'R0:finish'];
    const { world, violations } = runSequential(contract([C, W]), order);
    expect(violations).toEqual([]);
    expect(world.reqs[0]?.outcome).toBe('ATTEMPT_EXPIRED_401');
    expect(world.c).toBe(2);
  });

  it('stale SUCCESS (older cycle) after a new cycle was locked: no reset, no session', () => {
    // R0 and R1 correct in cycle 0; R1 resets (cycle 1); R2..R6 lock cycle 1; R0 finishes last.
    const order = ['R0:reserve', 'R1:reserve', 'R1:finish', ...[2, 3, 4, 5, 6].flatMap((i) => [`R${i}:reserve`, `R${i}:finish`]), 'R0:finish'];
    const { world, violations } = runSequential(contract([C, C, W, W, W, W, W]), order);
    expect(violations).toEqual([]);
    expect(world.reqs[0]?.outcome).toBe('LOCKED_401');
    expect({ c: world.c, L: world.L }).toEqual({ c: 5, L: 15 });
  });
});

describe('protocol differences (documented trade-off)', () => {
  // R0 correct reserves first, R1 wrong reserves after it in the SAME cycle, then R0 finishes.
  const order = ['R0:reserve', 'R1:reserve', 'R1:finish', 'R0:finish'];

  it('H-b: a correct login with a later same-cycle reservation logs in but does not reset (its slot stays counted)', () => {
    const { world } = runSequential(scenario('H-b', [C, W], { params: CONTRACT }), order);
    expect(world.reqs[0]?.outcome).toBe('AUTHENTICATED');
    expect(world.c).toBe(2);
  });

  it('H-a: the same login resets the whole cycle (same anchor)', () => {
    const { world } = runSequential(scenario('H-a', [C, W], { params: CONTRACT }), order);
    expect(world.reqs[0]?.outcome).toBe('AUTHENTICATED');
    expect(world.c).toBe(0);
  });
});
