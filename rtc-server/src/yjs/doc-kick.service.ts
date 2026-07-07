import { Injectable } from "@nestjs/common";
import { docs as ywsDocs } from "y-websocket/bin/utils";
import { createLogger } from "../logger";

const log = createLogger("kick");

// Force-refresh access on a doc: close live sockets AND invalidate already-minted tokens so
// auto-reconnects can't re-authorize with a stale (still-unexpired) token. In-memory only —
// a watermark is meaningless after a restart drops the sockets, and it self-expires with the
// 5-min token TTL anyway.
@Injectable()
export class DocKickService {
  // docId → minimum acceptable token `iat` (epoch seconds); tokens issued before this are rejected.
  private readonly minIat = new Map<string, number>();

  // True when a token was issued before the doc's kick watermark; unknown docs and iat-less tokens pass.
  isRejected(docId: string, iat: number | undefined): boolean {
    const watermark = this.minIat.get(docId);
    return watermark !== undefined && typeof iat === "number" && iat < watermark;
  }

  // Bump the watermark to now and close every live socket on the doc; returns the count closed.
  kickDoc(docId: string): number {
    this.minIat.set(docId, Math.floor(Date.now() / 1000));
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
