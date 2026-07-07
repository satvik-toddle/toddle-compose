// Runs the three dev servers together. If any one fails, the others are killed
// and the script exits with a message naming the culprit plus its last log lines.
import concurrently from 'concurrently';

const TAIL_LINES = 30;

const { result, commands } = concurrently(
  [
    { command: 'pnpm --filter backend dev', name: 'backend', prefixColor: 'blue' },
    { command: 'pnpm --filter rtc-server dev', name: 'rtc', prefixColor: 'magenta' },
    { command: 'pnpm --filter frontend dev', name: 'frontend', prefixColor: 'green' },
  ],
  { killOthers: ['failure'] },
);

// Keep a rolling tail of each service's output so we can replay the failing
// service's logs after the (interleaved) live output has scrolled by.
const tails = new Map(commands.map((c) => [c.name, []]));
for (const c of commands) {
  const record = (chunk) => {
    const tail = tails.get(c.name);
    tail.push(...chunk.toString().split('\n').filter((l) => l.trim() !== ''));
    if (tail.length > TAIL_LINES) tail.splice(0, tail.length - TAIL_LINES);
  };
  c.stdout.subscribe(record);
  c.stderr.subscribe(record);
}

result.then(
  () => process.exit(0),
  (closeEvents) => {
    // The culprit is the service that exited non-zero on its own; the rest were
    // killed by us (SIGTERM) or by the user's Ctrl+C (signal exits).
    const culprit = Array.isArray(closeEvents)
      ? closeEvents.find((e) => !e.killed && typeof e.exitCode === 'number' && e.exitCode !== 0)
      : undefined;
    if (culprit) {
      const name = culprit.command.name;
      console.error(`\n\x1b[31m✗ Script ended: ${name} failed to start or crashed (exit code ${culprit.exitCode}). Shut down all other services.\x1b[0m`);
      const tail = tails.get(name) ?? [];
      if (tail.length > 0) {
        console.error(`\n\x1b[2m── last output from ${name} ──\x1b[0m`);
        for (const line of tail) console.error(`  ${line}`);
        console.error(`\x1b[2m── end of ${name} output ──\x1b[0m`);
      }
    } else {
      console.error('\n\x1b[33m! Script ended: dev services stopped.\x1b[0m');
    }
    process.exit(1);
  },
);
