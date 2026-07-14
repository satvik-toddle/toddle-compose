import { parentPort } from "worker_threads";
import { extractFromBytesSync } from "./lexical-extract.core";
import {
  buildOpsUpdate,
  buildHtmlReplaceUpdate,
  ContentOpError,
  type ContentOp,
} from "../content/content-builder";

// Worker entry: runs CPU-heavy headless-Lexical work (extraction + op-delta building) off the main
// loop, posting a result keyed by id. Errors are returned as a message (with an opError flag so the
// main thread can rethrow ContentOpError vs a generic Error) rather than crashing the worker.

type WorkerRequest =
  | { id: number; kind: "extract"; bytes: Uint8Array }
  | { id: number; kind: "build"; base: Uint8Array | null; ops: ContentOp[] }
  | { id: number; kind: "buildHtml"; base: Uint8Array | null; html: string };

if (!parentPort) {
  throw new Error("lexical-extract.worker must be run as a worker thread");
}

parentPort.on("message", (req: WorkerRequest) => {
  try {
    if (req.kind === "extract") {
      parentPort!.postMessage({ id: req.id, kind: "extract", result: extractFromBytesSync(req.bytes) });
    } else if (req.kind === "buildHtml") {
      const delta = buildHtmlReplaceUpdate(req.base, req.html);
      parentPort!.postMessage({ id: req.id, kind: "build", delta });
    } else {
      const delta = buildOpsUpdate(req.base, req.ops);
      parentPort!.postMessage({ id: req.id, kind: "build", delta });
    }
  } catch (e) {
    parentPort!.postMessage({
      id: req.id,
      kind: "error",
      opError: e instanceof ContentOpError,
      message: e instanceof Error ? e.message : String(e),
    });
  }
});
