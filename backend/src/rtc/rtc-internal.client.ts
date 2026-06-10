import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

/**
 * Thin client for the rtc-server's internal HTTP API (shared-secret authed).
 * Lives in the app process; the rtc-server owns the separate RTC database, so the
 * backend reaches RTC state only through here — never by querying that DB directly.
 */
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
    body?: unknown
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
      });
    } catch {
      throw new HttpException({ error: "rtc-server unreachable" }, 502);
    }
    const text = await res.text();
    if (!res.ok) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text };
      }
      throw new HttpException(parsed as Record<string, unknown>, res.status);
    }
    return text ? JSON.parse(text) : {};
  }

  /** Provision the RTC row for a document id (idempotent upsert on the rtc side). */
  initDoc(docId: string): Promise<unknown> {
    return this.call("POST", "/internal/docs/init", { docId });
  }

  /**
   * Best-effort provisioning used on document creation: if the rtc-server is down,
   * we log and move on — the rtc-server lazily creates the row on first connect.
   */
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

  /**
   * Edit sessions for a doc — updates grouped by author + time gap (no-op
   * sessions already filtered out by the rtc-server). Used to build the
   * "who changed what, when" history timeline.
   */
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
