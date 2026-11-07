/** Fixed-window counter per key (usually the caller's IP). In-memory: one server process. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Records one attempt and returns false once the key is over its limit. */
  take(key: string): boolean {
    const t = this.now();
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= t) {
      if (this.windows.size > 10_000) this.prune(t);
      entry = { count: 0, resetAt: t + this.windowMs };
      this.windows.set(key, entry);
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  private prune(t: number) {
    for (const [key, entry] of this.windows) if (entry.resetAt <= t) this.windows.delete(key);
  }
}
