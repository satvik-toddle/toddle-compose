import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { createLogger } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("indexer");

// Writes the search projection straight into the backend (app) DB — the indexer worker is the
// one process trusted with both databases, so there's no internal HTTP hop. The seq guard (G3)
// lives in this UPDATE: a delayed/out-of-order push (older seq) matches nothing.
@Injectable()
export class SearchIndexWriter implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    const connectionString = config.get("DATABASE_URL", { infer: true });
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for the indexer worker (backend DB write path)");
    }
    this.pool = new Pool({ connectionString, max: 4 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  // Seq-guarded bulk merge over unnested arrays; deleted docs simply match nothing.
  async apply(items: { id: string; text: string; seq: number }[]): Promise<void> {
    if (items.length === 0) return;
    const ids = items.map((i) => i.id);
    const texts = items.map((i) => i.text);
    const seqs = items.map((i) => i.seq);
    await this.pool.query(
      `UPDATE documents AS d
         SET content_text = v.text, content_seq = v.seq
         FROM (SELECT * FROM unnest($1::text[], $2::text[], $3::int[]) AS t(id, text, seq)) AS v
        WHERE d.id = v.id AND (d.content_seq IS NULL OR d.content_seq < v.seq)`,
      [ids, texts, seqs]
    );
    log.debug(`applied ${items.length} projection row(s) to backend DB`);
  }
}
