import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

// Backend's only path to RTC state — the rtc-server owns the separate RTC DB.

@Injectable()
export class RtcInternalClient {
  private readonly log = new Logger("RtcInternalClient");

  constructor(private readonly config: ConfigService<Env, true>) {}

  private base(): string {
    return this.config.get("RTC_INTERNAL_URL", { infer: true });
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 8000
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "X-Internal-Token": this.config.get("INTERNAL_TOKEN", { infer: true }),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new HttpException({ error: "rtc-server unreachable" }, 502);
    }
    const text = await res.text();
    if (!res.ok) {
      // Don't relay the internal upstream body to API callers; log it, surface a generic 502.
      this.log.warn(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
      throw new HttpException({ error: "rtc service error" }, 502);
    }
    return text ? JSON.parse(text) : {};
  }

  /** Provision the RTC row for a document id (idempotent upsert on the rtc side). */
  initDoc(docId: string): Promise<unknown> {
    return this.call("POST", "/internal/docs/init", { docId }, 3000);
  }

  // If rtc-server is down, log and move on — it lazily creates the row on first connect.
  async initDocBestEffort(docId: string): Promise<void> {
    try {
      await this.initDoc(docId);
    } catch (e) {
      this.log.warn(
        `initDoc('${docId}') failed (will lazy-create on first connect): ${
          e instanceof Error ? e.message : e
        }`
      );
    }
  }

  // Edit sessions (updates grouped by author + time gap) for the history timeline.
  getSessions(docId: string): Promise<RtcSessionList> {
    return this.call(
      "GET",
      `/internal/docs/${encodeURIComponent(docId)}/sessions`
    ) as Promise<RtcSessionList>;
  }

  /** Reconstruct the doc state at a given seq (includes the sheet snapshot for SHEET docs). */
  getVersionPreview(docId: string, seq: number): Promise<RtcVersionPreview> {
    return this.call(
      "GET",
      `/internal/docs/${encodeURIComponent(docId)}/versions/${seq}`
    ) as Promise<RtcVersionPreview>;
  }

  /** Delete the RTC row (yjs state + update log) for a document id. */
  deleteDoc(docId: string): Promise<unknown> {
    return this.call(
      "DELETE",
      `/internal/docs/${encodeURIComponent(docId)}`,
      undefined,
      3000
    );
  }

  // Force-refresh access on a doc: kick live connections and invalidate already-minted tokens.
  // Not best-effort — the caller (the Share modal button) surfaces failures to the user.
  // kickedAt is stamped from this (backend) clock — the same clock that mints token `iat` — so the rtc-server watermark is skew-free.
  kickDoc(docId: string): Promise<{ closed?: number }> {
    return this.call(
      "POST",
      `/internal/docs/${encodeURIComponent(docId)}/kick`,
      { kickedAt: Math.floor(Date.now() / 1000) },
      3000
    ) as Promise<{ closed?: number }>;
  }

  // If rtc-server is down, log and move on — the leftover row is orphaned, not harmful.
  async deleteDocBestEffort(docId: string): Promise<void> {
    try {
      await this.deleteDoc(docId);
    } catch (e) {
      this.log.warn(
        `deleteDoc('${docId}') failed (rtc row left orphaned): ${
          e instanceof Error ? e.message : e
        }`
      );
    }
  }
}

/** Shapes returned by the rtc-server history endpoints (subset we consume). */
export type RtcSession = {
  firstSeq: number;
  lastSeq: number;
  clientSub: string | null;
  startedAt: number;
  endedAt: number;
  updateCount: number;
  totalBytes: number;
  noop: boolean;
  origin: string | null;
  changedCells: Array<{ rowId: string; colId: string }>;
};

export type RtcSessionList = {
  docId: string;
  head: number;
  sessions: RtcSession[];
};

export type RtcSheetSnapshot = {
  rows: Array<{ rowId: string | null; values: Record<string, unknown> }>;
  colTypes: Record<string, unknown>;
};

export type RtcVersionPreview = {
  docId: string;
  seq: number;
  headSeq: number;
  sheet: RtcSheetSnapshot | null;
  lexicalJson: string | null;
  plainText: string;
};
