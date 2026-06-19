import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Y from "yjs";
import { docs as ywsDocs, getYDoc } from "y-websocket/bin/utils";
import { buildOpsUpdate, type ContentOp } from "../content/content-builder";
import { DocRepository } from "./doc-repository.service";
import { CompactionService } from "../compaction/compaction.service";
import { createLogger } from "../logger";
import type { Env } from "../config/env";
import type { RtcClaims } from "../tokens/tokens.service";

const log = createLogger("ws");
const persistLog = createLogger("persist");
const captureLog = createLogger("capture");

type DebounceState = {
  idleTimer: NodeJS.Timeout | null;
  maxTimer: NodeJS.Timeout | null;
  dirty: boolean;
  flushing: Promise<void> | null;
  dirtyAt: number | null;
  updates: number;
  bytesIn: number;
  checkpointTimer: NodeJS.Timeout | null;
  snapshotAtSeq: number;
  lastAppendedSeq: number;
  pendingAppend: PendingAppend | null;
};

// Coalescing buffer: only same-(originDesc, clientSub) updates merge, so each log row stays attributable to one client.
type PendingAppend = {
  blobs: Buffer[];
  bytes: number;
  originDesc: string;
  clientSub: string | null;
  timer: NodeJS.Timeout | null;
};

// Bounds force an early append so a paste-storm can't buffer unbounded bytes in memory.
const APPEND_COALESCE_MAX_UPDATES = 200;
const APPEND_COALESCE_MAX_BYTES = 256 * 1024;

@Injectable()
export class DocStateService {
  private readonly docState = new Map<
    string,
    { ydoc: Y.Doc; state: DebounceState }
  >();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly wsToClaims = new WeakMap<object, RtcClaims>();
  // In-flight cold-load per doc, so applyUpdate can await load before mutating.
  private readonly loading = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: DocRepository,
    private readonly compaction: CompactionService,
    private readonly config: ConfigService<Env, true>
  ) {}

  private env<K extends keyof Env>(k: K): Env[K] {
    return this.config.get(k, { infer: true });
  }

  registerClaims(ws: object, claims: RtcClaims): void {
    this.wsToClaims.set(ws, claims);
  }

  private enqueue<T>(docId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(docId) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.chains.set(
      docId,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next as Promise<T>;
  }

  private async drain(docId: string): Promise<void> {
    // Buffer must reach the chain first, or flush/checkpoint records a snapshotAtSeq that excludes it.
    this.flushPendingAppend(docId);
    const chain = this.chains.get(docId);
    if (chain) await chain;
  }

  // y-websocket persistence hook. Tracks the load promise so applyUpdate (and any
  // out-of-WS caller) can await the cold-load before mutating a freshly-warmed doc.
  bindState(docName: string, ydoc: Y.Doc): Promise<void> {
    const p = this.loadState(docName, ydoc);
    this.loading.set(docName, p);
    void p
      .catch(() => undefined)
      .finally(() => {
        if (this.loading.get(docName) === p) this.loading.delete(docName);
      });
    return p;
  }

  /** Resolves once the doc's cold-load (if any) has finished. */
  whenLoaded(docName: string): Promise<void> {
    return (this.loading.get(docName) ?? Promise.resolve()).catch(() => undefined);
  }

  // Run `fn` against a doc's single in-memory shared Y.Doc whether or not it's
  // open. Routes through getYDoc so it's race-safe with a client connecting
  // mid-op: changes persist via the update pipeline and broadcast to live
  // editors. If we warmed the doc just for this, flush and evict it afterward.
  private async withWarmDoc<T>(
    docId: string,
    fn: (ydoc: Y.Doc) => T | Promise<T>
  ): Promise<T> {
    const wasLive = ywsDocs.has(docId);
    const ydoc = getYDoc(docId, true);
    await this.whenLoaded(docId);
    try {
      return await fn(ydoc);
    } finally {
      if (!wasLive) {
        const shared = ywsDocs.get(docId);
        // Only tear down if no client connected while we held it.
        if (shared && shared.conns.size === 0) {
          await this.drain(docId);
          await this.writeState(docId);
          if (ywsDocs.get(docId) === shared && shared.conns.size === 0) {
            ywsDocs.delete(docId);
            shared.destroy();
          }
        }
      }
    }
  }

  /** Apply a raw Yjs update (base64-decoded) to a doc. */
  applyUpdate(docId: string, update: Uint8Array, origin = "http-apply"): Promise<number> {
    return this.withWarmDoc(docId, (ydoc) => {
      Y.applyUpdate(ydoc, update, origin);
      return update.byteLength;
    });
  }

  // Apply high-level content ops: build a delta off the doc's current state via
  // the headless Lexical↔Yjs binding, then merge it in (persist + broadcast).
  //
  // Additive-safety guard: destructive ops (`clear`) racing with a live editor
  // can corrupt the doc (the clear's deletions conflict with the client's state
  // and can resolve to empty). Append ops are CRDT-safe and merge cleanly, so we
  // only block destructive ops while someone has the doc open — AI edits stay
  // additive for live users.
  editDoc(docId: string, ops: ContentOp[]): Promise<number> {
    const destructive = ops.filter((o) => o.op === "clear");
    if (destructive.length > 0) {
      const shared = ywsDocs.get(docId);
      const liveConns = shared ? shared.conns.size : 0;
      if (liveConns > 0) {
        return Promise.reject(
          new Error(
            `refusing destructive op '${destructive[0].op}' while ${liveConns} ` +
              `editor(s) have this doc open — AI edits must be additive. Drop the ` +
              `clear (append instead) or retry when the doc is idle.`
          )
        );
      }
    }
    return this.withWarmDoc(docId, (ydoc) => {
      const base = Y.encodeStateAsUpdate(ydoc);
      const delta = buildOpsUpdate(base, ops);
      Y.applyUpdate(ydoc, delta, "content-builder");
      return delta.byteLength;
    });
  }

  private async loadState(docName: string, ydoc: Y.Doc): Promise<void> {
    persistLog.debug(`'${docName}' bindState — cold-load`);
    await this.repo.ensureRtcDoc(docName);
    const row = await this.repo.getRtcDoc(docName);
    const snapshotAtSeq = row?.snapshotAtSeq ?? 0;

    if (row?.yjsState) {
      try {
        Y.applyUpdate(ydoc, new Uint8Array(row.yjsState));
        persistLog.debug(
          `'${docName}' cold-loaded snapshot ${row.yjsState.byteLength}B at_seq=${snapshotAtSeq}`
        );
      } catch (e) {
        persistLog.error(`'${docName}' apply yjs_state FAILED`, e);
      }
    } else {
      persistLog.debug(`'${docName}' no snapshot yet`);
    }

    const head = await this.repo.getHeadSeq(docName);
    if (head > snapshotAtSeq) {
      const tail = await this.repo.getDocUpdateBlobsAfterSeq(
        docName,
        snapshotAtSeq
      );
      let applied = 0;
      for (const { blob } of tail) {
        try {
          Y.applyUpdate(ydoc, new Uint8Array(blob));
          applied += 1;
        } catch (e) {
          persistLog.error(`'${docName}' tail-apply FAILED`, e);
        }
      }
      persistLog.debug(
        `'${docName}' replayed ${applied}/${tail.length} tail updates seq=${snapshotAtSeq + 1}..${head}`
      );
    }

    if (head === 0) {
      const baseUpdate = Buffer.from(Y.encodeStateAsUpdate(ydoc));
      if (baseUpdate.byteLength > 2) {
        try {
          const seq = await this.repo.appendDocUpdate(
            docName,
            baseUpdate,
            "cold-load-seed",
            null
          );
          persistLog.debug(
            `'${docName}' seeded history seq=${seq} with ${baseUpdate.byteLength}B baseline`
          );
        } catch (e) {
          persistLog.error(`'${docName}' seed-on-bindState FAILED`, e);
        }
      }
    }

    const lastSeq = await this.repo.getHeadSeq(docName);
    this.docState.set(docName, {
      ydoc,
      state: {
        idleTimer: null,
        maxTimer: null,
        dirty: false,
        flushing: null,
        dirtyAt: null,
        updates: 0,
        bytesIn: 0,
        checkpointTimer: null,
        snapshotAtSeq,
        lastAppendedSeq: lastSeq,
        pendingAppend: null,
      },
    });

    ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      const entry = this.docState.get(docName);
      if (entry) {
        entry.state.updates += 1;
        entry.state.bytesIn += update.byteLength;
      }
      const originDesc =
        origin == null
          ? "null"
          : typeof origin === "string"
            ? origin
            : (origin?.constructor?.name ?? typeof origin);
      let clientSub: string | null = null;
      if (origin && typeof origin === "object") {
        const claims = this.wsToClaims.get(origin);
        if (claims) clientSub = claims.sub;
      }
      if (this.env("RTC_CAPTURE_UPDATES")) {
        captureLog.info(
          `docId=${docName} origin=${originDesc} sub=${clientSub ?? "-"} bytes=${update.byteLength} b64=${Buffer.from(update).toString("base64")}`
        );
      }
      this.bufferAppend(docName, Buffer.from(update), originDesc, clientSub);
      this.armCheckpointTimer(docName);
      this.scheduleFlush(docName, "yDoc.update");
    });
  }

  // Coalesce updates per (doc, author) for RTC_APPEND_COALESCE_MS into one row, else typing means one tx per keystroke.
  private bufferAppend(
    docName: string,
    blob: Buffer,
    originDesc: string,
    clientSub: string | null
  ): void {
    const entry = this.docState.get(docName);
    if (!entry) {
      // Doc evicted mid-flight: nothing to coalesce against.
      this.enqueueAppend(docName, blob, originDesc, clientSub);
      return;
    }
    const { state } = entry;
    if (
      state.pendingAppend &&
      (state.pendingAppend.originDesc !== originDesc ||
        state.pendingAppend.clientSub !== clientSub)
    ) {
      // Author/origin changed: flush so rows stay attributable per client.
      this.flushPendingAppend(docName);
    }
    const pending =
      state.pendingAppend ??
      (state.pendingAppend = {
        blobs: [],
        bytes: 0,
        originDesc,
        clientSub,
        timer: null,
      });
    pending.blobs.push(blob);
    pending.bytes += blob.byteLength;
    if (
      pending.blobs.length >= APPEND_COALESCE_MAX_UPDATES ||
      pending.bytes >= APPEND_COALESCE_MAX_BYTES
    ) {
      this.flushPendingAppend(docName);
    } else if (!pending.timer) {
      pending.timer = setTimeout(() => {
        pending.timer = null;
        this.flushPendingAppend(docName);
      }, this.env("RTC_APPEND_COALESCE_MS"));
    }
  }

  private flushPendingAppend(docName: string): void {
    const entry = this.docState.get(docName);
    const pending = entry?.state.pendingAppend;
    if (!entry || !pending || pending.blobs.length === 0) return;
    entry.state.pendingAppend = null;
    if (pending.timer) clearTimeout(pending.timer);
    const merged =
      pending.blobs.length === 1
        ? pending.blobs[0]
        : Buffer.from(
            Y.mergeUpdates(pending.blobs.map((b) => new Uint8Array(b)))
          );
    this.enqueueAppend(docName, merged, pending.originDesc, pending.clientSub);
  }

  private enqueueAppend(
    docName: string,
    blob: Buffer,
    originDesc: string,
    clientSub: string | null
  ): void {
    void this.enqueue(docName, async () => {
      try {
        const seq = await this.repo.appendDocUpdate(
          docName,
          blob,
          originDesc,
          clientSub
        );
        const e2 = this.docState.get(docName);
        if (e2) e2.state.lastAppendedSeq = seq;
      } catch (e) {
        log.error(`'${docName}' appendDocUpdate FAILED`, e);
      }
    });
  }

  private scheduleFlush(docName: string, _reason: string): void {
    const entry = this.docState.get(docName);
    if (!entry) return;
    const { state } = entry;
    state.dirty = true;
    if (state.dirtyAt == null) state.dirtyAt = Date.now();
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      void this.flush(docName, "idle");
    }, this.env("RTC_DEBOUNCE_IDLE_MS"));
    if (!state.maxTimer) {
      state.maxTimer = setTimeout(() => {
        void this.flush(docName, "max");
      }, this.env("RTC_DEBOUNCE_MAX_MS"));
    }
  }

  private async flush(docName: string, reason: string): Promise<void> {
    const entry = this.docState.get(docName);
    if (!entry) return;
    const { ydoc, state } = entry;
    if (state.flushing) return state.flushing;
    if (!state.dirty) return;

    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
    if (state.maxTimer) {
      clearTimeout(state.maxTimer);
      state.maxTimer = null;
    }

    const t0 = Date.now();
    const flushing = (async () => {
      try {
        state.dirty = false;
        state.dirtyAt = null;
        state.updates = 0;
        state.bytesIn = 0;
        await this.drain(docName);
        // Capture seq BEFORE encoding: snapshotAtSeq may lag state but must never exceed it, or compaction drops unsnapshotted updates.
        const flushedSeq = state.lastAppendedSeq;
        const update = Y.encodeStateAsUpdate(ydoc);
        const yjsState = Buffer.from(update);
        const version = await this.repo.persistRtcDoc(
          docName,
          yjsState,
          flushedSeq
        );
        state.snapshotAtSeq = flushedSeq;
        log.debug(
          `'${docName}' flush done v${version} reason=${reason} at_seq=${flushedSeq} yjs=${yjsState.byteLength}B in ${Date.now() - t0}ms`
        );
      } catch (e) {
        log.error(`'${docName}' flush FAILED`, e);
        state.dirty = true;
      }
    })();
    state.flushing = flushing;
    void flushing.finally(() => {
      if (state.flushing === flushing) state.flushing = null;
    });
    return flushing;
  }

  private armCheckpointTimer(docName: string): void {
    const entry = this.docState.get(docName);
    if (!entry) return;
    const { state } = entry;
    if (state.checkpointTimer) return;
    state.checkpointTimer = setTimeout(() => {
      state.checkpointTimer = null;
      void this.writeCheckpoint(docName, "interval");
    }, this.env("RTC_CHECKPOINT_INTERVAL_MS"));
  }

  private clearCheckpointTimer(docName: string): void {
    const entry = this.docState.get(docName);
    if (!entry) return;
    if (entry.state.checkpointTimer) {
      clearTimeout(entry.state.checkpointTimer);
      entry.state.checkpointTimer = null;
    }
  }

  private async writeCheckpoint(docName: string, reason: string): Promise<void> {
    const entry = this.docState.get(docName);
    if (!entry) return;
    const { ydoc, state } = entry;
    await this.drain(docName);
    if (state.lastAppendedSeq === state.snapshotAtSeq) return;
    try {
      const blob = Buffer.from(Y.encodeStateAsUpdate(ydoc));
      await this.repo.writeSnapshotCheckpoint(
        docName,
        blob,
        state.lastAppendedSeq
      );
      persistLog.debug(
        `'${docName}' checkpoint reason=${reason} → snapshot=${blob.byteLength}B at_seq=${state.lastAppendedSeq}`
      );
      state.snapshotAtSeq = state.lastAppendedSeq;
    } catch (e) {
      persistLog.error(`'${docName}' checkpoint FAILED reason=${reason}`, e);
    }
  }

  async forceCheckpoint(docName: string, reason: string): Promise<boolean> {
    const entry = this.docState.get(docName);
    if (!entry) {
      persistLog.warn(`forceCheckpoint('${docName}') — doc not warm`);
      return false;
    }
    await this.writeCheckpoint(docName, reason);
    return true;
  }

  async writeState(docName: string): Promise<void> {
    persistLog.debug(`'${docName}' writeState — final flush + checkpoint + compaction`);
    const entry = this.docState.get(docName);
    this.clearCheckpointTimer(docName);
    await this.writeCheckpoint(docName, "writeState");
    await this.flush(docName, "writeState");
    try {
      const stats = await this.compaction.runCompactionForDoc(docName);
      persistLog.debug(
        `'${docName}' on-disconnect compaction: t1=${stats.tier1SessionsMerged} t2=${stats.tier2Merged}`
      );
    } catch (e) {
      persistLog.error(`'${docName}' on-disconnect compaction FAILED`, e);
    }
    // Only evict if our entry is still live: a quick reconnect can run bindState concurrently and replace it.
    await this.drain(docName);
    if (entry && this.docState.get(docName) === entry) {
      this.clearAllTimers(entry.state);
      this.docState.delete(docName);
      this.chains.delete(docName);
      persistLog.debug(`'${docName}' evicted in-memory state`);
    } else if (this.docState.get(docName) !== entry) {
      persistLog.debug(`'${docName}' rebound during writeState — skip eviction`);
    }
  }

  private clearAllTimers(state: DebounceState): void {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
    if (state.maxTimer) {
      clearTimeout(state.maxTimer);
      state.maxTimer = null;
    }
    if (state.checkpointTimer) {
      clearTimeout(state.checkpointTimer);
      state.checkpointTimer = null;
    }
    if (state.pendingAppend?.timer) {
      clearTimeout(state.pendingAppend.timer);
      state.pendingAppend.timer = null;
    }
  }

  // Drop in-memory state WITHOUT flushing (doc being deleted); callers must tear down live connections first.
  async evictDocNoFlush(docName: string): Promise<void> {
    const entry = this.docState.get(docName);
    if (entry) {
      this.clearAllTimers(entry.state);
      entry.state.dirty = false;
      // Discard buffered updates: an append after the DB delete would re-create rows.
      entry.state.pendingAppend = null;
    }
    // Let in-flight appends settle so they can't land after the DB delete.
    await this.drain(docName);
    this.docState.delete(docName);
    this.chains.delete(docName);
    persistLog.debug(`'${docName}' evicted in-memory state (no flush)`);
  }

  async shutdownAndFlushAll(): Promise<void> {
    const ids = [...this.docState.keys()];
    log.info(`shutdown: checkpoint+flush ${ids.length} warm doc(s)`);
    for (const id of ids) {
      this.clearCheckpointTimer(id);
      await this.writeCheckpoint(id, "shutdown");
    }
    await Promise.all(ids.map((id) => this.flush(id, "shutdown")));
    log.info("shutdown flush complete");
  }
}
