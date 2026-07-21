import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "worker_threads";
import { join } from "path";
import * as Y from "yjs";
import { DocRepository } from "./doc-repository.service";
import { DocStateService } from "./doc-state.service";
import {
  extractCodaHtmlSync,
  type CodaExtractResult,
} from "./coda-extract.core";
import type { Env } from "../config/env";
import { createLogger } from "../logger";

const log = createLogger("coda-extract");

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
    private readonly docState: DocStateService,
    private readonly config: ConfigService<Env, true>
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
    const { html, isEmpty } = await this.runWorker(docId, bytes);
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

  // Spawn a single-use worker per request, then terminate it (C6/C2 isolation). A timeout or worker
  // error rejects (never coerces to isEmpty) so the caller fails closed instead of losing content.
  // If the worker can't spawn, fall back to inline extraction — which itself throws on failure.
  private runWorker(
    docId: string,
    bytes: Uint8Array
  ): Promise<CodaExtractResult> {
    const timeoutMs = this.config.get("RTC_CODA_EXTRACT_TIMEOUT_MS", {
      infer: true,
    });
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(join(__dirname, "coda-extract.worker.js"));
      } catch (e) {
        log.error("coda-extract worker spawn failed — inline fallback", e);
        try {
          resolve(extractCodaHtmlSync(bytes));
        } catch (err) {
          reject(err);
        }
        return;
      }
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        fn();
      };
      const timer = setTimeout(() => {
        log.warn(`coda-extract worker timed out for doc '${docId}'`);
        settle(() =>
          reject(
            new Error(
              `coda extraction timed out after ${timeoutMs}ms for doc '${docId}'`
            )
          )
        );
      }, timeoutMs);
      timer.unref();
      worker.once("message", (msg: CodaExtractResult) =>
        settle(() => resolve(msg))
      );
      worker.once("error", (err) => {
        log.error(`coda-extract worker error for doc '${docId}'`, err);
        settle(() =>
          reject(
            new Error(
              `coda extraction worker error for doc '${docId}': ${err instanceof Error ? err.message : String(err)}`
            )
          )
        );
      });
      worker.postMessage(bytes);
    });
  }
}
