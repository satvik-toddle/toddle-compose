import { MigrationJob } from "@app/database";

// A job is still in-flight (blocks a double-submit, is cancelable) in these states.
// Single source of truth — imported by the services and interpolated into the
// correctness-critical claim/cascade/finalize SQL.
export const NON_TERMINAL_JOB_STATUSES = ["QUEUED", "RUNNING"] as const;

export function isNonTerminalJob(status: MigrationJob["status"]): boolean {
  return (NON_TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}
