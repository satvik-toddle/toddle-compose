import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "crypto";
import {
  DocumentShareLink,
  ShareLinkScope,
  WorkspaceRole,
} from "@app/database";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { AccessTokenService } from "../auth/access-token.service";
import type { AuthUser } from "../auth/current-user.decorator";
import { DocumentsService } from "./documents.service";
import { RtcTokenService, type RtcRole } from "../rtc/rtc-token.service";
import { RtcInternalClient } from "../rtc/rtc-internal.client";

// Anonymous link visitors have no user row, so give each a friendly random display name +
// presence color so collaborators can tell them apart in the editor's awareness cursors.
const ANON_ADJECTIVES = [
  "Anonymous", "Curious", "Swift", "Quiet", "Happy", "Clever", "Brave",
  "Gentle", "Jolly", "Keen", "Lively", "Merry", "Nimble", "Witty",
];
const ANON_ANIMALS = [
  "Otter", "Panda", "Fox", "Koala", "Falcon", "Lynx", "Heron", "Bison",
  "Tapir", "Gecko", "Marmot", "Ibex", "Quokka", "Wren",
];
const ANON_COLORS = [
  "#f04c54", "#5a5ae2", "#00ac8a", "#e8653a", "#b646ee",
  "#00b0c2", "#ef4371", "#d67d00", "#6d9c00", "#a43dd7",
];
const pick = <T,>(arr: T[]): T => arr[randomBytes(1)[0] % arr.length];
const randomGuestName = () => `${pick(ANON_ADJECTIVES)} ${pick(ANON_ANIMALS)}`;

// "Anyone with the link" sharing. The token IS the credential: the manage endpoints (owner /
// ws-ADMIN / doc-ADMIN grantee) mint and rotate it; the public endpoints resolve it with no
// guard (REALM scope re-checks auth internally). Token lookups only — a link never exposes
// anything about the workspace beyond the one doc's summary.
@Injectable()
export class DocumentShareLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly documents: DocumentsService,
    private readonly rtcTokens: RtcTokenService,
    private readonly rtcInternal: RtcInternalClient,
    private readonly accessTokens: AccessTokenService,
    private readonly config: ConfigService<Env, true>
  ) {}

  // ------------------------------------------------------------ manage (guarded routes)

  async get(actorId: string, documentId: string) {
    await this.requireManage(actorId, documentId);
    const link = await this.prisma.documentShareLink.findUnique({
      where: { documentId },
    });
    if (!link) throw new NotFoundException("no share link for this document");
    return this.toDto(link);
  }

  // Create-or-update: a doc has at most one link; updating role/scope keeps the token
  // (existing copies of the URL stay valid).
  async upsert(
    actorId: string,
    documentId: string,
    role: WorkspaceRole,
    scope: ShareLinkScope
  ) {
    await this.requireManage(actorId, documentId);
    const link = await this.prisma.documentShareLink.upsert({
      where: { documentId },
      update: { role, scope },
      create: {
        documentId,
        token: this.newToken(),
        role,
        scope,
        createdById: actorId,
      },
    });
    return this.toDto(link);
  }

  // Rotate the token — the old URL stops working immediately; role/scope are kept.
  async regenerate(actorId: string, documentId: string) {
    await this.requireManage(actorId, documentId);
    const existing = await this.prisma.documentShareLink.findUnique({
      where: { documentId },
    });
    if (!existing) throw new NotFoundException("no share link for this document");
    const link = await this.prisma.documentShareLink.update({
      where: { documentId },
      data: { token: this.newToken() },
    });
    return this.toDto(link);
  }

  // Idempotent revoke — the URL stops working immediately.
  async remove(actorId: string, documentId: string) {
    await this.requireManage(actorId, documentId);
    await this.prisma.documentShareLink.deleteMany({ where: { documentId } });
    return { ok: true as const };
  }

  // Apply access changes now: kick everyone live on the doc and invalidate their cached RTC
  // tokens, forcing an immediate re-mint against current permissions (no 5-min TTL wait).
  async refreshAccess(actorId: string, documentId: string) {
    await this.requireManage(actorId, documentId);
    const { closed } = await this.rtcInternal.kickDoc(documentId);
    return { ok: true as const, closed: closed ?? 0 };
  }

  // ------------------------------------------------------------ public (unguarded routes)

  // Resolve a link token to the doc summary it opens. ANYONE → no auth at all;
  // REALM → a valid access token belonging to a realm member, else 401.
  async resolve(token: string, authHeader: string | undefined) {
    const link = await this.loadLinkOrThrow(token);
    await this.requireScopeAccess(link.scope, authHeader);
    return {
      document: link.document,
      role: link.role,
      scope: link.scope,
    };
  }

  // Mint an RTC token through a link. Link role EDIT → editor, READ/COMMENT → viewer;
  // an authenticated caller with better standing access (owner/ws role/grant) keeps it.
  async mintRtcToken(token: string, authHeader: string | undefined) {
    const link = await this.loadLinkOrThrow(token);
    const user = await this.requireScopeAccess(link.scope, authHeader);

    let role: RtcRole = link.role === "EDIT" ? "editor" : "viewer";
    let identity: AuthUser;
    if (user) {
      identity = user;
      try {
        if ((await this.documents.resolveRtcRole(user.id, link.documentId)) === "editor") {
          role = "editor";
        }
      } catch {
        // No standing access of their own — the link role stands.
      }
    } else {
      // Anonymous visitor (ANYONE scope): synthetic, unguessable identity + random display name.
      identity = {
        id: `link-${randomUUID()}`,
        email: "",
        name: randomGuestName(),
        color: pick(ANON_COLORS),
        activeWorkspaceId: null,
      };
    }

    const rtcToken = await this.rtcTokens.mint(identity, link.documentId, role);
    // Echo the minted identity so the client can label "you" without decoding the JWT.
    return {
      token: rtcToken,
      docId: link.documentId,
      role,
      name: identity.name,
      color: identity.color,
    };
  }

  // ------------------------------------------------------------ internals

  // Constant 404 for unknown tokens — never reveals whether a token once existed.
  private async loadLinkOrThrow(token: string) {
    const link = await this.prisma.documentShareLink.findUnique({
      where: { token },
      include: {
        document: {
          select: { id: true, title: true, icon: true, type: true, workspaceId: true },
        },
      },
    });
    if (!link) throw new NotFoundException("share link not found");
    return link;
  }

  // Scope gate for the public endpoints; returns the caller when authenticated.
  // Optional auth: a missing/invalid token yields null instead of 401 (the scope decides).
  private async requireScopeAccess(
    scope: ShareLinkScope,
    authHeader: string | undefined
  ): Promise<AuthUser | null> {
    const user = await this.accessTokens.resolveAccessToken(authHeader);
    if (scope === "ANYONE") return user;
    if (!user || (await this.authz.realmRole(user.id)) === null) {
      throw new UnauthorizedException("sign in to open this link");
    }
    return user;
  }

  // Same manage gate as document permissions: owner OR effective ws ADMIN OR doc-ADMIN grantee.
  private async requireManage(actorId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, workspaceId: true },
    });
    if (!doc) throw new NotFoundException("document not found");
    await this.authz.requireDocManage(actorId, doc);
    return doc;
  }

  private toDto(link: DocumentShareLink) {
    const base = this.config
      .get("FRONTEND_URL", { infer: true })
      .replace(/\/+$/, "");
    return {
      token: link.token,
      role: link.role,
      scope: link.scope,
      createdAt: link.createdAt,
      url: `${base}/link/${link.token}`,
    };
  }

  // Unguessable capability token; same recipe as the auth email/reset tokens.
  private newToken(): string {
    return randomBytes(32).toString("base64url");
  }
}
