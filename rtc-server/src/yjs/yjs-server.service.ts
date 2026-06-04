import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { setupWSConnection, setPersistence } from "y-websocket/bin/utils";
import { TokensService, type RtcClaims } from "../tokens/tokens.service";
import { DocStateService } from "../persistence/doc-state.service";
import { createLogger, decodeYFrame, nextConnId } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("ws");

function shouldDropForViewer(buf: Buffer): boolean {
  if (buf.length < 2) return false;
  if (buf[0] !== 0) return false;
  const subType = buf[1];
  return subType === 1 || subType === 2;
}

function parseUrl(url: string): { docId: string; token: string } | null {
  try {
    const u = new URL(url, "http://localhost");
    const m = u.pathname.match(/^\/yjs\/([^/]+)$/);
    if (!m) return null;
    const token = u.searchParams.get("token");
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
      verifyClient: async ({ req }, cb) => {
        const parsed = parseUrl(req.url ?? "");
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
      const parsed = parseUrl(req.url ?? "");
      if (!parsed) {
        ws.close(1008, "bad URL");
        return;
      }
      const claims = (req as IncomingMessage & { rtcClaims?: RtcClaims })
        .rtcClaims;
      const role = claims?.role ?? "editor";
      const sub = claims?.sub ?? "?";
      const cid = nextConnId();
      const clog = log.child(cid);
      if (claims) this.docState.registerClaims(ws, claims);
      clog.info(`OPEN sub=${sub} doc='${parsed.docId}' role=${role}`);

      ws.on("close", (code) =>
        clog.info(`CLOSE sub=${sub} doc='${parsed.docId}' code=${code}`)
      );
      ws.on("error", (err) => clog.error(`socket error doc='${parsed.docId}'`, err));

      if (role === "viewer") {
        const originalOn = ws.on.bind(ws);
        (ws as unknown as { on: typeof ws.on }).on = ((
          event: string,
          listener: (...args: unknown[]) => void
        ) => {
          if (event !== "message") {
            return originalOn(event as never, listener as never);
          }
          const wrapped = (data: Buffer | ArrayBuffer | Buffer[]) => {
            let buf: Buffer;
            if (Buffer.isBuffer(data)) buf = data;
            else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
            else buf = Buffer.concat(data as Buffer[]);
            if (shouldDropForViewer(buf)) {
              clog.warn(`DROP write from viewer sub=${sub} ${decodeYFrame(buf)}`);
              return;
            }
            (listener as (d: unknown) => void)(data);
          };
          return originalOn("message" as never, wrapped as never);
        }) as typeof ws.on;
      }

      setupWSConnection(ws, req, { docName: parsed.docId, gc: true });
    });

    wss.on("listening", () => log.info(`WSS listening on :${port}`));
    wss.on("error", (err) => log.error("WSS error", err));
    return wss;
  }
}
