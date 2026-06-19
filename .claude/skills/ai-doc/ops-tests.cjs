#!/usr/bin/env node
// Verifies every content-builder op/format by building it and inspecting the
// extracted Lexical JSON (in-process, no server). Run after rebuilding dist.
//   node ops-tests.cjs
const { build, find, walk } = require("./harness.cjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const texts = (json) => { const o = []; walk(json.root, (n) => { if (n.type === "text") o.push(n); }); return o; };
function section(name) { console.log("\n" + name); }

// 1. Text format bits
section("text formats (bitfield)");
{
  const fmts = [["bold", 1], ["italic", 2], ["strikethrough", 4], ["underline", 8], ["code", 16], ["highlight", 128]];
  for (const [f, bit] of fmts) {
    const { json } = build([{ op: "paragraph", text: f, format: [f] }]);
    const t = texts(json).find((x) => x.text === f);
    ok(t && t.format === bit, `${f} → format bit ${bit} (got ${t && t.format})`);
  }
}

// 2. Inline style: font size, color, highlight
section("inline style (font-size / color / background)");
{
  const { json } = build([{ op: "paragraph", runs: [
    { text: "big", fontSize: 28 },
    { text: "red", color: "#e11d48" },
    { text: "marked", highlight: "#fde68a" },
  ] }]);
  const t = texts(json);
  ok((t.find((x) => x.text === "big")?.style || "").includes("font-size: 28px"), "fontSize → font-size:28px");
  ok((t.find((x) => x.text === "red")?.style || "").includes("color: #e11d48"), "color → color css");
  ok((t.find((x) => x.text === "marked")?.style || "").includes("background-color: #fde68a"), "highlight → background-color css");
}

// 3. Links
section("links");
{
  const { json } = build([{ op: "paragraph", runs: [
    { text: "plain " }, { text: "toddle", href: "https://toddleapp.com" },
  ] }]);
  const link = find(json, "link")[0];
  ok(link && link.url === "https://toddleapp.com", "link node with url");
  ok(link && (link.children || []).some((c) => c.text === "toddle"), "link wraps its text");
}

// 4. Lists
section("lists");
{
  const b = build([{ op: "list", listType: "bullet", items: ["one", "two", "three"] }]).json;
  ok(find(b, "list")[0]?.listType === "bullet", "bullet list listType");
  ok(find(b, "listitem").length === 3, "bullet list has 3 items");

  const n = build([{ op: "list", listType: "number", items: ["a", "b"] }]).json;
  ok(find(n, "list")[0]?.listType === "number", "number list listType");

  const c = build([{ op: "list", listType: "check", items: [
    { text: "done", checked: true }, { text: "todo", checked: false },
  ] }]).json;
  const items = find(c, "listitem");
  ok(find(c, "list")[0]?.listType === "check", "check list listType");
  ok(items.some((i) => i.checked === true) && items.some((i) => i.checked === false), "check items carry checked state");
}

// 5. Quote + code
section("quote + code block");
{
  const q = build([{ op: "quote", text: "to be or not to be" }]).json;
  ok(find(q, "quote").length === 1 && texts(q).some((t) => t.text.includes("to be")), "quote node + text");
  const c = build([{ op: "code", language: "js", text: "const x = 1;" }]).json;
  ok(find(c, "code").length === 1, "code node present");
}

// 6. Columns (layout)
section("columns / layout");
{
  const { json } = build([{ op: "columns", columns: [
    [{ op: "paragraph", text: "left col" }],
    [{ op: "paragraph", text: "right col" }],
  ] }]);
  const container = find(json, "layout-container")[0];
  const items = find(json, "layout-item");
  ok(!!container, "layout-container present");
  ok(items.length === 2, "two layout-items (columns)");
  ok(texts(json).some((t) => t.text === "left col") && texts(json).some((t) => t.text === "right col"), "column content present");
}

// 6b. Image / embed / file (media nodes added to the server bundle)
section("image / embed / file");
{
  const img = build([{ op: "image", src: "https://x.test/cat.png", altText: "a cat", maxWidth: 400 }]).json;
  const imageNode = find(img, "image")[0];
  ok(!!imageNode, "image node present");
  ok(imageNode && imageNode.src === "https://x.test/cat.png", "image src set");
  ok(imageNode && imageNode.altText === "a cat", "image altText set");

  const emb = build([{ op: "embed", src: "https://youtu.be/abc", mimeType: "text/html" }]).json;
  const embedNode = find(emb, "embed-media")[0];
  ok(!!embedNode, "embed-media node present");
  ok(embedNode && embedNode.src === "https://youtu.be/abc", "embed src (link) set");

  const file = build([{ op: "file", src: "https://x.test/doc.pdf", mimeType: "application/pdf" }]).json;
  const fileNode = find(file, "embed-media")[0];
  ok(!!fileNode, "file → embed-media node present");
  ok(fileNode && fileNode.mimeType === "application/pdf", "file mimeType set");
}

// 7. Table colWidths (regression)
section("table widths (regression)");
{
  const { json } = build([{ op: "table", header: true, rows: [["A", "B", "C"], ["1", "2", "3"]] }]);
  const t = find(json, "table")[0];
  ok(Array.isArray(t.colWidths) && t.colWidths.reduce((a, b) => a + b, 0) === 584, "colWidths sum to 584");
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
