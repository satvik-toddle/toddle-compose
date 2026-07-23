import * as Y from "yjs";
import {
  buildHtmlReplaceUpdate,
  buildOpsUpdate,
  hasDestructiveOp,
  ContentOpError,
  type ContentOp,
} from "./content-builder";
import { extractFromBytesSync } from "../persistence/lexical-extract.core";

// Apply a delta (built off an empty base) to a fresh Y.Doc and return the full encoded state, mirroring how doc-state applies a content-builder delta to the shared doc.
function applyToState(delta: Uint8Array, base?: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  if (base && base.byteLength > 0) Y.applyUpdate(doc, base);
  Y.applyUpdate(doc, delta);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

// Round-trip: build a delta, apply it, then read the content back as Lexical JSON root (the readContent path).
function rootFrom(state: Uint8Array): {
  children: Array<Record<string, unknown>>;
} {
  const { lexicalJson } = extractFromBytesSync(state);
  return JSON.parse(lexicalJson || '{"root":{"children":[]}}').root;
}

const textOf = (node: Record<string, unknown>): string => {
  if (node.type === "text") return (node.text as string) ?? "";
  return ((node.children as Array<Record<string, unknown>>) ?? [])
    .map(textOf)
    .join("");
};

describe("buildHtmlReplaceUpdate → readContent", () => {
  const html =
    `<h1>Title</h1>` +
    `<p>Hello <strong>world</strong></p>` +
    `<ul><li>one</li><li>two</li></ul>` +
    `<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>`;

  it("turns an HTML string into the doc's block structure", () => {
    const root = rootFrom(applyToState(buildHtmlReplaceUpdate(null, html)));
    expect(root.children.map((c) => c.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "table",
    ]);

    const [heading, paragraph, list, table] = root.children;
    expect(heading.tag).toBe("h1");
    expect(textOf(heading)).toBe("Title");
    expect(textOf(paragraph)).toBe("Hello world");

    expect(list.listType).toBe("bullet");
    expect((list.children as unknown[]).length).toBe(2);
    expect((list.children as Array<Record<string, unknown>>).map(textOf)).toEqual([
      "one",
      "two",
    ]);

    const rows = table.children as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    const firstRowCells = rows[0].children as Array<Record<string, unknown>>;
    expect(firstRowCells.map((c) => c.type)).toEqual([
      "custom-table-cell",
      "custom-table-cell",
    ]);
    expect(firstRowCells.map(textOf)).toEqual(["a", "b"]);
  });

  it("replaces the WHOLE body atomically on top of an existing doc", () => {
    // Seed the doc, then replace off that state — the second delta must clear the first content.
    const seeded = applyToState(buildHtmlReplaceUpdate(null, html));
    const replaced = applyToState(
      buildHtmlReplaceUpdate(seeded, "<h2>Fresh</h2><p>only this</p>"),
      seeded
    );
    const root = rootFrom(replaced);
    expect(root.children.map((c) => c.type)).toEqual(["heading", "paragraph"]);
    expect(root.children[0].tag).toBe("h2");
    expect(textOf(root.children[0])).toBe("Fresh");
    expect(textOf(root.children[1])).toBe("only this");
  });

  it("downgrades unsupported h4–h6 headings to h3", () => {
    const root = rootFrom(applyToState(buildHtmlReplaceUpdate(null, "<h5>deep</h5>")));
    expect(root.children[0].type).toBe("heading");
    expect(root.children[0].tag).toBe("h3");
  });
});

describe("buildOpsUpdate", () => {
  it("appends heading, paragraph, list and a width-controlled table", () => {
    const ops: ContentOp[] = [
      { op: "heading", level: 2, text: "H" },
      { op: "paragraph", text: "para" },
      { op: "list", listType: "number", items: ["x", "y"] },
      {
        op: "table",
        header: true,
        rows: [["a", "b"], ["c", "d"]],
        columnWidths: [120, 200],
        tableWidth: 320,
      },
    ];
    const root = rootFrom(applyToState(buildOpsUpdate(null, ops)));
    expect(root.children.map((c) => c.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "table",
    ]);
    expect(root.children[0].tag).toBe("h2");
    expect(root.children[2].listType).toBe("number");

    const table = root.children[3];
    expect(table.colWidths).toEqual([120, 200]);
    expect((table.children as unknown[]).length).toBe(2);
  });

  it("splits leftover width evenly across auto (unspecified) columns", () => {
    const root = rootFrom(
      applyToState(
        buildOpsUpdate(null, [
          {
            op: "table",
            rows: [["a", "b", "c"]],
            columnWidths: [100],
            tableWidth: 400,
          },
        ])
      )
    );
    // 100 fixed, 300 split across the two auto columns → 150 + 150.
    expect(root.children[0].colWidths).toEqual([100, 150, 150]);
  });

  it("applies inline format/insert edits against existing content", () => {
    const base = applyToState(buildOpsUpdate(null, [{ op: "paragraph", text: "abcdef" }]));
    // Bold chars [1,4) and insert "-" at offset 0 of the first block.
    const edited = applyToState(
      buildOpsUpdate(base, [
        { op: "format", anchor: { parentId: 0, offset: 1 }, focus: { parentId: 0, offset: 4 }, format: ["bold"] },
        { op: "insert", anchor: { parentId: 0, offset: 0 }, text: "-" },
      ]),
      base
    );
    const root = rootFrom(edited);
    expect(textOf(root.children[0])).toBe("-abcdef");
    // A bold text node must now exist within the paragraph (format bitmask non-zero).
    const leaves = root.children[0].children as Array<Record<string, unknown>>;
    expect(leaves.some((n) => (n.format as number) > 0)).toBe(true);
  });

  it("adds a row to an existing table via tableAddRow", () => {
    const base = applyToState(
      buildOpsUpdate(null, [{ op: "table", rows: [["a", "b"]], columnWidths: [100, 100] }])
    );
    const edited = applyToState(
      buildOpsUpdate(base, [{ op: "tableAddRow", table: 0, cells: ["c", "d"] }]),
      base
    );
    const rows = rootFrom(edited).children[0].children as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect((rows[1].children as Array<Record<string, unknown>>).map(textOf)).toEqual([
      "c",
      "d",
    ]);
  });

  it("throws ContentOpError for an op targeting a missing table", () => {
    expect(() =>
      buildOpsUpdate(null, [{ op: "tableDeleteRow", table: 5, row: 0 }])
    ).toThrow(ContentOpError);
  });
});

describe("hasDestructiveOp", () => {
  it("detects clear nested inside insert.block and columns", () => {
    expect(hasDestructiveOp([{ op: "paragraph", text: "x" }])).toBe(false);
    expect(hasDestructiveOp([{ op: "clear" }])).toBe(true);
    expect(
      hasDestructiveOp([{ op: "insert", block: { op: "clear" } }])
    ).toBe(true);
    expect(
      hasDestructiveOp([{ op: "columns", columns: [[{ op: "clear" }]] }])
    ).toBe(true);
  });
});
