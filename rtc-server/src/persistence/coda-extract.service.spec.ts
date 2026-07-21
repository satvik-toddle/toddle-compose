import * as Y from "yjs";
import { CodaExtractService } from "./coda-extract.service";

// Minimal fakes for the two collaborators the reconstruction path touches.
type RepoRow = { yjsState: Buffer | null; snapshotAtSeq: number } | null;

function makeService(opts: {
  head: number;
  row?: RepoRow;
  tail?: { seq: number; blob: Buffer }[];
}) {
  const forceCheckpoint = jest.fn().mockResolvedValue(false);
  const repo = {
    getHeadSeq: jest.fn().mockResolvedValue(opts.head),
    getRtcDoc: jest.fn().mockResolvedValue(opts.row ?? null),
    getDocUpdateBlobsAfterSeq: jest.fn().mockResolvedValue(opts.tail ?? []),
  };
  const docState = { forceCheckpoint };
  const config = { get: jest.fn().mockReturnValue(30_000) };
  const service = new CodaExtractService(
    repo as never,
    docState as never,
    config as never
  );
  return { service, repo, forceCheckpoint };
}

describe("CodaExtractService.reconstructState", () => {
  it("head===0 => empty ydoc, headSeq 0 (never-initialized doc)", async () => {
    const { service, repo } = makeService({ head: 0 });
    const { ydoc, headSeq } = await service.reconstructState("d1");
    expect(headSeq).toBe(0);
    expect(repo.getRtcDoc).not.toHaveBeenCalled();
    expect(ydoc.getMap("m").size).toBe(0);
  });

  it("applies the snapshot AND replays the tail beyond it (C1)", async () => {
    const snapDoc = new Y.Doc();
    snapDoc.getMap("m").set("a", 1);
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(snapDoc));

    const tailDoc = new Y.Doc();
    Y.applyUpdate(tailDoc, snapshot);
    let tail: Uint8Array = new Uint8Array();
    tailDoc.on("update", (u: Uint8Array) => (tail = u));
    tailDoc.getMap("m").set("b", 2);

    const { service } = makeService({
      head: 3,
      row: { yjsState: snapshot, snapshotAtSeq: 2 },
      tail: [{ seq: 3, blob: Buffer.from(tail) }],
    });

    const { ydoc, headSeq } = await service.reconstructState("d1");
    expect(headSeq).toBe(3);
    // Snapshot content present...
    expect(ydoc.getMap("m").get("a")).toBe(1);
    // ...and the tail beyond the snapshot replayed on top.
    expect(ydoc.getMap("m").get("b")).toBe(2);
  });

  it("ignores tail rows past the captured head seq", async () => {
    const base = new Y.Doc();
    base.getMap("m").set("a", 1);
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(base));

    const d = new Y.Doc();
    Y.applyUpdate(d, snapshot);
    let future: Uint8Array = new Uint8Array();
    d.on("update", (u: Uint8Array) => (future = u));
    d.getMap("m").set("late", 9);

    const { service } = makeService({
      head: 2,
      row: { yjsState: snapshot, snapshotAtSeq: 2 },
      // A row that landed after our head read must not be applied.
      tail: [{ seq: 3, blob: Buffer.from(future) }],
    });
    const { ydoc, headSeq } = await service.reconstructState("d1");
    expect(headSeq).toBe(2);
    expect(ydoc.getMap("m").get("late")).toBeUndefined();
  });

  // A cold doc (no snapshot) with three logged edits; atSeq selects the point-in-time slice.
  function threeEditDoc() {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u));
    doc.getMap("m").set("a", 1);
    doc.getMap("m").set("b", 2);
    doc.getMap("m").set("c", 3);
    return [
      { seq: 1, blob: Buffer.from(updates[0]) },
      { seq: 2, blob: Buffer.from(updates[1]) },
      { seq: 3, blob: Buffer.from(updates[2]) },
    ];
  }

  it("reconstructs UP TO atSeq — edits after atSeq are absent", async () => {
    const { service } = makeService({ head: 3, tail: threeEditDoc() });
    const { ydoc, headSeq } = await service.reconstructState("d1", 2);
    expect(headSeq).toBe(2);
    expect(ydoc.getMap("m").get("a")).toBe(1);
    expect(ydoc.getMap("m").get("b")).toBe(2);
    // The seq-3 edit is beyond the ceiling and must not appear.
    expect(ydoc.getMap("m").get("c")).toBeUndefined();
  });

  it("no atSeq → reconstructs the latest head (all edits present)", async () => {
    const { service } = makeService({ head: 3, tail: threeEditDoc() });
    const { ydoc, headSeq } = await service.reconstructState("d1");
    expect(headSeq).toBe(3);
    expect(ydoc.getMap("m").get("c")).toBe(3);
  });

  it("atSeq beyond head clamps to head (== latest)", async () => {
    const { service } = makeService({ head: 3, tail: threeEditDoc() });
    const { ydoc, headSeq } = await service.reconstructState("d1", 99);
    expect(headSeq).toBe(3);
    expect(ydoc.getMap("m").get("c")).toBe(3);
  });

  it("atSeq below the snapshot baseline clamps up to it (compaction)", async () => {
    const snapDoc = new Y.Doc();
    snapDoc.getMap("m").set("a", 1);
    snapDoc.getMap("m").set("b", 2);
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(snapDoc));
    const { service } = makeService({
      head: 2,
      row: { yjsState: snapshot, snapshotAtSeq: 2 },
    });
    // atSeq=1 is below the merged snapshot baseline (seq 2) — can't be replayed exactly, so
    // it clamps up to the snapshot and reports headSeq=2.
    const { ydoc, headSeq } = await service.reconstructState("d1", 1);
    expect(headSeq).toBe(2);
    expect(ydoc.getMap("m").get("a")).toBe(1);
    expect(ydoc.getMap("m").get("b")).toBe(2);
  });
});

describe("CodaExtractService.extractHtml", () => {
  it("skips extraction for an empty/never-initialized doc (D7)", async () => {
    const { service, forceCheckpoint } = makeService({ head: 0 });
    const res = await service.extractHtml("d1");
    expect(res).toEqual({ docId: "d1", html: "", headSeq: 0, isEmpty: true });
    // Warm-doc flush is always attempted first (D3).
    expect(forceCheckpoint).toHaveBeenCalledWith("d1", "coda-export");
  });
});
