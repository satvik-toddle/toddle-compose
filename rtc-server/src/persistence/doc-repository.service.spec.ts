import { DocRepository } from "./doc-repository.service";

const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

describe("DocRepository.ensureRtcDoc", () => {
  it("swallows P2002 — a concurrent ensure already created the row (idempotent)", async () => {
    const upsert = jest.fn().mockRejectedValue(p2002());
    const repo = new DocRepository({ rtcDocument: { upsert } } as never);
    await expect(repo.ensureRtcDoc("d1")).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-P2002 errors (never masks a real failure)", async () => {
    const upsert = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error("db down"), { code: "P1001" }));
    const repo = new DocRepository({ rtcDocument: { upsert } } as never);
    await expect(repo.ensureRtcDoc("d1")).rejects.toThrow("db down");
  });
});

describe("DocRepository.appendDocUpdate", () => {
  // A $transaction mock that runs the callback against a fake tx whose create can be
  // scripted to throw per-attempt (simulating a concurrent writer taking the seq).
  function makeRepo(maxSeqSequence: (number | null)[], createBehaviors: ("ok" | "p2002")[]) {
    let call = 0;
    const $transaction = jest.fn(async (fn: (tx: unknown) => unknown) => {
      const idx = call++;
      const tx = {
        rtcDocumentUpdate: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _max: { seq: maxSeqSequence[idx] ?? null } }),
          create: jest.fn(async () => {
            if (createBehaviors[idx] === "p2002") throw p2002();
            return {};
          }),
        },
      };
      return fn(tx);
    });
    const repo = new DocRepository({ $transaction } as never);
    return { repo, $transaction };
  }

  it("serial path: returns max(seq)+1 in a single attempt", async () => {
    const { repo, $transaction } = makeRepo([4], ["ok"]);
    await expect(
      repo.appendDocUpdate("d1", Buffer.from([1, 2, 3]), "http-apply", null)
    ).resolves.toBe(5);
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("retries on a (docId,seq) P2002 and converges once the racing writer commits", async () => {
    // Attempt 1 sees max=0 → seq=1 but another writer already took seq=1 (P2002);
    // attempt 2 re-reads max=1 → seq=2 and succeeds.
    const { repo, $transaction } = makeRepo([0, 1], ["p2002", "ok"]);
    await expect(
      repo.appendDocUpdate("d1", Buffer.from([1]), "cold-load-seed", null)
    ).resolves.toBe(2);
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("gives up after the bounded attempt cap (does not loop forever)", async () => {
    const { repo, $transaction } = makeRepo(
      [0, 0, 0, 0, 0],
      ["p2002", "p2002", "p2002", "p2002", "p2002"]
    );
    await expect(
      repo.appendDocUpdate("d1", Buffer.from([1]), "http-apply", null)
    ).rejects.toMatchObject({ code: "P2002" });
    expect($transaction).toHaveBeenCalledTimes(5);
  });
});
