import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Y from "yjs";
import { DocRepository } from "./doc-repository.service";
import { LexicalExtractService } from "./lexical-extract.service";
import { CompactionService } from "../compaction/compaction.service";
import { createLogger } from "../logger";
import type { Env } from "../config/env";
import type { RtcClaims } from "../tokens/tokens.service";

const log = createLogger("ws");
const persistLog = createLogger("persist");
const contentLog = createLogger("content");

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
};

function nodeText(node: unknown): string {
  const n = node as { text?: string; children?: unknown[] };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.children)) return n.children.map(nodeText).join("");
  return "";
}

function summarizeBlocks(lexicalJson: string | null): string {
  if (!lexicalJson) return "(null)";
  try {
    const root = (JSON.parse(lexicalJson) as { root?: { children?: unknown[] } })
      .root;
    const children = root?.children ?? [];
    const parts = children.map((c, i) => {
      const node = c as { type?: string; tag?: string };
      const kind = node.tag ? `${node.type}(${node.tag})` : node.type;
      return `#${i} ${kind}:${JSON.stringify(nodeText(c))}`;
    });
    return `${children.length} block(s) [ ${parts.join(" | ")} ]`;
  } catch (e) {
    return `(parse-failed: ${e instanceof Error ? e.message : e})`;
  }
}

@Injectable()
export class DocStateService {
  private readonly docState = new Map<
    string,
    { ydoc: Y.Doc; state: DebounceState }
  >();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly wsToClaims = new WeakMap<object, RtcClaims>();

  constructor(
    private readonly repo: DocRepository,
    private readonly extract: LexicalExtractService,
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
    const chain = this.chains.get(docId);
    if (chain) await chain;
  }

  async bindState(docName: string, ydoc: Y.Doc): Promise<void> {
    persistLog.info(`'${docName}' bindState — cold-load`);
    await this.repo.ensureRtcDoc(docName);
    const row = await this.repo.getRtcDoc(docName);
    const snapshotAtSeq = row?.snapshotAtSeq ?? 0;

    if (row?.yjsState) {
      try {
        Y.applyUpdate(ydoc, new Uint8Array(row.yjsState));
        persistLog.info(
          `'${docName}' cold-loaded snapshot ${row.yjsState.byteLength}B at_seq=${snapshotAtSeq}`
        );
      } catch (e) {
        persistLog.error(`'${docName}' apply yjs_state FAILED`, e);
      }
    } else {
      persistLog.info(`'${docName}' no snapshot yet`);
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
      persistLog.info(
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
          persistLog.info(
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
      const blob = Buffer.from(update);
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
      this.armCheckpointTimer(docName);
      this.scheduleFlush(docName, "yDoc.update");
    });
  }

  private scheduleFlush(docName: string, reason: string): void {
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
        const update = Y.encodeStateAsUpdate(ydoc);
        const yjsState = Buffer.from(update);
        const { lexicalJson, plainText } = this.extract.extractFromBytes(update);
        const version = await this.repo.persistRtcDoc(
          docName,
          yjsState,
          lexicalJson,
          plainText
        );
        log.info(
          `'${docName}' flush done v${version} reason=${reason} yjs=${yjsState.byteLength}B json=${lexicalJson?.length ?? 0}B text=${plainText.length}ch in ${Date.now() - t0}ms`
        );
        contentLog.info(`'${docName}' v${version} ${summarizeBlocks(lexicalJson)}`);
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
      persistLog.info(
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
    persistLog.info(`'${docName}' writeState — final flush + checkpoint + compaction`);
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
