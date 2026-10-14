import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Options } from '@node-rs/argon2';

// Argon2id through @node-rs/argon2 (P-6a), PHC strings. Every hash and verify — real or dummy, login or first-change —
// goes through ONE global queue (IB-3): admission never depends on the account, and a full or timed-out queue answers
// 503 SERVICE_BUSY for everybody alike.
//
// Local baseline (DECIDED): m = 19 MiB, t = 2, p = 1. Production parameters and the queue limits below are PENDING (P-6b:
// benchmark on deployment hardware); the queue values are local defaults only.

const ARGON2ID = 2; // Algorithm.Argon2id (declared as an ambient const enum by the library)

export const LOCAL_ARGON2_OPTIONS: Readonly<Options> = Object.freeze({
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

export interface HashQueueOptions {
  readonly maxConcurrent: number;
  readonly maxQueued: number;
  readonly queueTimeoutMs: number;
}

export const LOCAL_QUEUE_OPTIONS: HashQueueOptions = Object.freeze({ maxConcurrent: 4, maxQueued: 64, queueTimeoutMs: 10_000 });

export class HashQueueBusyError extends Error {
  constructor() {
    super('password hashing capacity exhausted');
    this.name = 'HashQueueBusyError';
  }
}

interface Waiter {
  readonly start: () => void;
  readonly timer: NodeJS.Timeout;
}

export class PasswordHasher {
  private readonly options: Readonly<Options>;
  private readonly queue: HashQueueOptions;
  private running = 0;
  private readonly waiting: Waiter[] = [];
  private dummyHash: string | undefined;

  constructor(options: Readonly<Options> = LOCAL_ARGON2_OPTIONS, queue: HashQueueOptions = LOCAL_QUEUE_OPTIONS) {
    this.options = options;
    this.queue = queue;
  }

  // The dummy hash uses the same parameters as real hashes, from a random secret that is never stored (P-5).
  async init(): Promise<void> {
    this.dummyHash ??= await hash(randomBytes(32).toString('base64url'), this.options);
  }

  async hashPassword(password: string): Promise<string> {
    return this.run(() => hash(password, this.options));
  }

  // Exactly one Argon2id verification. `stored === null` verifies against the dummy hash and always returns false.
  async verifyPassword(stored: string | null, password: string): Promise<boolean> {
    const dummy = this.dummyHash;
    if (dummy === undefined) throw new Error('PasswordHasher.init() was not awaited');
    return this.run(async () => {
      try {
        const match = await verify(stored ?? dummy, password);
        return stored !== null && match;
      } catch {
        return false; // malformed stored hash: treated as a mismatch, never as an error the caller could observe
      }
    });
  }

  get stats(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        this.running++;
        task().then(resolve, reject).finally(() => {
          this.running--;
          this.next();
        });
      };
      if (this.running < this.queue.maxConcurrent) return execute();
      if (this.waiting.length >= this.queue.maxQueued) return reject(new HashQueueBusyError());
      const waiter: Waiter = {
        start: execute,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new HashQueueBusyError());
        }, this.queue.queueTimeoutMs),
      };
      this.waiting.push(waiter);
    });
  }

  private next(): void {
    const waiter = this.waiting.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    waiter.start();
  }
}
