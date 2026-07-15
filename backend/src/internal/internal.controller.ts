import { Body, Controller, Param, Put, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InternalTokenGuard } from "./internal-token.guard";

// Service-to-service endpoints (rtc-server → backend), shared-secret authed. Not under the
// public surface's auth; callers must present X-Internal-Token.
@Controller("internal")
@UseGuards(InternalTokenGuard)
export class InternalController {
  constructor(private readonly prisma: PrismaService) {}

  // rtc-server pushes a doc's plain-text projection here on each snapshot flush, so content
  // search can run entirely in this DB (trigram-indexed) without touching the collab server.
  @Put("documents/:id/content")
  async setContent(
    @Param("id") id: string,
    @Body() body: { text?: string }
  ): Promise<{ ok: true }> {
    const text = typeof body?.text === "string" ? body.text : "";
    // updateMany: a race with doc deletion just updates 0 rows instead of throwing.
    await this.prisma.document.updateMany({
      where: { id },
      data: { contentText: text },
    });
    return { ok: true };
  }
}
