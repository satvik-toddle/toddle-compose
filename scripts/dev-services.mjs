// Runs the three dev servers together; if one fails, the rest are killed and the culprit's last log lines are replayed.
import concurrently from 'concurrently';

const TAIL_LINES = 30;
const tty = process.stderr.isTTY;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

const { result, commands } = concurrently(
  [
    { command: 'pnpm --filter backend dev', name: 'backend', prefixColor: 'blue' },
    { command: 'pnpm --filter rtc-server dev', name: 'rtc', prefixColor: 'magenta' },
    { command: 'pnpm --filter rtc-server dev:indexer', name: 'indexer', prefixColor: 'yellow' },
    { command: 'pnpm --filter frontend dev', name: 'frontend', prefixColor: 'green' },
  ],
  { killOthersOn: ['failure'] },
);

// Rolling per-service output tail so the failing service's logs can be replayed at the end.
const tails = new Map(commands.map((c) => [c.name, []]));
const flushes = [];
for (const c of commands) {
  const tail = tails.get(c.name);
  const push = (line) => {
    tail.push(line);
    if (tail.length > TAIL_LINES) tail.splice(0, tail.length - TAIL_LINES);
  };
  const subscribe = (stream) => {
    let carry = '';
    // A fatal line written without a trailing \n stays in carry — flush it on stream end (and again before replay).
    const flush = () => {
      if (carry.trim() !== '') push(carry);
      carry = '';
    };
    flushes.push(flush);
    stream.subscribe({
      next: (chunk) => {
        const lines = (carry + chunk.toString()).split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) if (line.trim() !== '') push(line);
      },
      error: flush,
      complete: flush,
    });
  };
  subscribe(c.stdout);
  subscribe(c.stderr);
}
const flushTails = () => flushes.forEach((f) => f());

result.then(
  () => process.exit(0),
  (closeEvents) => {
    flushTails();
    const events = Array.isArray(closeEvents) ? closeEvents : [];
    // Failures we didn't cause: numeric exitCode = the process exited non-zero, string exitCode = it died from a signal (e.g. SIGSEGV).
    const failures = events.filter((e) => !e.killed && e.exitCode !== 0);
    // When EVERY service died from an external signal at once (terminal close, kill of the group), there is no culprit to blame.
    const externalStop = failures.length === events.length && failures.every((e) => typeof e.exitCode === 'string');
    const culprit = externalStop ? undefined : failures[0];
    if (culprit) {
      const name = culprit.command.name;
      const cause = typeof culprit.exitCode === 'number' ? `exit code ${culprit.exitCode}` : `signal ${culprit.exitCode}`;
      console.error(`\n${paint(31, `✗ Script ended: ${name} failed to start or crashed (${cause}). Shut down all other services.`)}`);
      const tail = tails.get(name) ?? [];
      if (tail.length > 0) {
        console.error(`\n${paint(2, `── last output from ${name} ──`)}`);
        for (const line of tail) console.error(`  ${line}`);
        console.error(paint(2, `── end of ${name} output ──`));
      }
    } else {
      console.error(`\n${paint(33, '! Script ended: dev services stopped.')}`);
    }
    process.exit(1);
  },
);
