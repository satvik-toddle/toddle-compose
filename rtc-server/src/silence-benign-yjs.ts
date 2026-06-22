// Drops one benign Yjs log emitted when @lexical/yjs observers transiently read the shared type mid state-integration; output is verified correct, so it's noise.
// Importing installs the filter per-thread (main loop + each extraction worker); global flag keeps it idempotent so repeated imports don't stack wrappers.
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
