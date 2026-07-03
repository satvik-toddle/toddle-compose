import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "http";
import * as decoding from "lib0/decoding";
import { getYDoc, setupWSConnection, setPersistence } from "y-websocket/bin/utils";
import { TokensService, type RtcClaims } from "../tokens/tokens.service";
import { DocStateService } from "../persistence/doc-state.service";
import { createLogger, decodeYFrame, nextConnId } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("ws");

// y-websocket protocol message types: 0 = sync, 1 = awareness.
const MESSAGE_AWARENESS = 1;
const AWARENESS_MAX_PER_SEC = 15;
const AWARENESS_BURST = 30;
const AWARENESS_TRAILING_MS = 100;

function frameMessageType(buf: Buffer): number | null {
  try {
    return decoding.readVarUint(decoding.createDecoder(new Uint8Array(buf)));
  } catch {
    return null;
  }
}

// Use lib0's varuint decoder (not raw bytes): readVarUint accepts non-canonical encodings, so byte-level checks are bypassable.
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

// Token accepted via `?token=` or, if absent, a `bearer.<token>` WS subprotocol entry; bearer clients must also offer `yjs` since handleProtocols only selects "yjs".
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
      bindState: (docName: string, ydoc: unknown) => {
        // Track the cold-load so a connecting client can await it (see verifyClient).
        const loaded = this.docState.bindState(docName, ydoc as never);
        this.docState.trackLoad(docName, loaded);
        return loaded;
      },
      writeState: async (docName: string) => {
        await this.docState.writeState(docName);
      },
    } as never);
  }

  attach(server: HttpServer): void {
    this.wss = this.startWss(server);
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.docState.shutdownAndFlushAll();
    } catch (e) {
      log.error("shutdown flush error", e);
    }
    this.wss?.close();
  }

  private startWss(server: HttpServer): WebSocketServer {
    // Per-connection token bucket for inbound WS messages (env-tunable).
    const rateLimitCapacity = this.config.get("RTC_RATE_LIMIT_CAPACITY", {
      infer: true,
    });
    const rateLimitRefillPerSec = this.config.get(
      "RTC_RATE_LIMIT_REFILL_PER_SEC",
      { infer: true }
    );
    const wss = new WebSocketServer({
      server,
      maxPayload: this.config.get("RTC_WS_MAX_PAYLOAD_BYTES", { infer: true }),
      // Only invoked when the client offers subprotocols (bearer-token clients): select "yjs" if offered, else refuse.
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
          // Load persisted state before the handshake completes, so the client's first
          // sync sees the saved doc. Otherwise a cold reload (doc evicted on the last
          // disconnect) races the async bindState and the client treats the doc as
          // empty — which makes the sheet re-seed its rows on every refresh.
          getYDoc(parsed.docId, true);
          await this.docState.whenLoaded(parsed.docId);
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
        // Fail closed: never allow a connection without verified claims.
        ws.close(1008, "unauthorized");
        return;
      }
      const role = claims.role;
      const sub = claims.sub;
      const cid = nextConnId();
      const clog = log.child(cid);
      this.docState.registerClaims(ws, claims);
      clog.info(`OPEN sub=${sub} doc='${parsed.docId}' role=${role}`);

      // JWT is verified once at connect; close the socket at expiry so a stale token can't hold it open.
      let expiryTimer: NodeJS.Timeout | null = null;
      if (typeof claims.exp === "number") {
        const ttlMs = Math.max(0, claims.exp * 1000 - Date.now());
        expiryTimer = setTimeout(() => {
          clog.warn(`token expired sub=${sub} doc='${parsed.docId}' — closing`);
          ws.close(1008, "token expired");
        }, ttlMs);
        expiryTimer.unref();
      }

      // Awareness coalescing state; declared before the close handler so the trailing timer is cleaned up on disconnect.
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

      // Message wrapper: awareness coalescing, token-bucket rate limiting, and dropping viewer sync writes.
      let bucketTokens = rateLimitCapacity;
      let bucketRefilledAt = Date.now();
      const takeToken = (): boolean => {
        const now = Date.now();
        bucketTokens = Math.min(
          rateLimitCapacity,
          bucketTokens +
            ((now - bucketRefilledAt) / 1000) * rateLimitRefillPerSec
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
      // Set when y-websocket subscribes to 'message' through the wrapper below; asserted after setupWSConnection.
      let messageWrapInstalled = false;
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

          // Awareness frames carry full presence state, so beyond the budget keep only the latest on a trailing timer; bounds N² chatter and bypasses the rate limit below.
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
        messageWrapInstalled = true;
        return originalOn("message" as never, wrapped as never);
      }) as typeof ws.on;

      setupWSConnection(ws, req, { docName: parsed.docId, gc: true });

      // Fail closed: if a y-websocket upgrade stops subscribing via ws.on('message'), the wrapper's rate limit + viewer write-block silently vanish — refuse the connection instead.
      if (!messageWrapInstalled) {
        clog.error(
          `y-websocket did not subscribe via ws.on('message') — enforcement wrapper not installed, closing sub=${sub} doc='${parsed.docId}'`
        );
        ws.close(1011, "server misconfiguration");
        return;
      }
    });

    wss.on("error", (err) => log.error("WSS error", err));
    log.info("WS server attached to the HTTP server (shared port)");
    return wss;
  }
}
