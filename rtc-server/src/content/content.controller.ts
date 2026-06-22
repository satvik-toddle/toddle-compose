import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { TokensService, type RtcClaims } from "../tokens/tokens.service";
import { DocStateService } from "../persistence/doc-state.service";
import type { ContentOp } from "./content-builder";

// RTC-token-authed writes keep the backend off the per-update hot path; auth matches the WS handshake (JWKS-verified RS256, scoped to docId + role).
@Controller("docs")
export class ContentController {
  constructor(
    private readonly tokens: TokensService,
    private readonly docState: DocStateService
  ) {}

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

  // Outline for targeting edits: per top-level block, parentId index + type + concatenated text (the offset space in-place ops address); raw carries full Lexical JSON.
  @Get(":docId/content")
  async content(
    @Param("docId") docId: string,
    @Headers("authorization") authorization: string | undefined
  ) {
    await this.requireEditor(authorization, docId);
    const lexicalJson = await this.docState.readContent(docId);
    let blocks: Array<{ parentId: number; type: string; text: string; length: number }> = [];
    try {
      const root = JSON.parse(lexicalJson || '{"root":{"children":[]}}').root;
      const textOf = (node: { type?: string; text?: string; children?: unknown[] }): string => {
        if (node.type === "text") return node.text ?? "";
        return ((node.children as typeof node[]) ?? []).map(textOf).join("");
      };
      blocks = (root.children ?? []).map(
        (b: { type: string }, i: number) => {
          const text = textOf(b);
          return { parentId: i, type: b.type, text, length: text.length };
        }
      );
    } catch {
      // empty/invalid → no blocks
    }
    return { docId, blocks, raw: lexicalJson };
  }

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
