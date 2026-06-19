#!/usr/bin/env node
// In-process content-builder harness — NO running server needed.
// Builds a Yjs delta from ops via the real headless Lexical↔Yjs binding, then
// extracts the resulting Lexical JSON back (round-tripping through Yjs exactly
// as persistence does). Lets us verify each op/format fast without restarts.
//
//   node harness.cjs            # run the built-in self-tests
//   node harness.cjs --ops '<json ops array>'   # build+extract arbitrary ops
//
// Requires a fresh rtc-server build (dist/). Run `pnpm --filter rtc-server build`
// (or rely on the dev watcher) after editing content-builder.ts.

const path = require("node:path");
const ROOT = path.resolve(__dirname, "../../..");
const dist = (p) => require(path.join(ROOT, "rtc-server/dist", p));

const { buildOpsUpdate } = dist("content/content-builder.js");
const { extractFromBytesSync } = dist("persistence/lexical-extract.core.js");
// Use the EXACT yjs the dist resolves (Node caches by resolved path), so merging
// base+delta here uses the same instance — no cross-instance "Invalid access".
const Y = require(
  require.resolve("yjs", { paths: [path.join(ROOT, "rtc-server/dist/content")] })
);

// Build `ops` on top of an optional `priorOps` baseline and extract the resulting
// Lexical JSON. priorOps simulates a doc that already has content (and, with a
// concurrent edit, what a live user would see) so we can verify edits are additive.
function build(ops, priorOps) {
  const base = priorOps && priorOps.length ? buildOpsUpdate(null, priorOps) : null;
  const delta = buildOpsUpdate(base, ops);
  const doc = new Y.Doc();
  if (base) Y.applyUpdate(doc, base);
  Y.applyUpdate(doc, delta);
  const full = Y.encodeStateAsUpdate(doc);
  const { lexicalJson } = extractFromBytesSync(full);
  if (!lexicalJson) throw new Error("extraction returned null (headless error)");
  return { json: JSON.parse(lexicalJson), bytes: delta.byteLength };
}

// ---- tiny assertion helpers ------------------------------------------------
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg); console.log("  ✗ " + msg); }
}
function walk(node, fn) {
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
}
function find(json, type) {
  const out = [];
  walk(json.root, (n) => { if (n.type === type) out.push(n); });
  return out;
}

module.exports = { build, find, walk };

// ---- CLI -------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const oi = argv.indexOf("--ops");
  if (oi !== -1) {
    const ops = JSON.parse(argv[oi + 1]);
    const { json, bytes } = build(ops);
    console.log(JSON.stringify(json, null, 2));
    console.error(`(${bytes}B delta)`);
    process.exit(0);
  }

  // Self-tests.
  console.log("content-builder harness self-tests\n");

  // table colWidths (the fix target)
  {
    const { json } = build([
      { op: "table", header: true, rows: [["A", "B", "C"], ["1", "2", "3"]] },
    ]);
    const t = find(json, "table")[0];
    console.log("table.colWidths =", JSON.stringify(t.colWidths));
    ok(Array.isArray(t.colWidths) && t.colWidths.length === 3, "table has colWidths[3]");
    if (Array.isArray(t.colWidths)) {
      const sum = t.colWidths.reduce((a, b) => a + b, 0);
      ok(sum === 584, `colWidths sum to page width 584 (got ${sum})`);
    }
  }

  // additive: appending must PRESERVE prior content (no clobber of a live user's doc)
  {
    const prior = [
      { op: "heading", level: 1, text: "Existing Title" },
      { op: "paragraph", text: "pre-existing paragraph" },
    ];
    const { json } = build([{ op: "paragraph", text: "appended paragraph" }], prior);
    const texts = [];
    walk(json.root, (n) => { if (n.type === "text") texts.push(n.text); });
    ok(texts.includes("Existing Title"), "additive: prior heading preserved");
    ok(texts.includes("pre-existing paragraph"), "additive: prior paragraph preserved");
    ok(texts.includes("appended paragraph"), "additive: new paragraph present");
    ok(find(json, "heading").length === 1 && find(json, "paragraph").length === 2,
      "additive: exactly prior + new nodes (no duplication/loss)");
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
