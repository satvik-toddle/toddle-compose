// Idempotently drop ONE known-benign console line emitted during headless
// Lexical↔Yjs extraction/build: "Invalid access: Add Yjs type to a document
// before reading data." It surfaces because @lexical/yjs's own internal
// observers transiently read the shared type mid-integration while a full Yjs
// state is applied. It is benign — the discrete editor flush rebuilds the
// editor state correctly and the extracted/produced output is verified — but
// Yjs prints the uncaught observer error, spamming logs.
//
// Importing this module installs the filter for the current thread (the main
// loop AND each extraction worker import it). Only this exact substring is
// dropped; every other console message passes through untouched. Idempotent via
// a global flag so repeated imports don't stack wrappers.
const FLAG = "__rtcBenignYjsSilenced__";
const g = globalThis as unknown as Record<string, boolean>;

if (!g[FLAG]) {
  g[FLAG] = true;
  const BENIGN = "Add Yjs type to a document before reading data";
  const isBenign = (args: unknown[]): boolean =>
    typeof args[0] === "string" && args[0].includes(BENIGN);

  for (const channel of ["error", "warn", "log"] as const) {
    const orig = console[channel].bind(console);
    console[channel] = (...args: unknown[]): void => {
      if (isBenign(args)) return;
      orig(...args);
    };
  }
}

export {};
