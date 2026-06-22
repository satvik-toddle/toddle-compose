import type { Request, Response, NextFunction } from "express";

// Lightweight request timing. No request context / async storage: each timed
// section logs its own duration to the console as it finishes. Read the lines
// in order to see what a request spent time on, e.g.:
//
//   [trace] POST /api/documents 201 187.3ms
//   [trace] db Document.create 120.4ms
//   [trace] storage.put 55.1ms
//
// Disabled in tests and when TRACE_REQUESTS=false.

export function traceEnabled(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  return process.env.TRACE_REQUESTS !== "false";
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

/** Express middleware that logs total time + status for every request. */
export function traceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
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
  // `finish` = response fully sent; `close` covers aborted connections.
  res.on("finish", done);
  res.on("close", done);
  next();
}
