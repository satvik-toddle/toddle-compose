import { Rng } from "./rng";
import type { FakeCodaConfig } from "./fake-coda";

// Optional per-BATCH dimension biases (env) so successive batches deliberately vary
// coverage while the per-seed RNG still makes every scenario reproducible:
//   SIM_MIN_NODES / SIM_MAX_NODES  clamp tree size
//   SIM_FAULT                      force this transient-fault probability
//   SIM_MAT_MAX                    upper bound on materialization polls (slow docs)
//   SIM_CHAOS=1                    force a chaos scenario (deletes/empties/override)
//   SIM_EXTDEL=1                   force external page deletes likely
//   SIM_CHUNK=1                    force tiny CODA_MAX_HTML_BYTES (chunk streaming)
const TUNE = {
  minNodes: envNum("SIM_MIN_NODES"),
  maxNodes: envNum("SIM_MAX_NODES"),
  fault: envNum("SIM_FAULT"),
  matMax: envNum("SIM_MAT_MAX"),
  chaos: process.env.SIM_CHAOS === "1",
  extDel: process.env.SIM_EXTDEL === "1",
  chunk: process.env.SIM_CHUNK === "1",
};
function envNum(k: string): number | undefined {
  const v = process.env[k];
  return v === undefined || v === "" ? undefined : Number(v);
}
function clamp(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return n;
}

// A single node in the user-arranged migration tree.
export interface ScenarioNode {
  docId: string;
  plannedParentDocId: string | null;
  title: string;
  // Frozen content the doc has at enqueue (what FakeRtc returns).
  html: string;
  isEmpty: boolean;
  // "Update existing" row → override an existing Coda page (H3) instead of create.
  override: boolean;
  // Pre-existing Coda page id this override targets (registered in FakeCoda).
  overrideTargetPageId?: string;
  // Source becomes unreadable/deleted at RUN time (P2/D7) — skipped, never pushed.
  unreadableAtRun: boolean;
}

export interface Scenario {
  seed: number;
  nodes: ScenarioNode[];
  rootDocId: string;
  // Scope destination: whole-doc (codaRootPageId null) or nest-under-a-page.
  scope: {
    codaDocId: string;
    codaRootPageId: string | null;
    codaRootUrl: string;
    rootPageName: string;
  };
  maxHtmlBytes: number;
  fakeCoda: FakeCodaConfig;
  // A "pure transient" scenario has NO permanent ground-truth changes (no external
  // delete, no unreadable source, no override, no empty doc) — so once the injected
  // transient faults recover, EVERY item MUST reach SUCCEEDED (invariant 4).
  pureTransient: boolean;
  // Simulate a crashed worker: flip legitimately-claimable items to an expired lease
  // so a fresh tick reclaims them (D9). Injected during the drive.
  injectDeadLease: boolean;
  // After the first convergence, exercise the retry() endpoint + re-drive (inv48):
  // FAILED/orphan items must recover via the SAME page (no duplicate creates).
  retryAfterFail: boolean;
}

// A block of HTML sized to (optionally) force multi-chunk streaming (H8).
function makeHtml(rng: Rng, docId: string, big: boolean): string {
  const blocks = big ? rng.int(3, 8) : rng.int(1, 3);
  let out = "";
  for (let i = 0; i < blocks; i++) {
    const filler = "x".repeat(big ? rng.int(40, 120) : rng.int(1, 20));
    out += `<p>doc ${docId} block ${i} ${filler}</p>`;
  }
  return out;
}

export function generateScenario(seed: number): Scenario {
  const rng = new Rng(seed);

  // Tree size: heavily weighted small (fast), with a long tail of larger trees, and
  // occasional single-node / deep / bushy shapes for coverage.
  const sizeRoll = rng.next();
  const nodeCount = clamp(
    sizeRoll < 0.15
      ? 1
      : sizeRoll < 0.7
        ? rng.int(2, 6)
        : sizeRoll < 0.95
          ? rng.int(6, 15)
          : rng.int(15, 30),
    TUNE.minNodes,
    TUNE.maxNodes,
  );

  const shape = rng.pick(["chain", "flat", "random"] as const);
  const chunky = TUNE.chunk || rng.chance(0.25);
  const maxHtmlBytes = chunky ? rng.int(60, 200) : 80_000;

  // Chaos knobs. A scenario is either "pure transient" (recovers to all-SUCCEEDED)
  // or "chaos" (may include permanent ground-truth changes).
  const chaos = TUNE.chaos || rng.chance(0.55);

  const nodes: ScenarioNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const docId = `d${seed}_${i}`;
    let parent: string | null = null;
    if (i > 0) {
      const parentIdx =
        shape === "chain"
          ? i - 1
          : shape === "flat"
            ? 0
            : rng.int(0, i - 1);
      parent = `d${seed}_${parentIdx}`;
    }
    // Root is always non-empty & readable so a converged clean run has ≥1 real page.
    const isRoot = i === 0;
    const empty = !isRoot && chaos && rng.chance(0.12);
    const override = !isRoot && chaos && !empty && rng.chance(0.15);
    const unreadable = !isRoot && chaos && !empty && !override && rng.chance(0.1);
    const big = chunky && !empty;
    nodes.push({
      docId,
      plannedParentDocId: parent,
      title: `Doc-${docId}`,
      html: empty ? "" : makeHtml(rng, docId, big),
      isEmpty: empty,
      override,
      overrideTargetPageId: override ? `ext_target_${docId}` : undefined,
      unreadableAtRun: unreadable,
    });
  }

  const pureTransient =
    !chaos &&
    nodes.every((n) => !n.isEmpty && !n.override && !n.unreadableAtRun);

  // External deletes only in chaos runs; at a few random early op counts.
  const externalDeleteAtOps: number[] = [];
  if (chaos && (TUNE.extDel || rng.chance(0.4))) {
    const count = rng.int(1, 3);
    for (let i = 0; i < count; i++) externalDeleteAtOps.push(rng.int(1, 60));
  }

  // Fault probability + recovery window. Recovery is generous enough that a pure-
  // transient run is guaranteed to eventually get a clean pass at every step.
  const faultProb =
    TUNE.fault !== undefined
      ? TUNE.fault
      : rng.chance(0.3)
        ? 0
        : rng.next() * 0.45;
  const recoverAfterOps = rng.int(20, 200);

  const wholeDoc = rng.chance(0.5);
  const rootPageId = wholeDoc ? null : `ext_root_${seed}`;

  return {
    seed,
    nodes,
    rootDocId: nodes[0].docId,
    scope: {
      codaDocId: `codadoc_${seed}`,
      codaRootPageId: rootPageId,
      codaRootUrl: `https://coda.io/d/sim_${seed}`,
      rootPageName: "Scope Root",
    },
    maxHtmlBytes,
    fakeCoda: {
      faultProb,
      recoverAfterOps,
      // Usually a page materializes within a poll or two, but ~30% of runs model a
      // SLOW-materializing page (large doc, tens of seconds) whose delay exceeds a
      // single poll budget — so it must materialize across RETRIES without ever
      // being falsely marked created-but-FAILED (the reported bug).
      maxMaterializePolls:
        TUNE.matMax !== undefined
          ? rng.int(0, TUNE.matMax)
          : rng.chance(0.3)
            ? rng.int(8, 40)
            : rng.int(0, 3),
      externalDeleteAtOps,
    },
    pureTransient,
    injectDeadLease: rng.chance(0.25),
    retryAfterFail: rng.chance(0.3),
  };
}
