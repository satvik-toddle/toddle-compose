import {
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { CodaImportWorkerService } from "./coda-import-worker.service";

// The wake-up ping endpoint for the STANDALONE import-worker process. The backend's
// enqueue POSTs here (fire-and-forget) so a freshly-QUEUED job is picked up at once
// instead of on the next self-arm tick. Authed with the shared INTERNAL_TOKEN via the
// X-Internal-Token header (same secret the rtc internal channel uses). Kept at the ROOT
// path (/run, not /api/run) to match what CodaImportWorkerClient pings.
@Controller()
export class CodaImportWorkerController {
  constructor(
    private readonly worker: CodaImportWorkerService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post("run")
  @HttpCode(202)
  run(@Headers("x-internal-token") token?: string): { ok: true } {
    if (token !== this.config.get("INTERNAL_TOKEN", { infer: true })) {
      throw new UnauthorizedException("invalid internal token");
    }
    // Fire-and-forget: kick a tick and return 202 immediately — the run completes in
    // the background (the worker's ticking guard collapses concurrent pings into one).
    this.worker.wake();
    return { ok: true };
  }
}
