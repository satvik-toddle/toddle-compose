import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createLogger } from "../logger";
import type { Env } from "../config/env";

const log = createLogger("backend");

// Pushes a doc's plain-text projection to the backend (X-Internal-Token authed) so content
// search runs there, trigram-indexed, without loading this collab server. Best-effort: a
// failed push is logged and dropped — the next flush retries, and search tolerates lag.
@Injectable()
export class BackendInternalClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async pushContent(docId: string, text: string): Promise<void> {
    const base = this.config.get("BACKEND_INTERNAL_URL", { infer: true });
    const token = this.config.get("INTERNAL_TOKEN", { infer: true });
    try {
      const res = await fetch(
        `${base}/api/internal/documents/${encodeURIComponent(docId)}/content`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Internal-Token": token },
          body: JSON.stringify({ text }),
        }
      );
      if (!res.ok) log.warn(`pushContent '${docId}' → ${res.status}`);
    } catch (e) {
      log.warn(`pushContent '${docId}' failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
