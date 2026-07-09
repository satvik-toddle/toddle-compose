import { Injectable } from "@nestjs/common";
import { docs as ywsDocs } from "y-websocket/bin/utils";
import { createLogger } from "../logger";

const log = createLogger("kick");

// Watermarks self-expire with the RTC token TTL (5 min); older entries can't reject any still-valid token, so they're swept. Keep in sync with the backend's RTC token TTL.
const KICK_TTL_SECONDS = 300;

// Force-refresh access on a doc: close live sockets AND invalidate already-minted tokens so
// auto-reconnects can't re-authorize with a stale (still-unexpired) token. In-memory only —
// a watermark is meaningless after a restart drops the sockets, and it self-expires with the
// 5-min token TTL anyway.
@Injectable()
export class DocKickService {
  // docId → kick watermark in epoch MILLISECONDS (ms precision avoids the same-second escape); entries older than the token TTL are swept.
  private readonly minIatMs = new Map<string, number>();

  // Delete watermarks older than the token TTL so the map can't grow unbounded across every ever-kicked doc.
  private sweep(nowMs: number): void {
    const cutoff = nowMs - KICK_TTL_SECONDS * 1000;
    for (const [id, ms] of this.minIatMs) {
      if (ms < cutoff) this.minIatMs.delete(id);
    }
  }

  // Reject only when the token's second is strictly BEFORE the kick's second, so a same-second re-mint after the kick still passes; unknown/expired watermarks and iat-less tokens pass.
  isRejected(docId: string, iat: number | undefined): boolean {
    const watermarkMs = this.minIatMs.get(docId);
    if (watermarkMs === undefined || typeof iat !== "number") return false;
    if (watermarkMs < Date.now() - KICK_TTL_SECONDS * 1000) {
      this.minIatMs.delete(docId);
      return false;
    }
    return iat < Math.floor(watermarkMs / 1000);
  }

  // Bump the watermark (kickedAt: backend-stamped epoch SECONDS, same clock as token `iat`, avoiding cross-service skew; our own ms clock only as fallback) and close every live socket on the doc; returns the count closed.
  kickDoc(docId: string, kickedAt?: number): number {
    const nowMs = Date.now();
    const watermarkMs =
      typeof kickedAt === "number" && Number.isFinite(kickedAt)
        ? kickedAt * 1000
        : nowMs;
    this.sweep(nowMs);
    this.minIatMs.set(docId, watermarkMs);
    const liveDoc = ywsDocs.get(docId);
    let closed = 0;
    if (liveDoc) {
      for (const conn of [...liveDoc.conns.keys()]) {
        try {
          conn.close(4001, "access changed");
          closed++;
        } catch {
          /* already closed */
        }
      }
    }
    log.info(`kick doc='${docId}' closed=${closed}`);
    return closed;
  }
}
