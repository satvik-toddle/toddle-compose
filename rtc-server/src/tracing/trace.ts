import type { IncomingMessage, ServerResponse } from "node:http";

// Lightweight request timing. No request context / async storage: each timed
// section logs its own duration to the console as it finishes. Read the lines
// in order to see what a request spent time on, e.g.:
//
//   [trace] POST /internal/flush 200 42.7ms
//   [trace] db DocUpdate.create 21.0ms
//
// HTTP only — WebSocket/Yjs frame handling is timed separately by the ws layer.
// Off by default; enable by setting TRACE_REQUESTS=true (validated in
// config/env.ts and applied at bootstrap via setTracingEnabled).

// Cached at startup from the validated env so the middleware and trace() helper
// never read process.env per call. Defaults off, so tests and any context that
// doesn't bootstrap stay silent.
let enabled = false;

/** Apply the validated TRACE_REQUESTS value. Call once during bootstrap. */
export function setTracingEnabled(on: boolean): void {
  enabled = on;
}

export function traceEnabled(): boolean {
  return enabled;
}

/** Time a section of work and log its duration. Safe to call anywhere; when
 * tracing is off it just runs fn. */
export async function trace<T>(
  name: string,
  fn: () => Promise<T> | T
): Promise<T> {
  if (!traceEnabled()) return await fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[trace] ${name} ${(performance.now() - start).toFixed(1)}ms`);
  }
}

/** Express/HTTP middleware that logs total time + status for every request. */
export function traceMiddleware(
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
  next: () => void
): void {
  if (!traceEnabled()) return next();
  const start = performance.now();
  const label = `${req.method} ${req.originalUrl ?? req.url}`;
  let flushed = false;
  const done = () => {
    if (flushed) return;
    flushed = true;
    const ms = (performance.now() - start).toFixed(1);
    console.log(`[trace] ${label} ${res.statusCode} ${ms}ms`);
  };
  res.on("finish", done);
  res.on("close", done);
  next();
}
