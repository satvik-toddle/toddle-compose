// Pure diff algorithm for DOC version comparison: merges two serialized Lexical editorStates into one, wrapping changed inline runs in "diff-mark" nodes so a read-only editor can tint added/removed text. No Lexical/React/DOM imports.

// Loose structural node type: any serialized Lexical node, with unknown fields preserved as pass-through.
export interface SerializedLexicalNode {
  type: string;
  text?: string;
  format?: number | string;
  style?: string;
  mode?: string;
  detail?: number;
  children?: SerializedLexicalNode[];
  [key: string]: unknown;
}

// An element node is any node that carries children.
export interface SerializedElementNode extends SerializedLexicalNode {
  children: SerializedLexicalNode[];
}

// A serialized editorState is a root wrapper around top-level block children.
export interface SerializedEditorState {
  root: SerializedElementNode;
  [key: string]: unknown;
}

type DiffVariant = "added" | "removed";

// The exact wrapper node shape the editor registers to tint changed inline runs.
interface DiffMarkNode extends SerializedElementNode {
  type: "diff-mark";
  version: 1;
  variant: DiffVariant;
  // Absent/inline = word-level run; block = whole added/removed block (overlay tint).
  display?: "inline" | "block";
  direction: null;
  format: "";
  indent: 0;
  children: SerializedLexicalNode[];
}

// Block types whose children are only text/inline nodes get word-level descent; anything else is treated as non-simple in v1.
const SIMPLE_TEXT_BLOCK_TYPES = new Set(["paragraph", "heading", "quote"]);

// Wrap contiguous text nodes in a diff-mark of the given variant, keeping each text node's original format/style.
export function wrapRun(
  textNodes: SerializedLexicalNode[],
  variant: DiffVariant
): DiffMarkNode {
  return {
    type: "diff-mark",
    version: 1,
    variant,
    direction: null,
    format: "",
    indent: 0,
    children: textNodes,
  };
}

// Wrap a whole added/removed block (paragraph, table, media, ...) in a block-display diff-mark; the editor tints it with a pointer-events-none overlay, so decorators/images tint too.
function wrapBlock(
  block: SerializedLexicalNode,
  variant: DiffVariant
): DiffMarkNode {
  return {
    type: "diff-mark",
    version: 1,
    variant,
    display: "block",
    direction: null,
    format: "",
    indent: 0,
    children: [block],
  };
}

// Hard ceiling on the LCS DP size: beyond it we degrade to remove-all/add-all instead of risking an event-loop stall or OOM on the shared rtc process.
const MAX_DP_CELLS = 4_000_000;

// Generic LCS over two arrays with PRECOMPUTED string keys (so equality is O(1) per DP cell, not a subtree walk); returns aligned pairs (either side may be null for insert/delete).
// Trims the common prefix/suffix before the DP (typical edits shrink the matrix to the changed span), uses a flat Int32Array, and caps the matrix at MAX_DP_CELLS.
function lcsAlign<T>(
  before: T[],
  after: T[],
  beforeKeys: string[],
  afterKeys: string[]
): Array<{ before: T | null; after: T | null }> {
  const result: Array<{ before: T | null; after: T | null }> = [];
  let lo = 0;
  let hiB = before.length;
  let hiA = after.length;
  while (lo < hiB && lo < hiA && beforeKeys[lo] === afterKeys[lo]) {
    result.push({ before: before[lo], after: after[lo] });
    lo++;
  }
  const suffix: Array<{ before: T | null; after: T | null }> = [];
  while (hiB > lo && hiA > lo && beforeKeys[hiB - 1] === afterKeys[hiA - 1]) {
    suffix.push({ before: before[hiB - 1], after: after[hiA - 1] });
    hiB--;
    hiA--;
  }
  const n = hiB - lo;
  const m = hiA - lo;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_DP_CELLS) {
    // Empty side, or matrix too large: no anchors — everything removed then added (callers pair/wrap from there).
    for (let i = lo; i < hiB; i++) result.push({ before: before[i], after: null });
    for (let j = lo; j < hiA; j++) result.push({ before: null, after: after[j] });
  } else {
    // dp[i*w+j] = LCS length of before[lo+i..] and after[lo+j..].
    const w = m + 1;
    const dp = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          beforeKeys[lo + i] === afterKeys[lo + j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (beforeKeys[lo + i] === afterKeys[lo + j]) {
        result.push({ before: before[lo + i], after: after[lo + j] });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        // Advancing before means this before element is removed.
        result.push({ before: before[lo + i], after: null });
        i++;
      } else {
        result.push({ before: null, after: after[lo + j] });
        j++;
      }
    }
    while (i < n) result.push({ before: before[lo + i++], after: null });
    while (j < m) result.push({ before: null, after: after[lo + j++] });
  }
  for (let k = suffix.length - 1; k >= 0; k--) result.push(suffix[k]);
  return result;
}

// True if the node looks like a text/inline leaf (has a `text` field or no children).
function isTextNode(node: SerializedLexicalNode): boolean {
  return node.type === "text" || typeof node.text === "string";
}

// Concatenate all descendant text-node text values.
function collectText(node: SerializedLexicalNode): string {
  if (isTextNode(node)) return typeof node.text === "string" ? node.text : "";
  const children = node.children;
  if (!Array.isArray(children)) return "";
  let out = "";
  for (const child of children) out += collectText(child);
  return out;
}

// Trim + collapse internal whitespace for block equality keys.
function normalizedText(node: SerializedLexicalNode): string {
  return collectText(node).replace(/\s+/g, " ").trim();
}

// A block is "simple text" if it is a known simple type and every child is a text/inline leaf (no nested element children).
function isSimpleTextBlock(node: SerializedLexicalNode): boolean {
  if (!SIMPLE_TEXT_BLOCK_TYPES.has(node.type)) return false;
  const children = node.children;
  if (!Array.isArray(children)) return true;
  return children.every((child) => isTextNode(child));
}

// Equality key for block-level LCS: block type + normalized descendant text.
function blockKey(node: SerializedLexicalNode): string {
  return `${node.type} ${normalizedText(node)}`;
}

// Deep-clone a plain-JSON node so we never mutate the caller's input.
function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}

// Flatten a block's inline children into text leaves (any element children are flattened to their text descendants, v1 loses their structure but not their text).
function collectTextLeaves(node: SerializedLexicalNode): SerializedLexicalNode[] {
  if (isTextNode(node)) return [node];
  const children = node.children;
  if (!Array.isArray(children)) return [];
  const out: SerializedLexicalNode[] = [];
  for (const child of children) out.push(...collectTextLeaves(child));
  return out;
}

interface Token {
  text: string;
  format?: number | string;
  style?: string;
}

// Tokenize a block's inline children into words and whitespace runs, carrying each token's source format/style.
function tokenize(node: SerializedLexicalNode): Token[] {
  const leaves = collectTextLeaves(node);
  const tokens: Token[] = [];
  for (const leaf of leaves) {
    const text = typeof leaf.text === "string" ? leaf.text : "";
    if (!text) continue;
    // Split so whitespace runs survive as their own tokens.
    for (const piece of text.split(/(\s+)/)) {
      if (piece === "") continue;
      tokens.push({ text: piece, format: leaf.format, style: leaf.style });
    }
  }
  return tokens;
}

// Build a plain text node from a token, preserving its source format/style where present.
function textNodeFromToken(token: Token): SerializedLexicalNode {
  const node: SerializedLexicalNode = {
    type: "text",
    text: token.text,
    detail: 0,
    format: token.format ?? 0,
    mode: "normal",
    style: token.style ?? "",
    version: 1,
  };
  return node;
}

type TokenClass = "equal" | DiffVariant;

// Coalesce adjacent tokens sharing class + format + style into a single text node, to avoid node explosion. v1 collapses a changed run to its first token's format.
function emitClassifiedTokens(
  entries: Array<{ token: Token; cls: TokenClass }>
): SerializedLexicalNode[] {
  const out: SerializedLexicalNode[] = [];
  let i = 0;
  while (i < entries.length) {
    const cls = entries[i].cls;
    const format = entries[i].token.format;
    const style = entries[i].token.style;
    let text = "";
    while (
      i < entries.length &&
      entries[i].cls === cls &&
      entries[i].token.format === format &&
      entries[i].token.style === style
    ) {
      text += entries[i].token.text;
      i++;
    }
    const textNode = textNodeFromToken({ text, format, style });
    if (cls === "equal") out.push(textNode);
    else out.push(wrapRun([textNode], cls));
  }
  return out;
}

// Word-level diff between two matched simple-text blocks; returns the after block with inline children replaced by the merged token runs.
function diffSimpleTextBlock(
  beforeBlock: SerializedLexicalNode,
  afterBlock: SerializedLexicalNode
): SerializedLexicalNode {
  const beforeTokens = tokenize(beforeBlock);
  const afterTokens = tokenize(afterBlock);
  const aligned = lcsAlign(
    beforeTokens,
    afterTokens,
    beforeTokens.map((t) => t.text),
    afterTokens.map((t) => t.text)
  );
  const entries: Array<{ token: Token; cls: TokenClass }> = [];
  for (const pair of aligned) {
    if (pair.before && pair.after) entries.push({ token: pair.after, cls: "equal" });
    else if (pair.after) entries.push({ token: pair.after, cls: "added" });
    else if (pair.before) entries.push({ token: pair.before, cls: "removed" });
  }
  const clone = cloneNode(afterBlock);
  clone.children = emitClassifiedTokens(entries);
  return clone;
}

// Emit a MATCHED block pair (same change region, same type): identical text → after unchanged; simple text → word-level diff; non-simple (tables, lists, link/linebreak-bearing paragraphs) → removed+added block pair, so the edit is never rendered as "no change".
function emitMatchedBlock(
  beforeBlock: SerializedLexicalNode,
  afterBlock: SerializedLexicalNode
): SerializedLexicalNode[] {
  if (normalizedText(beforeBlock) === normalizedText(afterBlock)) {
    return [cloneNode(afterBlock)];
  }
  if (isSimpleTextBlock(beforeBlock) && isSimpleTextBlock(afterBlock)) {
    return [diffSimpleTextBlock(beforeBlock, afterBlock)];
  }
  return [
    wrapBlock(cloneNode(beforeBlock), "removed"),
    wrapBlock(cloneNode(afterBlock), "added"),
  ];
}

// An entry within a change region (a maximal run of non-anchor before/after blocks between LCS anchors).
interface ChangeEntry {
  side: "before" | "after";
  node: SerializedLexicalNode;
}

// Resolve one change region: pair each removed block with an unused added block of the same type (an in-place edit → word diff at the removed's position); leftovers are pure removed/added, emitted in original document order.
function emitChangeRegion(entries: ChangeEntry[]): SerializedLexicalNode[] {
  const removed = entries.filter((e) => e.side === "before").map((e) => e.node);
  const added = entries.filter((e) => e.side === "after").map((e) => e.node);
  const pairedAdded = new Set<SerializedLexicalNode>();
  const pairFor = new Map<SerializedLexicalNode, SerializedLexicalNode>();
  for (const b of removed) {
    const match = added.find((a) => a.type === b.type && !pairedAdded.has(a));
    if (match) {
      pairedAdded.add(match);
      pairFor.set(b, match);
    }
  }
  const out: SerializedLexicalNode[] = [];
  for (const entry of entries) {
    if (entry.side === "before") {
      const paired = pairFor.get(entry.node);
      if (paired) out.push(...emitMatchedBlock(entry.node, paired));
      else out.push(wrapBlock(cloneNode(entry.node), "removed"));
    } else if (!pairedAdded.has(entry.node)) {
      out.push(wrapBlock(cloneNode(entry.node), "added"));
    }
  }
  return out;
}

// Merge two serialized editorStates into one, with changed inline runs wrapped in diff-mark nodes (base = after; adds vs before are "added", removes are re-inserted as "removed").
export function diffEditorStates(
  before: SerializedEditorState,
  after: SerializedEditorState
): SerializedEditorState {
  const afterRoot: SerializedElementNode =
    after && after.root ? after.root : { type: "root", children: [] };
  const beforeRoot: SerializedElementNode | null =
    before && before.root ? before.root : null;

  const afterBlocks = Array.isArray(afterRoot.children) ? afterRoot.children : [];
  const beforeBlocks =
    beforeRoot && Array.isArray(beforeRoot.children) ? beforeRoot.children : [];

  // Block-level LCS anchors identical blocks (keys precomputed once — never inside the DP); blocks that only differ in text fall into change regions and are paired there.
  const aligned = lcsAlign(
    beforeBlocks,
    afterBlocks,
    beforeBlocks.map(blockKey),
    afterBlocks.map(blockKey)
  );

  const merged: SerializedLexicalNode[] = [];
  let i = 0;
  while (i < aligned.length) {
    const pair = aligned[i];
    if (pair.before && pair.after) {
      // LCS anchor: identical type + normalized text, emit unchanged.
      merged.push(cloneNode(pair.after));
      i++;
      continue;
    }
    // Gather a maximal change region and resolve add/remove/in-place-edit within it.
    const region: ChangeEntry[] = [];
    while (i < aligned.length && !(aligned[i].before && aligned[i].after)) {
      const cur = aligned[i];
      if (cur.after) region.push({ side: "after", node: cur.after });
      else if (cur.before) region.push({ side: "before", node: cur.before });
      i++;
    }
    merged.push(...emitChangeRegion(region));
  }

  const rest = after && typeof after === "object" ? after : {};
  return { ...rest, root: { ...afterRoot, children: merged } };
}
