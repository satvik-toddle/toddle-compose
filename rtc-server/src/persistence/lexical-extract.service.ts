import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "worker_threads";
import { join } from "path";
import { createLogger } from "../logger";
import { extractFromBytesSync, type ExtractResult } from "./lexical-extract.core";
import type { Env } from "../config/env";

const log = createLogger("extract");

type Task = {
  id: number;
  bytes: Uint8Array;
  resolve: (r: ExtractResult) => void;
};

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
      this.queue.push({ id: this.nextId++, bytes: stateUpdate, resolve });
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
    worker.on("message", (msg: { id: number } & ExtractResult) => {
      const task = this.inFlight.get(worker);
      this.inFlight.delete(worker);
      this.idle.push(worker);
      if (task && task.id === msg.id) {
        task.resolve({ lexicalJson: msg.lexicalJson, plainText: msg.plainText });
      } else if (task) {
        // Shouldn't happen (one in-flight task per worker); extract inline so the flush isn't lost.
        log.error(`worker answered id=${msg.id} but task id=${task.id}`);
        task.resolve(extractFromBytesSync(task.bytes));
      }
      this.dispatch();
    });
    const onDeath = (err?: unknown) => {
      if (err) log.error("extraction worker died", err);
      const task = this.inFlight.get(worker);
      this.inFlight.delete(worker);
      this.idle = this.idle.filter((w) => w !== worker);
      this.workers = this.workers.filter((w) => w !== worker);
      // Resolve the orphaned task inline so its flush still completes.
      if (task) task.resolve(extractFromBytesSync(task.bytes));
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
      worker.postMessage({ id: task.id, bytes: task.bytes });
    }
    if (this.poolBroken || this.workers.length === 0) {
      // No live worker can pick these up; drain inline so no task hangs unresolved.
      for (const task of this.queue.splice(0)) {
        task.resolve(extractFromBytesSync(task.bytes));
      }
    }
  }
}
