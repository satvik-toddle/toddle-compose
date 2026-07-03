import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "worker_threads";
import { join } from "path";
import { createLogger } from "../logger";
import { extractFromBytesSync, type ExtractResult } from "./lexical-extract.core";
import {
  buildOpsUpdate,
  ContentOpError,
  type ContentOp,
} from "../content/content-builder";
import type { Env } from "../config/env";

const log = createLogger("extract");

// A queued unit of CPU-heavy work. Each task knows how to send itself to a worker, settle from the
// worker's reply, and settle inline (main-thread fallback when no worker is available) — so the pool
// machinery stays generic across extract and build-ops without branching on kind everywhere.
type Task = {
  id: number;
  send: (worker: Worker) => void;
  settleFromWorker: (msg: WorkerResponse) => void;
  settleInline: () => void;
};

type WorkerResponse =
  | { id: number; kind: "extract"; result: ExtractResult }
  | { id: number; kind: "build"; delta: Uint8Array }
  | { id: number; kind: "error"; opError: boolean; message: string };

// Headless-Lexical extraction on a worker pool (CPU-heavy; would stall all WebSockets on the main thread). Falls back to inline if workers can't spawn/die.
@Injectable()
export class LexicalExtractService implements OnApplicationShutdown {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private readonly queue: Task[] = [];
  private readonly inFlight = new Map<Worker, Task>();
  private nextId = 1;
  private started = false;
  private poolBroken = false;
  private shuttingDown = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async extractFromBytes(stateUpdate: Uint8Array): Promise<ExtractResult> {
    this.ensurePool();
    if (this.poolBroken) return extractFromBytesSync(stateUpdate);
    return new Promise<ExtractResult>((resolve) => {
      const id = this.nextId++;
      this.queue.push({
        id,
        send: (w) => w.postMessage({ id, kind: "extract", bytes: stateUpdate }),
        settleFromWorker: (msg) =>
          resolve(
            msg.kind === "extract" ? msg.result : extractFromBytesSync(stateUpdate)
          ),
        settleInline: () => resolve(extractFromBytesSync(stateUpdate)),
      });
      this.dispatch();
    });
  }

  // Build an ops delta off the main thread (buildOpsUpdate hydrates the whole doc through a headless
  // editor — CPU-heavy). ContentOpError from invalid ops is preserved across the worker boundary so
  // the controller still maps it to 400; infra/other errors reject as plain Errors (→ 5xx).
  async buildOps(base: Uint8Array | null, ops: ContentOp[]): Promise<Uint8Array> {
    this.ensurePool();
    if (this.poolBroken) return buildOpsUpdate(base, ops);
    return new Promise<Uint8Array>((resolve, reject) => {
      const id = this.nextId++;
      const inline = () => {
        try {
          resolve(buildOpsUpdate(base, ops));
        } catch (e) {
          reject(e);
        }
      };
      this.queue.push({
        id,
        send: (w) => w.postMessage({ id, kind: "build", base, ops }),
        settleFromWorker: (msg) => {
          if (msg.kind === "build") resolve(msg.delta);
          else if (msg.kind === "error")
            reject(msg.opError ? new ContentOpError(msg.message) : new Error(msg.message));
          else inline();
        },
        settleInline: inline,
      });
      this.dispatch();
    });
  }

  onApplicationShutdown(): void {
    // terminate() fires 'exit' with code 1; the flag keeps onDeath from respawning the pool.
    this.shuttingDown = true;
    for (const w of this.workers) void w.terminate();
    this.workers = [];
    this.idle = [];
  }

  private ensurePool(): void {
    if (this.started) return;
    this.started = true;
    const size = this.config.get("RTC_EXTRACT_WORKERS", { infer: true });
    try {
      for (let i = 0; i < size; i++) this.spawnWorker();
      log.info(`extraction worker pool started (${size} worker(s))`);
    } catch (e) {
      this.poolBroken = true;
      log.error(
        "failed to start extraction workers — falling back to main-thread extraction",
        e
      );
    }
  }

  private spawnWorker(): void {
    const worker = new Worker(join(__dirname, "lexical-extract.worker.js"));
    worker.unref();
    worker.on("message", (msg: WorkerResponse) => {
      const task = this.inFlight.get(worker);
      this.inFlight.delete(worker);
      this.idle.push(worker);
      if (task && task.id === msg.id) {
        task.settleFromWorker(msg);
      } else if (task) {
        // Shouldn't happen (one in-flight task per worker); settle inline so nothing is lost.
        log.error(`worker answered id=${msg.id} but task id=${task.id}`);
        task.settleInline();
      }
      this.dispatch();
    });
    const onDeath = (err?: unknown) => {
      if (err) log.error("extraction worker died", err);
      const task = this.inFlight.get(worker);
      this.inFlight.delete(worker);
      this.idle = this.idle.filter((w) => w !== worker);
      this.workers = this.workers.filter((w) => w !== worker);
      // Settle the orphaned task inline so its caller still completes.
      if (task) task.settleInline();
      // terminate() fires 'exit' during shutdown; the flag stops us respawning the pool.
      if (this.shuttingDown) return;
      try {
        this.spawnWorker();
      } catch (e) {
        log.error("respawn of extraction worker failed", e);
        if (this.workers.length === 0) this.poolBroken = true;
      }
      this.dispatch();
    };
    worker.on("error", onDeath);
    worker.on("exit", (code) => {
      if (code !== 0) onDeath(new Error(`worker exited with code ${code}`));
    });
    this.workers.push(worker);
    this.idle.push(worker);
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const task = this.queue.shift()!;
      this.inFlight.set(worker, task);
      task.send(worker);
    }
    if (this.poolBroken || this.workers.length === 0) {
      // No live worker can pick these up; drain inline so no task hangs unresolved.
      for (const task of this.queue.splice(0)) task.settleInline();
    }
  }
}
