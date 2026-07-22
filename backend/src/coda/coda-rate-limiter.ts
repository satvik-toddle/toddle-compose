import { Injectable } from "@nestjs/common";

// Content-write pacer for the Coda API (H1). Coda enforces content writes at
// 5 req / 10s PER USER across all docs, reads at 100 / 6s. Each API token is a
// distinct Coda user, so the limiter is keyed by token IDENTITY: every distinct
// token gets its own independent bucket, created lazily. Given a SET of a
// destination's tokens, an acquire picks whichever is free soonest and records
// against it, so N tokens ≈ N× throughput. Published numbers are treated as a
// FLOOR — a 429/Retry-After dynamically parks the offending token past the
// server-supplied time (adaptive backoff), which naturally reroutes a pooled
// retry to a token that isn't cooling down.

// Coda's documented content-write ceiling (the binding constraint for imports).
export const WRITE_LIMIT = 5;
export const WRITE_WINDOW_MS = 10_000;
// Read ceiling; far more generous, but still paced so a big ancestor-walk (H6)
// can't burst past it.
export const READ_LIMIT = 100;
export const READ_WINDOW_MS = 6_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.max(0, ms)));

// A single token's sliding-window bucket plus an adaptive cooldown floor.
export class TokenBucket {
  private hits: number[] = [];
  // Absolute time (ms) before which this token must not be used (from 429s).
  private cooldownUntil = 0;

  constructor(
    readonly token: string,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private prune(now: number): void {
    if (this.hits.length === 0) return;
    const cutoff = now - this.windowMs;
    this.hits = this.hits.filter((t) => t > cutoff);
  }

  // Recent-hit count within the sliding window (used as the load metric).
  load(now: number): number {
    this.prune(now);
    return this.hits.length;
  }

  // Earliest absolute time this token may next be used: the later of window
  // capacity freeing up and any adaptive cooldown.
  availableAt(now: number): number {
    this.prune(now);
    const capacityAt =
      this.hits.length < this.limit ? now : this.hits[0] + this.windowMs;
    return Math.max(capacityAt, this.cooldownUntil);
  }

  record(now: number): void {
    this.hits.push(now);
  }

  // Park this token until at least `until` (ms). Never shortens an existing cooldown.
  penalizeUntil(until: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, until);
  }
}

// Per-token bucket registry (buckets created on demand) with a serialized
// acquire loop. Acquisitions are chained so concurrent callers reserve distinct
// slots instead of racing for the same one.
export class BucketRegistry {
  private readonly buckets = new Map<string, TokenBucket>();
  private gate: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private bucket(token: string): TokenBucket {
    let b = this.buckets.get(token);
    if (!b) {
      b = new TokenBucket(token, this.limit, this.windowMs);
      this.buckets.set(token, b);
    }
    return b;
  }

  // Resolve to the token to use, blocking until some token in the set has
  // capacity. Picks the bucket free soonest, tie-broken by least load (spreads
  // work across the pool). A single-element set degrades to per-token pacing.
  async acquire(tokens: string[]): Promise<string> {
    if (tokens.length === 0) throw new Error("Coda token pool is empty");
    for (;;) {
      const result = await this.serialize(() => this.tryReserve(tokens));
      if (result.token !== undefined) return result.token;
      // Wait OUTSIDE the gate: a saturated pool must not stall reservations for
      // a different destination whose tokens are free (no cross-pool HOL block).
      await sleep(result.waitMs);
    }
  }

  // Run `fn` as the sole current link of the gate chain — serializes the
  // synchronous select-and-record so concurrent callers reserve distinct slots.
  private serialize<T>(fn: () => T): Promise<T> {
    const result = this.gate.then(fn);
    this.gate = result.catch(() => undefined);
    return result;
  }

  // Synchronous critical section (NO await): either records a slot on a free
  // bucket and returns its token, or reports the min wait until one frees.
  private tryReserve(
    tokens: string[],
  ): { token: string; waitMs?: undefined } | { token?: undefined; waitMs: number } {
    const buckets = tokens.map((t) => this.bucket(t));
    const now = Date.now();
    let best = buckets[0];
    let bestAt = best.availableAt(now);
    for (const b of buckets) {
      const at = b.availableAt(now);
      if (at < bestAt || (at === bestAt && b.load(now) < best.load(now))) {
        best = b;
        bestAt = at;
      }
    }
    if (bestAt <= now) {
      best.record(now);
      return { token: best.token };
    }
    return { waitMs: bestAt - now };
  }

  penalize(token: string, until: number): void {
    this.bucket(token).penalizeUntil(until);
  }
}

@Injectable()
export class CodaRateLimiter {
  // Independent registries: content writes and reads have separate ceilings.
  private readonly writeReg = new BucketRegistry(WRITE_LIMIT, WRITE_WINDOW_MS);
  private readonly readReg = new BucketRegistry(READ_LIMIT, READ_WINDOW_MS);

  // Block until a token in the pool has write capacity; returns the chosen token.
  acquireWriteFromPool(tokens: string[]): Promise<string> {
    return this.writeReg.acquire(tokens);
  }

  acquireReadFromPool(tokens: string[]): Promise<string> {
    return this.readReg.acquire(tokens);
  }

  // Adaptive backoff: park a token for `retryAfterMs` after a 429/503 (H1 floor).
  penalizeWrite(token: string, retryAfterMs: number): void {
    this.writeReg.penalize(token, Date.now() + retryAfterMs);
  }

  penalizeRead(token: string, retryAfterMs: number): void {
    this.readReg.penalize(token, Date.now() + retryAfterMs);
  }
}
