// Content-ops test suite (in-process; no servers).
//
// Exercises every ContentOp the AI-authoring API supports through the REAL
// pipeline the rtc-server uses — buildOpsUpdate (headless Lexical↔Yjs binding)
// to produce deltas, extractFromBytesSync to read the end result back — and
// asserts the extracted document matches expectations.
//
//   Part A: targeted tests — each op type, styles, links, widths, guards, errors.
//   Part B: model-based stress test — 1000+ unique randomized ops applied in
//           batches to one persistent Y.Doc, verified against a JS model of the
//           expected block structure + per-block text after every batch.
//
// Prereq:  pnpm --filter rtc-server build     (loads rtc-server/dist)
// Run:     node tests/content-ops.cjs         (SEED=n for a different stress run)
const path = require("path");

const dist = (p) => require(path.join(__dirname, "..", "rtc-server", "dist", p));
const reqRtc = (p) =>
  require(require.resolve(p, {
    paths: [path.join(__dirname, "..", "rtc-server", "node_modules")],
  }));

const Y = reqRtc("yjs");
const { buildOpsUpdate, hasDestructiveOp } = dist("content/content-builder.js");
const { extractFromBytesSync } = dist("persistence/lexical-extract.core.js");

let pass = 0;
let total = 0;
const t = (n, f) => {
  total++;
  try {
    f();
    pass++;
    console.log("  PASS " + n);
  } catch (e) {
    console.log("  FAIL " + n + "\n        " + (e && e.message ? e.message : e));
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ---- helpers ----------------------------------------------------------------

// Merge updates into one state (what a doc looks like after those deltas applied in order).
const merged = (...updates) => {
  const d = new Y.Doc();
  for (const u of updates) Y.applyUpdate(d, u);
  return Y.encodeStateAsUpdate(d);
};

const rootOf = (...updates) => {
  const r = extractFromBytesSync(merged(...updates));
  assert(r.lexicalJson, "extraction returned no lexicalJson");
  return JSON.parse(r.lexicalJson).root;
};

// All descendant text of a node, in document order.
const textOf = (node) => {
  if (typeof node.text === "string") return node.text;
  return (node.children || []).map(textOf).join("");
};

const findAll = (node, type, out = []) => {
  if (node.type === type) out.push(node);
  for (const c of node.children || []) findAll(c, type, out);
  return out;
};

const throws = (fn, re) => {
  try {
    fn();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    assert(re.test(msg), `threw, but message '${msg}' !~ ${re}`);
    return;
  }
  throw new Error("expected to throw, did not");
};

// ==== Part A — every op, targeted ==============================================
console.log("Part A: targeted per-op tests");

// -- block ops on an empty doc --

t("paragraph: plain text", () => {
  const root = rootOf(buildOpsUpdate(null, [{ op: "paragraph", text: "hello" }]));
  assert(root.children.length === 1, "one block");
  assert(root.children[0].type === "paragraph", "type");
  assert(textOf(root.children[0]) === "hello", "text");
});

t("paragraph: whole-block format + fontSize + color + highlight", () => {
  const root = rootOf(
    buildOpsUpdate(null, [
      { op: "paragraph", text: "styled", format: ["bold", "italic"], fontSize: 20, color: "red", highlight: "yellow" },
    ])
  );
  const txt = findAll(root, "text")[0];
  assert((txt.format & 1) === 1, "bold bit");
  assert((txt.format & 2) === 2, "italic bit");
  assert(txt.style.includes("font-size: 20px;"), "font-size: " + txt.style);
  assert(txt.style.includes("color: red;"), "color");
  assert(txt.style.includes("background-color: yellow;"), "highlight");
});

t("paragraph: runs with per-run style and link", () => {
  const root = rootOf(
    buildOpsUpdate(null, [
      { op: "paragraph", runs: [{ text: "a ", format: ["bold"] }, { text: "b", href: "https://x.test", color: "blue" }] },
    ])
  );
  const p = root.children[0];
  assert(textOf(p) === "a b", "combined text");
  const link = findAll(p, "link")[0];
  assert(link && link.url === "https://x.test", "link url");
  assert(textOf(link) === "b", "link covers run text");
  const texts = findAll(p, "text");
  assert((texts[0].format & 1) === 1, "run 1 bold");
  assert(texts[1].style.includes("color: blue;"), "run 2 color");
});

t("heading: levels 1-3 produce h1/h2/h3", () => {
  const root = rootOf(
    buildOpsUpdate(null, [
      { op: "heading", level: 1, text: "one" },
      { op: "heading", level: 2, text: "two" },
      { op: "heading", level: 3, text: "three" },
    ])
  );
  assert(root.children.map((c) => c.tag).join() === "h1,h2,h3", "tags");
  assert(root.children.map(textOf).join() === "one,two,three", "texts");
});

t("quote", () => {
  const root = rootOf(buildOpsUpdate(null, [{ op: "quote", text: "wise" }]));
  assert(root.children[0].type === "quote" && textOf(root.children[0]) === "wise", "quote");
});

t("code: language survives", () => {
  const root = rootOf(buildOpsUpdate(null, [{ op: "code", text: "x = 1", language: "python" }]));
  assert(root.children[0].type === "code", "type");
  assert(root.children[0].language === "python", "language");
  assert(textOf(root.children[0]) === "x = 1", "text");
});

t("list: bullet / number (ordinals) / check (checked states)", () => {
  const root = rootOf(
    buildOpsUpdate(null, [
      { op: "list", listType: "bullet", items: ["b1", "b2"] },
      { op: "list", listType: "number", items: ["n1", "n2", "n3"] },
      { op: "list", listType: "check", items: [{ text: "done", checked: true }, "todo"] },
    ])
  );
  const [bullet, number, check] = root.children;
  assert(bullet.listType === "bullet" && bullet.children.length === 2, "bullet");
  assert(number.listType === "number" && number.children.length === 3, "number count");
  assert(number.children.every((li, i) => li.value === i + 1), "1-based ordinals");
  assert(check.listType === "check", "check type");
  assert(check.children[0].checked === true && textOf(check.children[0]) === "done", "checked item");
  assert(check.children[1].checked === false && textOf(check.children[1]) === "todo", "unchecked item");
});

t("list: item runs with format", () => {
  const root = rootOf(
    buildOpsUpdate(null, [{ op: "list", items: [{ runs: [{ text: "hot", format: ["bold"] }] }] }])
  );
  const txt = findAll(root, "text")[0];
  assert(txt.text === "hot" && (txt.format & 1) === 1, "bold run in list item");
});

t("table: rows/cells, header row, explicit + auto column widths", () => {
  const root = rootOf(
    buildOpsUpdate(null, [
      { op: "table", rows: [["h1", "h2"], ["a", "b"]], header: true, columnWidths: [100], tableWidth: 582 },
    ])
  );
  const table = root.children[0];
  assert(table.type === "table", "type");
  assert(table.children.length === 2, "2 rows");
  const cells = findAll(table, "custom-table-cell");
  assert(cells.length === 4, "4 cells");
  assert(cells.slice(0, 2).every((c) => c.headerState === 1), "row-0 cells are headers");
  assert(cells.slice(2).every((c) => c.headerState === 0), "row-1 cells are not");
  assert(cells.map(textOf).join() === "h1,h2,a,b", "cell texts");
  assert(JSON.stringify(table.colWidths) === "[100,482]", "explicit 100 + auto remainder 482: " + JSON.stringify(table.colWidths));
});

t("columns: layout container/items with nested blocks; empty column padded", () => {
  const root = rootOf(
    buildOpsUpdate(null, [
      { op: "columns", columns: [[{ op: "paragraph", text: "L" }, { op: "list", items: ["li"] }], []] },
    ])
  );
  const container = root.children[0];
  assert(container.type === "layout-container", "container");
  assert(container.children.length === 2, "2 items");
  assert(container.children[0].children.map((c) => c.type).join() === "paragraph,list", "nested blocks");
  assert(container.children[1].children.length === 1 && container.children[1].children[0].type === "paragraph", "empty col gets a paragraph");
});

t("image: src/alt/dimensions (caption: vendor image node drops it — see note)", () => {
  const root = rootOf(
    buildOpsUpdate(null, [{ op: "image", src: "https://i.test/x.png", altText: "pic", width: 300, height: 200, caption: "cap" }])
  );
  const img = root.children[0];
  assert(img.type === "image" && img.src === "https://i.test/x.png", "src");
  assert(img.altText === "pic", "alt");
  assert(img.width === 300 && img.height === 200, "dims");
  // Known gap this suite surfaced: the vendor image node's importJSON ignores showCaption/caption
  // (its serialized shape has no caption field), so the op's `caption` cannot take effect.
  assert(img.showCaption === false && !("caption" in img), "documents the current caption behavior");
});

t("embed + file: embed-media nodes with mimeType", () => {
  const root = rootOf(
    buildOpsUpdate(null, [
      { op: "embed", src: "https://v.test/v.mp4", mimeType: "video/mp4" },
      { op: "file", src: "https://f.test/f.pdf", mimeType: "application/pdf" },
    ])
  );
  assert(root.children.every((c) => c.type === "embed-media"), "types");
  assert(root.children[0].mimeType === "video/mp4", "video mime");
  assert(root.children[1].mimeType === "application/pdf", "file mime");
});

// -- in-place edits on an existing doc --

const base = () =>
  buildOpsUpdate(null, [
    { op: "paragraph", text: "hello world" }, // block 0
    { op: "paragraph" },                       // block 1 (empty)
    { op: "heading", level: 2, text: "title" } // block 2
  ]);

t("insert: anchored text mid-block", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [{ op: "insert", anchor: { parentId: 0, offset: 5 }, text: " brave" }]));
  assert(textOf(root.children[0]) === "hello brave world", textOf(root.children[0]));
});

t("insert: anchored text with format + color applies to the inserted range only", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [
    { op: "insert", anchor: { parentId: 0, offset: 11 }, text: "!!", format: ["bold"], color: "red" },
  ]));
  const texts = findAll(root.children[0], "text");
  const added = texts.find((x) => x.text === "!!");
  assert(added, "inserted node split out");
  assert((added.format & 1) === 1 && added.style.includes("color: red;"), "style on insert");
  const plain = texts.find((x) => x.text === "hello world");
  assert(plain && !(plain.format & 1), "original text untouched");
});

t("insert: into an empty block (was a silent no-op)", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [{ op: "insert", anchor: { parentId: 1, offset: 0 }, text: "filled" }]));
  assert(textOf(root.children[1]) === "filled", "empty paragraph filled");
});

t("insert: block via insertAfter / insertBefore / parentOffset / append", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [
    { op: "insert", insertAfter: 0, block: { op: "quote", text: "after0" } },
    { op: "insert", insertBefore: 0, block: { op: "quote", text: "before0" } },
    { op: "insert", parentOffset: 0, block: { op: "quote", text: "atZero" } },
    { op: "insert", block: { op: "quote", text: "atEnd" } },
  ]));
  // ops run sequentially; each sees the previous layout (indices refer to pre-op kids)
  const texts = root.children.map(textOf);
  assert(texts[texts.length - 1] === "atEnd", "appended last: " + JSON.stringify(texts));
  assert(texts.indexOf("before0") < texts.indexOf("hello world"), "before0 precedes block 0");
  assert(texts.indexOf("after0") > texts.indexOf("hello world"), "after0 follows block 0");
});

t("format: toggle + color on a forward range", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [
    { op: "format", anchor: { parentId: 0, offset: 0 }, focus: { parentId: 0, offset: 5 }, format: ["bold"], color: "green" },
  ]));
  const texts = findAll(root.children[0], "text");
  const hit = texts.find((x) => x.text === "hello");
  assert(hit, "range split out");
  assert((hit.format & 1) === 1 && hit.style.includes("color: green;"), "bold+color on range");
  const rest = texts.find((x) => x.text === " world");
  assert(rest && !(rest.format & 1) && !(rest.style || "").includes("green"), "outside range untouched");
});

t("format: BACKWARD range still applies color/highlight (regression)", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [
    { op: "format", anchor: { parentId: 0, offset: 11 }, focus: { parentId: 0, offset: 6 }, color: "red", highlight: "pink" },
  ]));
  const hit = findAll(root.children[0], "text").find((x) => x.text === "world");
  assert(hit, "range split out");
  assert(hit.style.includes("color: red;") && hit.style.includes("background-color: pink;"), "styles applied: " + (hit.style || "<none>"));
});

t("format: href wraps the range in a link", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [
    { op: "format", anchor: { parentId: 0, offset: 6 }, focus: { parentId: 0, offset: 11 }, href: "https://l.test" },
  ]));
  const link = findAll(root.children[0], "link")[0];
  assert(link && link.url === "https://l.test", "link node");
  assert(textOf(link) === "world", "link covers range");
  assert(textOf(root.children[0]) === "hello world", "block text unchanged");
});

t("format: style merge preserves existing declarations", () => {
  const b = buildOpsUpdate(null, [{ op: "paragraph", text: "keep", fontSize: 18 }]);
  const root = rootOf(b, buildOpsUpdate(b, [
    { op: "format", anchor: { parentId: 0, offset: 0 }, focus: { parentId: 0, offset: 4 }, color: "red" },
  ]));
  const txt = findAll(root, "text")[0];
  assert(txt.style.includes("font-size: 18px;") && txt.style.includes("color: red;"), "merged: " + txt.style);
});

t("delete: range within a block", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [
    { op: "delete", anchor: { parentId: 0, offset: 5 }, focus: { parentId: 0, offset: 11 } },
  ]));
  assert(textOf(root.children[0]) === "hello", textOf(root.children[0]));
});

t("delete: entire block text empties the block but keeps it", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [
    { op: "delete", anchor: { parentId: 0, offset: 0 }, focus: { parentId: 0, offset: 11 } },
  ]));
  assert(root.children.length === 3, "block count unchanged");
  assert(textOf(root.children[0]) === "", "emptied");
});

t("clear: wipes the document", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [{ op: "clear" }]));
  assert(textOf(root) === "", "no text after clear: '" + textOf(root) + "'");
});

t("clear then repopulate in one batch", () => {
  const b = base();
  const root = rootOf(b, buildOpsUpdate(b, [{ op: "clear" }, { op: "paragraph", text: "fresh" }]));
  const texts = root.children.map(textOf).filter((s) => s.length > 0);
  assert(texts.join() === "fresh", "only new content: " + JSON.stringify(texts));
});

t("sequential edits accumulate across deltas", () => {
  const b = base();
  const d1 = buildOpsUpdate(b, [{ op: "paragraph", text: "second" }]);
  const d2 = buildOpsUpdate(merged(b, d1), [{ op: "insert", anchor: { parentId: 3, offset: 6 }, text: "!" }]);
  const root = rootOf(b, d1, d2);
  assert(textOf(root.children[3]) === "second!", "both deltas landed");
});

// -- guards + error surfacing --

t("guard: hasDestructiveOp catches top-level, insert.block-nested, and columns-nested clear", () => {
  assert(hasDestructiveOp([{ op: "clear" }]) === true, "top-level");
  assert(hasDestructiveOp([{ op: "insert", block: { op: "clear" } }]) === true, "insert.block");
  assert(hasDestructiveOp([{ op: "insert", block: { op: "insert", block: { op: "clear" } } }]) === true, "doubly nested");
  assert(hasDestructiveOp([{ op: "columns", columns: [[{ op: "clear" }]] }]) === true, "columns");
  assert(hasDestructiveOp([{ op: "paragraph", text: "x" }, { op: "insert", block: { op: "quote", text: "q" } }]) === false, "benign ops");
});

t("error: format on an empty block throws (no silent ok)", () => {
  throws(() => buildOpsUpdate(base(), [
    { op: "format", anchor: { parentId: 1, offset: 0 }, focus: { parentId: 1, offset: 3 }, color: "red" },
  ]), /format: no text at 1:0/);
});

t("error: delete on a missing block throws", () => {
  throws(() => buildOpsUpdate(base(), [
    { op: "delete", anchor: { parentId: 99, offset: 0 }, focus: { parentId: 99, offset: 3 } },
  ]), /delete: no text at 99:0/);
});

t("error: anchored insert without text throws", () => {
  throws(() => buildOpsUpdate(base(), [{ op: "insert", anchor: { parentId: 0, offset: 0 } }]), /insert: anchor requires text/);
});

t("error: anchored insert into a missing block throws", () => {
  throws(() => buildOpsUpdate(base(), [{ op: "insert", anchor: { parentId: 42, offset: 0 }, text: "x" }]), /insert: no block at index 42/);
});

t("error: unknown op throws", () => {
  throws(() => buildOpsUpdate(null, [{ op: "sparkle" }]), /unknown op 'sparkle'/);
});

// ==== Part B — 1000+ randomized ops vs a model =================================
console.log("Part B: model-based stress test (1000+ unique ops)");

// Deterministic PRNG so failures are reproducible: SEED=n node tests/content-ops.cjs
const SEED = Number(process.env.SEED || 42);
let rng = SEED >>> 0;
const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0), rng / 2 ** 32);
const randInt = (n) => Math.floor(rand() * n);
const pick = (arr) => arr[randInt(arr.length)];

// Model block: { type, text, listType? } where text = concatenation of all descendant text nodes.
// Simple text blocks (paragraph/heading/quote) are eligible for anchored in-place edits.
const SIMPLE = new Set(["paragraph", "heading", "quote"]);

// Lexical merges ADJACENT lists of the same listType into one node at update commit
// (verified empirically: bullet+bullet → 1 list, bullet+check → 2). The model must mirror
// that after each batch, since transforms run post-callback — mid-batch indices stay unmerged.
function normalizeModel(model) {
  for (let i = model.length - 1; i > 0; i--) {
    const prev = model[i - 1];
    const cur = model[i];
    if (prev.type === "list" && cur.type === "list" && prev.listType === cur.listType) {
      prev.text += cur.text;
      model.splice(i, 1);
    }
  }
}
let seq = 0;
const uid = (p) => `${p}${(seq++).toString(36)}`;

const COLORS = ["red", "green", "blue", "orange", "purple"];
const FORMATS = ["bold", "italic", "underline", "strikethrough"];

// Generate one op + apply its effect to the model. Returns the op.
function genOp(model) {
  const editable = model
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => SIMPLE.has(b.type) && b.text.length > 0);
  const kinds = [
    "paragraph", "paragraph", "paragraph", "heading", "quote", "code", "list",
    "table", "columns", "image", "embed", "file",
    "insertText", "insertText", "insertText", "insertBlock", "insertBlock",
    "format", "format", "delete", "delete", "clear",
  ];
  let kind = pick(kinds);
  // clear is rare; in-place edits need an editable target
  if (kind === "clear" && rand() > 0.08) kind = "paragraph";
  if ((kind === "insertText" || kind === "format" || kind === "delete") && editable.length === 0) kind = "paragraph";

  switch (kind) {
    case "paragraph": {
      const text = uid("p");
      model.push({ type: "paragraph", text });
      return { op: "paragraph", text, ...(rand() < 0.3 ? { color: pick(COLORS) } : {}) };
    }
    case "heading": {
      const text = uid("h");
      const level = 1 + randInt(3);
      model.push({ type: "heading", text });
      return { op: "heading", level, text };
    }
    case "quote": {
      const text = uid("q");
      model.push({ type: "quote", text });
      return { op: "quote", text };
    }
    case "code": {
      const text = uid("c");
      model.push({ type: "code", text });
      return { op: "code", text, language: "js" };
    }
    case "list": {
      const items = Array.from({ length: 1 + randInt(3) }, () => uid("li"));
      const listType = pick(["bullet", "number", "check"]);
      model.push({ type: "list", text: items.join(""), listType });
      return {
        op: "list",
        listType,
        items: listType === "check" ? items.map((x) => ({ text: x, checked: rand() < 0.5 })) : items,
      };
    }
    case "table": {
      const rows = Array.from({ length: 1 + randInt(2) }, () => Array.from({ length: 1 + randInt(3) }, () => uid("t")));
      const numCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      // ragged rows: missing cells never render, so the model only counts cells that exist
      model.push({ type: "table", text: rows.flat().join("") });
      return { op: "table", rows, header: rand() < 0.5, ...(rand() < 0.3 ? { columnWidths: [100] } : {}), tableWidth: 60 * numCols + 400 };
    }
    case "columns": {
      const cols = Array.from({ length: 2 + randInt(2) }, () =>
        Array.from({ length: 1 + randInt(2) }, () => ({ op: "paragraph", text: uid("col") }))
      );
      model.push({ type: "layout-container", text: cols.flat().map((p) => p.text).join("") });
      return { op: "columns", columns: cols };
    }
    case "image": {
      model.push({ type: "image", text: "" });
      return { op: "image", src: `https://img.test/${uid("i")}.png`, altText: "a" };
    }
    case "embed": {
      model.push({ type: "embed-media", text: "" });
      return { op: "embed", src: `https://v.test/${uid("v")}.mp4`, mimeType: "video/mp4" };
    }
    case "file": {
      model.push({ type: "embed-media", text: "" });
      return { op: "file", src: `https://f.test/${uid("f")}.pdf`, mimeType: "application/pdf" };
    }
    case "insertText": {
      const { b, i } = pick(editable);
      const off = randInt(b.text.length + 1);
      const text = uid("x");
      b.text = b.text.slice(0, off) + text + b.text.slice(off);
      return {
        op: "insert", anchor: { parentId: i, offset: off }, text,
        ...(rand() < 0.3 ? { format: [pick(FORMATS)], color: pick(COLORS) } : {}),
      };
    }
    case "insertBlock": {
      const text = uid("nb");
      const blockOp = pick([
        { op: "paragraph", text }, { op: "quote", text },
        { op: "heading", level: 2, text }, { op: "list", items: [text] },
      ]);
      const entry = blockOp.op === "list" ? { type: "list", text, listType: "bullet" } : { type: blockOp.op, text };
      const mode = pick(["insertAfter", "insertBefore", "parentOffset", "append"]);
      if (mode === "append" || model.length === 0) {
        model.push(entry);
        return { op: "insert", block: blockOp };
      }
      const idx = randInt(model.length);
      if (mode === "insertAfter") model.splice(idx + 1, 0, entry);
      else model.splice(idx, 0, entry);
      return { op: "insert", [mode]: idx, block: blockOp };
    }
    case "format": {
      const { b, i } = pick(editable);
      let a = randInt(b.text.length + 1);
      let f = randInt(b.text.length + 1);
      if (a === f) f = Math.min(b.text.length, a + 1);
      // deliberately allow backward ranges (a > f) — text must be unchanged either way
      return {
        op: "format", anchor: { parentId: i, offset: a }, focus: { parentId: i, offset: f },
        ...(rand() < 0.7 ? { format: [pick(FORMATS)] } : {}),
        ...(rand() < 0.6 ? { color: pick(COLORS) } : {}),
        ...(rand() < 0.2 ? { highlight: "yellow" } : {}),
      };
    }
    case "delete": {
      const { b, i } = pick(editable);
      const a = randInt(b.text.length);
      const f = a + 1 + randInt(b.text.length - a);
      b.text = b.text.slice(0, a) + b.text.slice(f);
      return { op: "delete", anchor: { parentId: i, offset: a }, focus: { parentId: i, offset: f } };
    }
    case "clear": {
      model.length = 0;
      return { op: "clear" };
    }
  }
}

function verify(root, model, round) {
  const actual = root.children.map((c) => ({ type: c.type, text: textOf(c) }));
  assert(
    actual.length === model.length,
    `round ${round}: block count ${actual.length} != expected ${model.length}`
  );
  for (let i = 0; i < model.length; i++) {
    assert(
      actual[i].type === model[i].type,
      `round ${round} block ${i}: type '${actual[i].type}' != expected '${model[i].type}'`
    );
    assert(
      actual[i].text === model[i].text,
      `round ${round} block ${i} (${model[i].type}): text '${actual[i].text}' != expected '${model[i].text}'`
    );
  }
}

const TOTAL_OPS = 1100;
const BATCH = 20;
t(`${TOTAL_OPS} randomized ops (seed=${SEED}), verified against the model after every ${BATCH}-op batch`, () => {
  const liveDoc = new Y.Doc(); // persistent doc, like the server's warm Y.Doc
  const model = [];
  let applied = 0;
  let round = 0;
  while (applied < TOTAL_OPS) {
    round++;
    const n = Math.min(BATCH, TOTAL_OPS - applied);
    const ops = Array.from({ length: n }, () => genOp(model));
    // exactly the editDoc pipeline: delta against current state, applied to the live doc
    const delta = buildOpsUpdate(Y.encodeStateAsUpdate(liveDoc), ops);
    Y.applyUpdate(liveDoc, delta);
    applied += n;
    normalizeModel(model); // adjacent same-type lists merge at the editor's update commit
    verify(JSON.parse(extractFromBytesSync(Y.encodeStateAsUpdate(liveDoc)).lexicalJson).root, model, round);
  }
  console.log(`        ${applied} ops in ${round} batches; final doc: ${model.length} blocks`);
});

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
