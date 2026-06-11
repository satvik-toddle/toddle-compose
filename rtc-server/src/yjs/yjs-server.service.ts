import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "http";
import * as decoding from "lib0/decoding";
import { setupWSConnection, setPersistence } from "y-websocket/bin/utils";
import { TokensService, type RtcClaims } from "../tokens/tokens.service";
import { DocStateService } from "../persistence/doc-state.service";
import { createLogger, decodeYFrame, nextConnId } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("ws");

// Per-connection token bucket for message rate limiting.
const RATE_LIMIT_CAPACITY = 500;
const RATE_LIMIT_REFILL_PER_SEC = 100;

// Awareness (presence/cursor) frames per connection: above this rate only the
// latest frame is kept, delivered on a trailing timer. y-websocket's protocol
// message types: 0 = sync, 1 = awareness.
const MESSAGE_AWARENESS = 1;
const AWARENESS_MAX_PER_SEC = 15;
const AWARENESS_BURST = 30;
const AWARENESS_TRAILING_MS = 100;

/** Outer protocol message type, decoded the same way y-websocket decodes it. */
function frameMessageType(buf: Buffer): number | null {
  try {
    return decoding.readVarUint(decoding.createDecoder(new Uint8Array(buf)));
  } catch {
    return null;
  }
}

// Decode with the SAME varuint decoder y-websocket uses (lib0). Inspecting raw
// bytes is bypassable: lib0's readVarUint accepts non-canonical multi-byte
// encodings (e.g. 0x80 0x00 decodes to 0), so a byte-level check can be snuck
// past while the consumer still sees a sync write.
function shouldDropForViewer(buf: Buffer): boolean {
  try {
    const decoder = decoding.createDecoder(new Uint8Array(buf));
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== 0) return false; // not a sync message
    const subType = decoding.readVarUint(decoder);
    return subType === 1 || subType === 2; // syncStep2 / update
  } catch {
    return true; // undecodable frame from a viewer: drop
  }
}

// The token is accepted either as `?token=` (existing clients) or — when the
// query param is absent — as a WS subprotocol entry of the form
// `bearer.<token>` (lets browser clients avoid putting tokens in URLs).
// Clients using bearer-protocol auth must also offer the `yjs` protocol, since
// handleProtocols only ever selects "yjs" (never echoes the bearer entry back).
function parseUrl(
  url: string,
  protocolHeader?: string
): { docId: string; token: string } | null {
  try {
    const u = new URL(url, "http://localhost");
    const m = u.pathname.match(/^\/yjs\/([^/]+)$/);
    if (!m) return null;
    let token = u.searchParams.get("token");
    if (!token && protocolHeader) {
      const bearer = protocolHeader
        .split(",")
        .map((p) => p.trim())
        .find((p) => p.startsWith("bearer."));
      if (bearer) token = bearer.slice("bearer.".length);
    }
    if (!token) return null;
    return { docId: decodeURIComponent(m[1]), token };
  } catch {
    return null;
  }
}

@Injectable()
export class YjsServerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly tokens: TokensService,
    private readonly docState: DocStateService,
    private readonly config: ConfigService<Env, true>
  ) {}

  onApplicationBootstrap(): void {
    setPersistence({
      provider: null,
      bindState: async (docName: string, ydoc: unknown) => {
        await this.docState.bindState(docName, ydoc as never);
      },
      writeState: async (docName: string) => {
        await this.docState.writeState(docName);
      },
    } as never);

    const port = this.config.get("RTC_PORT", { infer: true });
    this.wss = this.startWss(port);
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.docState.shutdownAndFlushAll();
    } catch (e) {
      log.error("shutdown flush error", e);
    }
    this.wss?.close();
  }

  private startWss(port: number): WebSocketServer {
    const wss = new WebSocketServer({
      port,
      maxPayload: this.config.get("RTC_WS_MAX_PAYLOAD_BYTES", { infer: true }),
      // Only invoked when the client offers subprotocols (bearer-token auth
      // clients): always select "yjs" if offered, otherwise refuse. Query-param
      // clients offer no protocols, so this is never called for them.
      handleProtocols: (protocols) => (protocols.has("yjs") ? "yjs" : false),
      verifyClient: async ({ req }, cb) => {
        const parsed = parseUrl(
          req.url ?? "",
          req.headers["sec-websocket-protocol"]
        );
        if (!parsed) {
          cb(false, 400, "bad URL");
          return;
        }
        try {
          const claims = await this.tokens.verify(parsed.token);
          if (claims.docId !== parsed.docId) {
            cb(false, 403, "docId mismatch");
            return;
          }
          (req as IncomingMessage & { rtcClaims: RtcClaims }).rtcClaims = claims;
          log.info(
            `verifyClient ACCEPT sub=${claims.sub} doc='${parsed.docId}' role=${claims.role}`
          );
          cb(true);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "verify failed";
          log.warn(`verifyClient REJECT: ${msg}`);
          cb(false, 401, msg);
        }
      },
    });

    wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const parsed = parseUrl(
        req.url ?? "",
        req.headers["sec-websocket-protocol"]
      );
      if (!parsed) {
        ws.close(1008, "bad URL");
        return;
      }
      const claims = (req as IncomingMessage & { rtcClaims?: RtcClaims })
        .rtcClaims;
      if (!claims) {
        // Fail closed: never default a connection without verified claims.
        ws.close(1008, "unauthorized");
        return;
      }
      const role = claims.role;
      const sub = claims.sub;
      const cid = nextConnId();
      const clog = log.child(cid);
      this.docState.registerClaims(ws, claims);
      clog.info(`OPEN sub=${sub} doc='${parsed.docId}' role=${role}`);

      // The JWT is verified once at connect; close the socket when it expires
      // so a revoked/expired token can't hold a connection open indefinitely.
      let expiryTimer: NodeJS.Timeout | null = null;
      if (typeof claims.exp === "number") {
        const ttlMs = Math.max(0, claims.exp * 1000 - Date.now());
        expiryTimer = setTimeout(() => {
          clog.warn(`token expired sub=${sub} doc='${parsed.docId}' — closing`);
          ws.close(1008, "token expired");
        }, ttlMs);
        expiryTimer.unref();
      }

      // Awareness coalescing state (see wrapper below): declared before the
      // close handler so the trailing-edge timer is cleaned up on disconnect.
      let awarenessTimer: NodeJS.Timeout | null = null;
      let latestAwareness: Buffer | ArrayBuffer | Buffer[] | null = null;

      ws.on("close", (code) => {
        if (expiryTimer) {
          clearTimeout(expiryTimer);
          expiryTimer = null;
        }
        if (awarenessTimer) {
          clearTimeout(awarenessTimer);
          awarenessTimer = null;
        }
        latestAwareness = null;
        clog.info(`CLOSE sub=${sub} doc='${parsed.docId}' code=${code}`);
      });
      ws.on("error", (err) => clog.error(`socket error doc='${parsed.docId}'`, err));

      // Single message wrapper for every connection: (a) awareness coalescing,
      // (b) token-bucket rate limiting, and (c) for viewers, drop sync writes
      // before y-websocket applies them.
      let bucketTokens = RATE_LIMIT_CAPACITY;
      let bucketRefilledAt = Date.now();
      const takeToken = (): boolean => {
        const now = Date.now();
        bucketTokens = Math.min(
          RATE_LIMIT_CAPACITY,
          bucketTokens +
            ((now - bucketRefilledAt) / 1000) * RATE_LIMIT_REFILL_PER_SEC
        );
        bucketRefilledAt = now;
        if (bucketTokens < 1) return false;
        bucketTokens -= 1;
        return true;
      };
      let awarenessTokens = AWARENESS_BURST;
      let awarenessRefilledAt = Date.now();
      const takeAwarenessToken = (): boolean => {
        const now = Date.now();
        awarenessTokens = Math.min(
          AWARENESS_BURST,
          awarenessTokens +
            ((now - awarenessRefilledAt) / 1000) * AWARENESS_MAX_PER_SEC
        );
        awarenessRefilledAt = now;
        if (awarenessTokens < 1) return false;
        awarenessTokens -= 1;
        return true;
      };

      const originalOn = ws.on.bind(ws);
      (ws as unknown as { on: typeof ws.on }).on = ((
        event: string,
        listener: (...args: unknown[]) => void
      ) => {
        if (event !== "message") {
          return originalOn(event as never, listener as never);
        }
        const deliver = listener as (d: unknown) => void;
        const wrapped = (data: Buffer | ArrayBuffer | Buffer[]) => {
          let buf: Buffer;
          if (Buffer.isBuffer(data)) buf = data;
          else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
          else buf = Buffer.concat(data as Buffer[]);

          // Awareness frames (cursor moves) carry the sender's FULL presence
          // state, so intermediate ones are droppable: beyond the per-second
          // budget, keep only the latest and deliver it on a trailing timer.
          // This bounds the N² broadcast chatter in crowded docs — and these
          // frames never count against the disconnecting rate limit below.
          if (frameMessageType(buf) === MESSAGE_AWARENESS) {
            if (!takeAwarenessToken()) {
              latestAwareness = data;
              if (!awarenessTimer) {
                awarenessTimer = setTimeout(() => {
                  awarenessTimer = null;
                  if (latestAwareness != null) {
                    const d = latestAwareness;
                    latestAwareness = null;
                    deliver(d);
                  }
                }, AWARENESS_TRAILING_MS);
              }
              return;
            }
            deliver(data);
            return;
          }

          if (!takeToken()) {
            clog.warn(
              `RATE LIMIT exceeded sub=${sub} doc='${parsed.docId}' — closing`
            );
            ws.close(1008, "rate limit exceeded");
            return;
          }
          if (role === "viewer" && shouldDropForViewer(buf)) {
            clog.warn(`DROP write from viewer sub=${sub} ${decodeYFrame(buf)}`);
            return;
          }
          deliver(data);
        };
        return originalOn("message" as never, wrapped as never);
      }) as typeof ws.on;

      setupWSConnection(ws, req, { docName: parsed.docId, gc: true });
    });

    wss.on("listening", () => log.info(`WSS listening on :${port}`));
    wss.on("error", (err) => log.error("WSS error", err));
    return wss;
  }
}
