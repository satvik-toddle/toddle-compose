import { Injectable } from "@nestjs/common";
import type { WebSocket } from "ws";
import { createLogger } from "../logger";

const log = createLogger("lock");

// Backstop TTL: a lock with no heartbeat for this long is reclaimed (covers a
// crashed/disconnected client whose release never arrived). Normal release is
// explicit (blur / AFK), so this only matters for ungraceful exits.
const LOCK_TTL_MS = 15_000;
const SWEEP_MS = 5_000;

type Lock = { owner: string; ws: WebSocket; ts: number };

/**
 * Authoritative, in-memory cell-lock registry. The rtc-server is the single
 * arbiter: a client asks to lock a cell (rowId:colId) before editing; the
 * server grants it only if free (or already held by the same user), so two
 * near-simultaneous clicks resolve to exactly one winner. Locks are released on
 * request, on disconnect, or by TTL sweep. State is broadcast as a per-doc
 * snapshot so every client knows which cells are locked and by whom.
 */
@Injectable()
export class LockService {
  // docId -> (cellKey -> Lock)
  private readonly locks = new Map<string, Map<string, Lock>>();
  // docId -> set of lock-channel sockets (for broadcast)
  private readonly conns = new Map<string, Set<WebSocket>>();

  constructor() {
    const sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    if (typeof sweeper.unref === "function") sweeper.unref();
  }

  register(docId: string, ws: WebSocket): void {
    let set = this.conns.get(docId);
    if (!set) {
      set = new Set();
      this.conns.set(docId, set);
    }
    set.add(ws);
    this.sendSnapshot(docId, ws); // newcomer gets current state immediately
  }

  unregister(docId: string, ws: WebSocket, sub: string): void {
    this.conns.get(docId)?.delete(ws);
    if (this.conns.get(docId)?.size === 0) this.conns.delete(docId);
    const cells = this.locks.get(docId);
    if (!cells) return;
    let changed = false;
    for (const [key, lock] of [...cells]) {
      if (lock.ws === ws) {
        cells.delete(key);
        changed = true;
      }
    }
    if (cells.size === 0) this.locks.delete(docId);
    if (changed) {
      log.info(`released locks of sub=${sub} on disconnect doc='${docId}'`);
      this.broadcast(docId);
    }
  }

  handleMessage(
    docId: string,
    sub: string,
    role: string,
    ws: WebSocket,
    raw: string
  ): void {
    if (role === "viewer") return; // viewers never hold write locks
    let msg: { op?: string; cell?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const cell = typeof msg.cell === "string" ? msg.cell : null;
    if (!cell) return;
    if (msg.op === "acquire") {
      const granted = this.acquire(docId, cell, sub, ws);
      try {
        ws.send(JSON.stringify({ type: "ack", cell, granted }));
      } catch {
        /* socket closing */
      }
    } else if (msg.op === "release") {
      this.release(docId, cell, sub);
    } else if (msg.op === "heartbeat") {
      this.heartbeat(docId, cell, sub);
    }
  }

  private acquire(
    docId: string,
    cellKey: string,
    sub: string,
    ws: WebSocket
  ): boolean {
    let cells = this.locks.get(docId);
    if (!cells) {
      cells = new Map();
      this.locks.set(docId, cells);
    }
    const cur = cells.get(cellKey);
    if (cur && cur.owner !== sub && Date.now() - cur.ts < LOCK_TTL_MS) {
      return false; // held by someone else and still fresh → deny
    }
    cells.set(cellKey, { owner: sub, ws, ts: Date.now() });
    this.broadcast(docId);
    return true;
  }

  private release(docId: string, cellKey: string, sub: string): void {
    const cells = this.locks.get(docId);
    const cur = cells?.get(cellKey);
    if (!cells || !cur || cur.owner !== sub) return;
    cells.delete(cellKey);
    if (cells.size === 0) this.locks.delete(docId);
    this.broadcast(docId);
  }

  private heartbeat(docId: string, cellKey: string, sub: string): void {
    const cur = this.locks.get(docId)?.get(cellKey);
    if (cur && cur.owner === sub) cur.ts = Date.now();
  }

  private snapshot(docId: string): Record<string, string> {
    const out: Record<string, string> = {};
    const cells = this.locks.get(docId);
    if (cells) for (const [k, l] of cells) out[k] = l.owner;
    return out;
  }

  private sendSnapshot(docId: string, ws: WebSocket): void {
    try {
      ws.send(JSON.stringify({ type: "snapshot", locks: this.snapshot(docId) }));
    } catch {
      /* socket closing */
    }
  }

  private broadcast(docId: string): void {
    const set = this.conns.get(docId);
    if (!set) return;
    const msg = JSON.stringify({ type: "snapshot", locks: this.snapshot(docId) });
    for (const ws of set) {
      try {
        ws.send(msg);
      } catch {
        /* socket closing */
      }
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [docId, cells] of [...this.locks]) {
      let changed = false;
      for (const [key, lock] of [...cells]) {
        if (now - lock.ts >= LOCK_TTL_MS) {
          cells.delete(key);
          changed = true;
        }
      }
      if (cells.size === 0) this.locks.delete(docId);
      if (changed) this.broadcast(docId);
    }
  }
}
