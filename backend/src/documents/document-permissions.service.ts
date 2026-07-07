import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WorkspaceRole } from "@app/database";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AuthzService } from "../realm/authz.service";
import { MailerService } from "../mailer/mailer.service";
import type { AuthUser } from "../auth/current-user.decorator";

const USER_SELECT = { id: true, email: true, name: true, color: true } as const;

// Per-page grants (any WorkspaceRole on one doc, independent of workspace membership; elevate-only — effective doc role = max(ws role, grant)); mirrors WorkspacesService member management.
@Injectable()
export class DocumentPermissionsService {
  private readonly log = new Logger("DocumentPermissions");

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService<Env, true>
  ) {}

  // Explicit grants on this doc (managers only), each with the grantee's public profile.
  async list(actorId: string, documentId: string) {
    await this.requireManage(actorId, documentId);
    return this.prisma.documentPermission.findMany({
      where: { documentId },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "asc" },
    });
  }

  // Grant a role by email (managers only). Grantee must be registered; owner and duplicates 409.
  async add(
    actor: AuthUser,
    documentId: string,
    email: string,
    role: WorkspaceRole
  ) {
    const doc = await this.requireManage(actor.id, documentId);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException("no user with that email — they must register first");
    }
    if (user.id === doc.ownerId) {
      throw new ConflictException("the document owner already has full access");
    }

    const existing = await this.prisma.documentPermission.findUnique({
      where: { userId_documentId: { userId: user.id, documentId } },
    });
    if (existing) throw new ConflictException("user already has a grant on this document");

    // Deliberately no realm enrollment: a grant opens one doc, never realm-wide access.
    const grant = await this.prisma.documentPermission.create({
      data: { userId: user.id, documentId, role },
      include: { user: { select: USER_SELECT } },
    });
    // Notify only on add (not update/remove); the grant is committed, so never block on mail.
    this.notifyGranteeBestEffort(actor.name, doc, user, role);
    return grant;
  }

  // Change a grant's role (managers only); 404 if there's no grant to change.
  async update(
    actorId: string,
    documentId: string,
    targetUserId: string,
    role: WorkspaceRole
  ) {
    await this.requireManage(actorId, documentId);
    await this.getGrantOrThrow(documentId, targetUserId);
    return this.prisma.documentPermission.update({
      where: { userId_documentId: { userId: targetUserId, documentId } },
      data: { role },
      include: { user: { select: USER_SELECT } },
    });
  }

  // Revoke a grant. Allowed for managers or the grantee themselves ("leave this page").
  async remove(actorId: string, documentId: string, targetUserId: string) {
    if (actorId !== targetUserId) {
      await this.requireManage(actorId, documentId);
    } else if (!(await this.loadDoc(documentId))) {
      throw new NotFoundException("document not found");
    }
    await this.getGrantOrThrow(documentId, targetUserId);
    await this.prisma.documentPermission.delete({
      where: { userId_documentId: { userId: targetUserId, documentId } },
    });
    return { ok: true as const };
  }

  // Manage gate: doc owner OR effective workspace ADMIN OR a doc-ADMIN grantee; else 403 (404 if missing).
  private async requireManage(actorId: string, documentId: string) {
    const doc = await this.loadDoc(documentId);
    if (!doc) throw new NotFoundException("document not found");
    await this.authz.requireDocManage(actorId, doc);
    return doc;
  }

  private async loadDoc(documentId: string) {
    return this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, title: true, ownerId: true, workspaceId: true },
    });
  }

  // Fire-and-forget "shared with you" email; failures are logged, never surfaced to the API caller.
  private notifyGranteeBestEffort(
    granterName: string,
    doc: { id: string; title: string; workspaceId: string },
    grantee: { email: string; name: string },
    role: WorkspaceRole
  ): void {
    const frontendUrl = this.config
      .get("FRONTEND_URL", { infer: true })
      .replace(/\/+$/, "");
    const docUrl = `${frontendUrl}/w/${doc.workspaceId}?doc=${doc.id}`;
    void this.mailer
      .sendDocShared(grantee.email, {
        name: grantee.name,
        granterName,
        docTitle: doc.title,
        role,
        docUrl,
      })
      .catch((err) => {
        this.log.error(`failed to send doc-shared email to ${grantee.email}`, err as Error);
      });
  }

  private async getGrantOrThrow(documentId: string, userId: string) {
    const grant = await this.prisma.documentPermission.findUnique({
      where: { userId_documentId: { userId, documentId } },
    });
    if (!grant) throw new NotFoundException("no permission grant for that user");
    return grant;
  }
}
