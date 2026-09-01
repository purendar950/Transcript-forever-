interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Fixed-window limiter keyed by client IP, scoped to a single isolate. */
export class RateLimiter {
  #windows = new Map<string, Window>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    const existing = this.#windows.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.#windows.set(key, { count: 1, resetAt });
      this.#sweep(now);
      return { allowed: true, remaining: this.limit - 1, resetAt };
    }

    existing.count += 1;
    return {
      allowed: existing.count <= this.limit,
      remaining: Math.max(this.limit - existing.count, 0),
      resetAt: existing.resetAt,
    };
  }

  #sweep(now: number): void {
    if (this.#windows.size < 5_000) return;
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= now) this.#windows.delete(key);
    }
  }
}
