import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import type { AuthUser } from "../auth/current-user.decorator";
import { RtcTokenService } from "./rtc-token.service";

// Writes a doc's whole body from an HTML string via rtc-server's token-authed content engine
// (POST /docs/:id/replace-html). Distinct from RtcInternalClient (X-Internal-Token internal API):
// replace-html is authed with a per-doc editor rtc-token, so we mint one for the acting user and
// send it as a Bearer. Shared by the per-doc import endpoint and the import worker.
@Injectable()
export class RtcContentClient {
  private readonly log = new Logger("RtcContentClient");

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly tokens: RtcTokenService,
  ) {}

  private base(): string {
    return this.config.get("RTC_INTERNAL_URL", { infer: true });
  }

  // Overwrite docId's entire body with html, as one atomic Yjs delta (applied warm-or-cold and
  // broadcast). actingUser only supplies the token subject/profile; the doc-scoped editor role is
  // frozen into the minted token. Returns the applied head seq. HTML→Lexical hydration is CPU-heavy
  // on the rtc side, so allow generous headroom over the internal client's 8s default.
  async replaceHtml(
    docId: string,
    html: string,
    actingUser: AuthUser,
    timeoutMs = 60_000,
  ): Promise<number> {
    const token = await this.tokens.mint(actingUser, docId, "editor");
    let res: Response;
    try {
      res = await fetch(`${this.base()}/docs/${encodeURIComponent(docId)}/replace-html`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ html }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new HttpException({ error: "rtc-server unreachable" }, 502);
    }
    const text = await res.text();
    if (!res.ok) {
      this.log.warn(`replace-html ${docId} → ${res.status}: ${text.slice(0, 500)}`);
      throw new HttpException({ error: "rtc content write failed", status: res.status }, 502);
    }
    const body = (text ? JSON.parse(text) : {}) as { applied?: number };
    return body.applied ?? 0;
  }
}
