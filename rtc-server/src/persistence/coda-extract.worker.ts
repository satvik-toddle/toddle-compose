import { parentPort } from "worker_threads";
import { extractCodaHtmlSync } from "./coda-extract.core";

// Worker entry: one HTML extraction per spawned worker, then the parent terminates it. A fresh worker
// per request gives each doc its own module registry — no EmbedMediaStore/LastValidSrcMap or jsdom
// global bleed across docs (design C6) — and keeps DOM globals off the main WS event loop (C2).

if (!parentPort) {
  throw new Error("coda-extract.worker must be run as a worker thread");
}

parentPort.on("message", (bytes: Uint8Array) => {
  const result = extractCodaHtmlSync(bytes);
  parentPort!.postMessage(result);
});
