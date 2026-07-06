import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, randomUUID } from "crypto";
import {
  DocShareMode,
  DocumentShareLink,
  ShareLinkScope,
  WorkspaceRole,
} from "@app/database";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from "../auth/jwt.constants";
import type { AuthUser } from "../auth/current-user.decorator";
import { DocumentCacheService } from "./document-cache.service";
import { DocumentsService } from "./documents.service";
import { RtcTokenService, type RtcRole } from "../rtc/rtc-token.service";

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
    private readonly cache: DocumentCacheService,
    private readonly documents: DocumentsService,
    private readonly rtcTokens: RtcTokenService,
    private readonly jwt: JwtService,
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
  // (existing copies of the URL stay valid). Also flips the doc's Share pane to LINK.
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
    await this.setDocShareMode(documentId, "LINK");
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

  // Idempotent revoke; drops the Share pane back to DEFAULT when it pointed at the link.
  async remove(actorId: string, documentId: string) {
    const doc = await this.requireManage(actorId, documentId);
    await this.prisma.documentShareLink.deleteMany({ where: { documentId } });
    if (doc.shareMode === "LINK") await this.setDocShareMode(documentId, "DEFAULT");
    return { ok: true as const };
  }

  // Switch the Share-modal pane. Leaving LINK does NOT delete the link row — only an
  // explicit DELETE revokes it (so toggling panes can't silently kill circulating URLs).
  async setShareMode(actorId: string, documentId: string, mode: DocShareMode) {
    await this.requireManage(actorId, documentId);
    await this.prisma.document.update({
      where: { id: documentId },
      data: { shareMode: mode },
    });
    // shareMode is part of the cached summary row — drop it so the next read is fresh.
    this.cache.invalidate(documentId);
    return { shareMode: mode };
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
    return { token: rtcToken, docId: link.documentId, role };
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
  private async requireScopeAccess(
    scope: ShareLinkScope,
    authHeader: string | undefined
  ): Promise<AuthUser | null> {
    const user = await this.optionalUser(authHeader);
    if (scope === "ANYONE") return user;
    if (!user || (await this.authz.realmRole(user.id)) === null) {
      throw new UnauthorizedException("sign in to open this link");
    }
    return user;
  }

  // Optional-auth mirror of JwtAuthGuard: same pinned alg/iss/aud verification and user
  // load, but a missing/invalid token yields null instead of 401 (the scope gate decides).
  private async optionalUser(header: string | undefined): Promise<AuthUser | null> {
    if (!header?.startsWith("Bearer ")) return null;
    try {
      const payload = await this.jwt.verifyAsync(header.slice(7), {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (payload.type !== "access") return null;
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        color: user.color,
        activeWorkspaceId: payload.activeWorkspaceId ?? null,
      };
    } catch {
      return null;
    }
  }

  // Same manage gate as document permissions: owner OR effective ws ADMIN OR doc-ADMIN grantee.
  private async requireManage(actorId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true, workspaceId: true, shareMode: true },
    });
    if (!doc) throw new NotFoundException("document not found");
    if (doc.ownerId === actorId) return doc;

    const [wsRole, grant] = await Promise.all([
      this.authz.effectiveWorkspaceRole(actorId, doc.workspaceId),
      this.authz.docGrantRole(actorId, documentId),
    ]);
    if (wsRole === "ADMIN" || grant === "ADMIN") return doc;

    throw new ForbiddenException("requires document ADMIN to manage the share link");
  }

  private async setDocShareMode(documentId: string, mode: DocShareMode) {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { shareMode: mode },
    });
    this.cache.invalidate(documentId);
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
