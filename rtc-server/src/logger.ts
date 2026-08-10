const LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

const COLORS: Record<LogLevel, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const envLevel = (process.env.LOG_LEVEL ?? "debug").toLowerCase() as LogLevel;
const minIdx = Math.max(
  0,
  LEVELS.indexOf(LEVELS.includes(envLevel) ? envLevel : "debug")
);

function ts(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function fmtArg(a: unknown): string {
  if (a == null) return String(a);
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack ?? a.message;
  if (Buffer.isBuffer(a)) return `<Buffer ${a.byteLength}B>`;
  if (a instanceof Uint8Array) return `<Uint8Array ${a.byteLength}B>`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function emit(level: LogLevel, scope: string, args: unknown[]) {
  const idx = LEVELS.indexOf(level);
  if (idx < minIdx) return;
  const color = COLORS[level];
  const head = `${DIM}${ts()}${RESET} ${color}${level.toUpperCase().padEnd(5)}${RESET} ${DIM}[rtc:${scope}]${RESET}`;
  const body = args.map(fmtArg).join(" ");
  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  fn(`${head} ${body}`);
}

export type Logger = {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (subscope: string) => Logger;
};

export function createLogger(scope: string): Logger {
  return {
    trace: (...args) => emit("trace", scope, args),
    debug: (...args) => emit("debug", scope, args),
    info: (...args) => emit("info", scope, args),
    warn: (...args) => emit("warn", scope, args),
    error: (...args) => emit("error", scope, args),
    child: (subscope: string) => createLogger(`${scope}:${subscope}`),
  };
}

export function decodeYFrame(buf: Buffer): string {
  if (buf.length < 1) return "empty";
  const type = buf[0];
  if (type === 0) {
    if (buf.length < 2) return "sync(?)";
    const sub = buf[1];
    if (sub === 0) return `sync.step1 sv=${buf.byteLength}B`;
    if (sub === 1) return `sync.step2 update=${buf.byteLength}B`;
    if (sub === 2) return `sync.update update=${buf.byteLength}B`;
    return `sync.sub${sub} ${buf.byteLength}B`;
  }
  if (type === 1) return `awareness ${buf.byteLength}B`;
  if (type === 2) return `auth ${buf.byteLength}B`;
  if (type === 3) return `queryAwareness ${buf.byteLength}B`;
  return `unknown(type=${type}) ${buf.byteLength}B`;
}

let connSeq = 0;
export function nextConnId(): string {
  connSeq += 1;
  return `c${connSeq.toString(36)}`;
}
