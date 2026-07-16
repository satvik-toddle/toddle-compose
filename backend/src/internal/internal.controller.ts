import { Body, Controller, Param, Post, Put, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InternalTokenGuard } from "./internal-token.guard";
import { BulkIndexContentDto } from "./dto";

// Service-to-service endpoints (rtc-server → backend), shared-secret authed. Not under the
// public surface's auth; callers must present X-Internal-Token.
@Controller("internal")
@UseGuards(InternalTokenGuard)
export class InternalController {
  constructor(private readonly prisma: PrismaService) {}

  // rtc-server pushes a doc's plain-text projection here so content search can run entirely in
  // this DB (trigram-indexed) without touching the collab server. When `seq` is present the
  // write is seq-guarded (G3) so a delayed push can't clobber newer text; without it (legacy
  // single-doc path) the text is written unconditionally.
  @Put("documents/:id/content")
  async setContent(
    @Param("id") id: string,
    @Body() body: { text?: string; seq?: number }
  ): Promise<{ ok: true }> {
    const text = typeof body?.text === "string" ? body.text : "";
    const seq = typeof body?.seq === "number" ? body.seq : null;
    if (seq === null) {
      // updateMany: a race with doc deletion just updates 0 rows instead of throwing.
      await this.prisma.document.updateMany({ where: { id }, data: { contentText: text } });
    } else {
      await this.applyIndex([{ id, text, seq }]);
    }
    return { ok: true };
  }

  // Bulk index push from the indexer worker: one seq-guarded merge for the whole batch.
  @Post("documents/content")
  async bulkSetContent(@Body() body: BulkIndexContentDto): Promise<{ ok: true; applied: number }> {
    const items = body.items
      .filter((i) => typeof i.seq === "number")
      .map((i) => ({ id: i.id, text: i.text, seq: i.seq as number }));
    const applied = await this.applyIndex(items);
    return { ok: true, applied };
  }

  // Seq-guarded bulk merge: UPDATE only rows whose stored content_seq is null or older than the
  // incoming seq. One statement over unnested arrays; deleted docs simply match nothing.
  private async applyIndex(
    items: { id: string; text: string; seq: number }[]
  ): Promise<number> {
    if (items.length === 0) return 0;
    const ids = items.map((i) => i.id);
    const texts = items.map((i) => i.text);
    const seqs = items.map((i) => i.seq);
    return this.prisma.$executeRaw`
      UPDATE documents AS d
      SET content_text = v.text, content_seq = v.seq
      FROM (
        SELECT * FROM unnest(${ids}::text[], ${texts}::text[], ${seqs}::int[])
          AS t(id, text, seq)
      ) AS v
      WHERE d.id = v.id AND (d.content_seq IS NULL OR d.content_seq < v.seq)
    `;
  }
}
