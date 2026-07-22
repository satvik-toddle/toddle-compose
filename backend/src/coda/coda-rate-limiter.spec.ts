import { BucketRegistry, CodaRateLimiter } from "./coda-rate-limiter";

// Small windows keep the timing-based assertions fast and deterministic.
const elapsed = async (fn: () => Promise<unknown>): Promise<number> => {
  const t0 = Date.now();
  await fn();
  return Date.now() - t0;
};

describe("BucketRegistry", () => {
  it("serves up to the limit immediately, then queues until the window frees", async () => {
    const limit = 3;
    const windowMs = 200;
    const reg = new BucketRegistry(limit, windowMs);

    const firstBatch = await elapsed(async () => {
      for (let i = 0; i < limit; i++) await reg.acquire(["t1"]);
    });
    expect(firstBatch).toBeLessThan(50);

    // The (limit+1)th must wait for the oldest hit to exit the window.
    const fourth = await elapsed(() => reg.acquire(["t1"]));
    expect(fourth).toBeGreaterThanOrEqual(windowMs - 40);
  });

  it("distributes across a multi-token pool (least-loaded first)", async () => {
    const reg = new BucketRegistry(5, 10_000);
    const picks: string[] = [];
    for (let i = 0; i < 4; i++) picks.push(await reg.acquire(["a", "b"]));

    // With 2 idle tokens, load spreads evenly rather than saturating one.
    expect(picks.filter((t) => t === "a").length).toBe(2);
    expect(picks.filter((t) => t === "b").length).toBe(2);
  });

  it("routes around a saturated token to a free one in the pool", async () => {
    const reg = new BucketRegistry(1, 10_000);
    // Saturate "a" (limit 1); a pool acquire should then pick "b" immediately.
    await reg.acquire(["a"]);
    const ms = await elapsed(async () => {
      const picked = await reg.acquire(["a", "b"]);
      expect(picked).toBe("b");
    });
    expect(ms).toBeLessThan(50);
  });

  it("queues when ALL pool tokens are saturated, until one frees", async () => {
    const windowMs = 180;
    const reg = new BucketRegistry(1, windowMs);
    await reg.acquire(["a"]);
    await reg.acquire(["b"]);
    // Both full → next acquire waits ~windowMs for the earliest to free.
    const ms = await elapsed(() => reg.acquire(["a", "b"]));
    expect(ms).toBeGreaterThanOrEqual(windowMs - 40);
  });

  it("isolates a per-token Retry-After penalty to that token", async () => {
    const reg = new BucketRegistry(5, 10_000);
    const penaltyMs = 150;
    reg.penalize("a", Date.now() + penaltyMs);

    // Pool prefers the un-penalized token immediately...
    const pooled = await elapsed(async () => {
      expect(await reg.acquire(["a", "b"])).toBe("b");
    });
    expect(pooled).toBeLessThan(50);

    // ...but a single-token acquire on the penalized token must wait it out.
    const solo = await elapsed(() => reg.acquire(["a"]));
    expect(solo).toBeGreaterThanOrEqual(penaltyMs - 40);
  });

  it("does not stall a free pool behind a saturated disjoint pool (no cross-pool HOL)", async () => {
    const windowMs = 300;
    const reg = new BucketRegistry(1, windowMs);
    // Pre-saturate destination A's token; destination B's token is free.
    await reg.acquire(["a"]);

    // A's next acquire sleeps ~windowMs waiting for its window to free. Enqueue
    // it FIRST, then B — B must not wait behind A's sleep (would with the gate
    // held across sleep; ~windowMs under the bug, ~0 once waiting is outside it).
    const aPromise = reg.acquire(["a"]);
    const bMs = await elapsed(async () => {
      expect(await reg.acquire(["b"])).toBe("b");
    });
    expect(bMs).toBeLessThan(100);

    // A still completes correctly once its window frees.
    expect(await aPromise).toBe("a");
  });

  it("rejects an empty pool", async () => {
    const reg = new BucketRegistry(5, 10_000);
    await expect(reg.acquire([])).rejects.toThrow(/empty/i);
  });

  it("serializes concurrent acquires into distinct slots", async () => {
    const reg = new BucketRegistry(2, 150);
    const t0 = Date.now();
    // 4 concurrent acquires on one token, capacity 2 per 150ms → last pair waits.
    const times = await Promise.all(
      [0, 1, 2, 3].map(() => reg.acquire(["x"]).then(() => Date.now() - t0)),
    );
    times.sort((a, b) => a - b);
    expect(times[0]).toBeLessThan(50);
    expect(times[1]).toBeLessThan(50);
    expect(times[2]).toBeGreaterThanOrEqual(110);
    expect(times[3]).toBeGreaterThanOrEqual(110);
  });
});

describe("CodaRateLimiter", () => {
  it("keeps write and read ceilings independent", async () => {
    const limiter = new CodaRateLimiter();
    // Park a token's WRITE bucket; its READ bucket must be unaffected.
    limiter.penalizeWrite("tok", 10_000);
    const ms = await elapsed(() => limiter.acquireReadFromPool(["tok"]));
    expect(ms).toBeLessThan(50);
  });

  it("distributes writes across a destination's token pool", async () => {
    const limiter = new CodaRateLimiter();
    const picks: string[] = [];
    for (let i = 0; i < 4; i++) {
      picks.push(await limiter.acquireWriteFromPool(["a", "b"]));
    }
    expect(picks.filter((t) => t === "a").length).toBe(2);
    expect(picks.filter((t) => t === "b").length).toBe(2);
  });

  it("reroutes a penalized write token within the pool", async () => {
    const limiter = new CodaRateLimiter();
    limiter.penalizeWrite("a", 10_000);
    expect(await limiter.acquireWriteFromPool(["a", "b"])).toBe("b");
  });
});
