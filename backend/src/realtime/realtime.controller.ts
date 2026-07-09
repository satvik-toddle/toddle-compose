import { Controller, Param, Req, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import { WorkspaceEventsService } from "./realtime.service";
import { WorkspaceStreamGuard } from "./workspace-stream.guard";

@Controller("realtime")
export class RealtimeController {
  constructor(private readonly events: WorkspaceEventsService) {}

  // GET /api/realtime/workspaces/:workspaceId/stream?token=<access-jwt>
  @UseGuards(WorkspaceStreamGuard)
  @Sse("workspaces/:workspaceId/stream")
  stream(
    @Param("workspaceId") workspaceId: string,
    @Req() req: { tokenExp?: number; guestDocIds?: string[] | null }
  ): Observable<MessageEvent> {
    return this.events.subscribe(workspaceId, {
      tokenExpSec: req.tokenExp,
      guestDocIds: req.guestDocIds ?? null,
    });
  }
}
