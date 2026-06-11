import { parentPort } from "worker_threads";
import { extractFromBytesSync } from "./lexical-extract.core";

// Worker entry: receives { id, bytes }, runs the CPU-heavy headless-Lexical
// extraction off the main event loop, and posts the result back keyed by id.
// extractFromBytesSync never throws (it returns a null/empty result on failure),
// so every request gets exactly one response.

type ExtractRequest = { id: number; bytes: Uint8Array };

if (!parentPort) {
  throw new Error("lexical-extract.worker must be run as a worker thread");
}

parentPort.on("message", ({ id, bytes }: ExtractRequest) => {
  const result = extractFromBytesSync(bytes);
  parentPort!.postMessage({ id, ...result });
});
