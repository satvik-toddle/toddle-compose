import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { TokensService, type RtcClaims } from "../tokens/tokens.service";
import { DocStateService } from "../persistence/doc-state.service";
import type { ContentOp } from "./content-builder";

// Public, RTC-token-authed content writes — the agent mints an RTC token from the
// backend (which applies the access-token cap/confinement at mint time) and then
// applies updates here directly, keeping the backend off the per-update hot path.
// Auth is identical to the WS handshake: an RS256 token verified via JWKS, scoped
// to a docId + role.
@Controller("docs")
export class ContentController {
  constructor(
    private readonly tokens: TokensService,
    private readonly docState: DocStateService
  ) {}

  // Apply a raw Yjs update (base64). For replaying captured edits.
  @Post(":docId/apply-update")
  async applyUpdate(
    @Param("docId") docId: string,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { update?: string }
  ) {
    await this.requireEditor(authorization, docId);
    if (typeof body?.update !== "string" || body.update.length === 0) {
      throw new BadRequestException("update (base64) required");
    }
    const bytes = Buffer.from(body.update, "base64");
    if (bytes.byteLength === 0) {
      throw new BadRequestException("update is not valid base64");
    }
    const applied = await this.docState.applyUpdate(docId, new Uint8Array(bytes));
    return { ok: true, docId, applied };
  }

  // Apply high-level content ops (paragraphs, headings, tables) built server-side.
  @Post(":docId/edit")
  async edit(
    @Param("docId") docId: string,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { ops?: ContentOp[] }
  ) {
    await this.requireEditor(authorization, docId);
    if (!Array.isArray(body?.ops) || body.ops.length === 0) {
      throw new BadRequestException("ops (non-empty array) required");
    }
    try {
      const applied = await this.docState.editDoc(docId, body.ops);
      return { ok: true, docId, applied };
    } catch (e) {
      throw new BadRequestException(
        `edit failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Verify the RTC token (same JWKS check as the WS handshake) and require an
  // editor role scoped to this doc.
  private async requireEditor(
    authorization: string | undefined,
    docId: string
  ): Promise<RtcClaims> {
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("missing bearer token");
    }
    let claims: RtcClaims;
    try {
      claims = await this.tokens.verify(authorization.slice(7));
    } catch {
      throw new UnauthorizedException("invalid rtc token");
    }
    if (claims.docId !== docId) {
      throw new ForbiddenException("token docId mismatch");
    }
    if (claims.role !== "editor") {
      throw new ForbiddenException("editor access required");
    }
    return claims;
  }
}
