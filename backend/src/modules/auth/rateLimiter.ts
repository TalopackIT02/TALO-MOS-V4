// In-memory sliding-window limiter per client IP (P-7 local: 60 login requests / 15 minutes / IP). Evaluated before
// validation and before any Argon2 work. Uses the monotonic clock: the limiter protects the process, it does not take
// account security decisions (those use database time). One process only; a multi-instance deployment needs a shared
// store (P-7 production values are PENDING).

export interface RateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys?: number;
  readonly now?: () => number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 100_000;
    this.now = options.now ?? (() => performance.now());
  }

  // Records the request and returns false when the key is over the limit.
  consume(key: string): boolean {
    const now = this.now();
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.sweep(since);
    return true;
  }

  private sweep(since: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= since)) this.hits.delete(key);
    }
  }
}

export const LOGIN_RATE_LIMIT = Object.freeze({ limit: 60, windowMs: 15 * 60 * 1000 });
