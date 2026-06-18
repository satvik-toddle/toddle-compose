import { Injectable } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable, Subject, interval, merge, timer } from "rxjs";
import { filter, map, takeUntil } from "rxjs/operators";

export type WorkspaceEvent =
  | { type: "document.created"; document: unknown }
  | { type: "document.updated"; document: unknown }
  | { type: "document.deleted"; id: string };

type Envelope = { workspaceId: string; event: WorkspaceEvent };

const HEARTBEAT_MS = 25_000;

// Workspace-scoped fan-out for sidebar-affecting metadata changes. Services publish after a
// committed write; every member streaming that workspace gets the event live.
// In-memory + per-instance: with N replicas a publish only reaches clients on the same instance —
// bridge through Redis pub/sub when scaling out.
@Injectable()
export class WorkspaceEventsService {
  private readonly stream$ = new Subject<Envelope>();

  publish(workspaceId: string, event: WorkspaceEvent): void {
    this.stream$.next({ workspaceId, event });
  }

  documentCreated(workspaceId: string, document: unknown): void {
    this.publish(workspaceId, { type: "document.created", document });
  }

  documentUpdated(workspaceId: string, document: unknown): void {
    this.publish(workspaceId, { type: "document.updated", document });
  }

  documentDeleted(workspaceId: string, id: string): void {
    this.publish(workspaceId, { type: "document.deleted", id });
  }

  // `tokenExpSec` (the JWT `exp`, seconds) closes the stream at expiry so a stale token can't hold
  // it open; the client reconnects with a refreshed token.
  subscribe(workspaceId: string, tokenExpSec?: number): Observable<MessageEvent> {
    const events$ = this.stream$.pipe(
      filter((e) => e.workspaceId === workspaceId),
      map((e): MessageEvent => ({ data: e.event }))
    );
    // Keeps the connection (and any proxy in front of it) alive while idle.
    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ data: { type: "ping" } }))
    );
    const merged = merge(events$, heartbeat$);
    if (typeof tokenExpSec !== "number") return merged;
    const ttlMs = Math.max(0, tokenExpSec * 1000 - Date.now());
    return merged.pipe(takeUntil(timer(ttlMs)));
  }
}
