import { Injectable } from "@nestjs/common";
import { Worker } from "worker_threads";
import { join } from "path";
import * as Y from "yjs";
import { DocRepository } from "./doc-repository.service";
import { DocStateService } from "./doc-state.service";
import {
  extractCodaHtmlSync,
  type CodaExtractResult,
} from "./coda-extract.core";
import { createLogger } from "../logger";

const log = createLogger("coda-extract");

// Hard cap on one HTML extraction (large docs replay a long log + generate a big DOM).
const WORKER_TIMEOUT_MS = 30_000;

export type CodaHtmlExport = {
  docId: string;
  html: string;
  // Content cursor of the state actually reconstructed (design D1/D2): the latest head, or the
  // point-in-time atSeq when one was requested. The migration worker records exactly this.
  headSeq: number;
  // True for empty / null / never-initialized docs (head===0) or when extraction yields no content.
  // The backend skips these — it must never push a blank page (design D7).
  isEmpty: boolean;
};

@Injectable()
export class CodaExtractService {
  constructor(
    private readonly repo: DocRepository,
    private readonly docState: DocStateService
  ) {}

  // Returns constrained, sanitized HTML for a doc, ready to push to Coda. When atSeq is given,
  // reconstructs the point-in-time state UP TO that seq (D2) instead of the latest head.
  async extractHtml(
    docId: string,
    atSeq?: number
  ): Promise<CodaHtmlExport> {
    // Flush a warm doc first so the persisted snapshot+tail includes its buffered updates (D3);
    // no-op (returns false) for a cold doc, whose DB state is already authoritative.
    await this.docState.forceCheckpoint(docId, "coda-export").catch(() => false);

    const { ydoc, headSeq } = await this.reconstructState(docId, atSeq);
    // head===0 (or empty at/below atSeq) => never initialized / no content; skip the worker (D7).
    if (headSeq === 0) {
      return { docId, html: "", headSeq: 0, isEmpty: true };
    }

    const bytes = Y.encodeStateAsUpdate(ydoc);
    const { html, isEmpty } = await this.runWorker(bytes);
    return { docId, html: isEmpty ? "" : html, headSeq, isEmpty };
  }

  // Reconstruct Yjs state = persisted snapshot + replayed tail (mirror bindState); never the raw,
  // possibly-stale yjsState snapshot alone (C1). Without atSeq → latest head. With atSeq → replay
  // only tail rows with seq <= atSeq (reuses the "rows past the ceiling skipped" path), giving the
  // point-in-time state (D2). Returns the seq actually reconstructed as headSeq.
  async reconstructState(
    docId: string,
    atSeq?: number
  ): Promise<{ ydoc: Y.Doc; headSeq: number }> {
    const head = await this.repo.getHeadSeq(docId);
    const ydoc = new Y.Doc();
    if (head === 0) return { ydoc, headSeq: 0 };

    // Replay ceiling: absent atSeq => latest head; an atSeq beyond head clamps down to head (== latest).
    const ceiling = atSeq == null ? head : Math.max(0, Math.min(atSeq, head));

    const row = await this.repo.getRtcDoc(docId);
    const snapshotAtSeq = row?.snapshotAtSeq ?? 0;
    if (row?.yjsState) {
      try {
        Y.applyUpdate(ydoc, new Uint8Array(row.yjsState));
      } catch (e) {
        log.error(`'${docId}' apply snapshot FAILED`, e);
      }
    }
    // Compaction merges rows <= snapshotAtSeq, so a ceiling below the snapshot can't be replayed exactly — clamp up to the snapshot baseline (earliest still-reconstructable point).
    const effectiveSeq = Math.max(ceiling, snapshotAtSeq);
    if (effectiveSeq > snapshotAtSeq) {
      const tail = await this.repo.getDocUpdateBlobsAfterSeq(docId, snapshotAtSeq);
      for (const { seq, blob } of tail) {
        if (seq > effectiveSeq) continue;
        try {
          Y.applyUpdate(ydoc, new Uint8Array(blob));
        } catch (e) {
          log.error(`'${docId}' tail-apply FAILED seq=${seq}`, e);
        }
      }
    }
    return { ydoc, headSeq: effectiveSeq };
  }

  // Spawn a single-use worker per request, then terminate it (C6/C2 isolation). Fall back to inline
  // extraction only if the worker can't spawn/run, so a request never hangs.
  private runWorker(bytes: Uint8Array): Promise<CodaExtractResult> {
    return new Promise((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(join(__dirname, "coda-extract.worker.js"));
      } catch (e) {
        log.error("coda-extract worker spawn failed — inline fallback", e);
        resolve(extractCodaHtmlSync(bytes));
        return;
      }
      let settled = false;
      const finish = (r: CodaExtractResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(r);
      };
      const timer = setTimeout(() => {
        log.warn("coda-extract worker timed out");
        finish({ html: "", text: "", isEmpty: true });
      }, WORKER_TIMEOUT_MS);
      timer.unref();
      worker.once("message", (msg: CodaExtractResult) => finish(msg));
      worker.once("error", (err) => {
        log.error("coda-extract worker error", err);
        finish({ html: "", text: "", isEmpty: true });
      });
      worker.postMessage(bytes);
    });
  }
}
