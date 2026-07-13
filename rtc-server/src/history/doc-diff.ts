// Pure diff algorithm for DOC version comparison: merges two serialized Lexical editorStates into one, wrapping changed inline runs in "diff-mark" nodes so a read-only editor can tint added/removed text. No Lexical/React/DOM imports.
// Blocks and inline tokens are keyed by a full structural signature (type + content-bearing attrs + subtree), so formatting-only edits (bold, color, alignment, indent, table structure, image src/size, checkbox, code language, ...) are detected — not just type/text changes.
// A simple text block may also contain inline-atomic nodes (childless non-text decorators, e.g. inline images); those tokenize as single node tokens so an inserted/removed/changed inline node is wrapped in its own inline diff-mark while surrounding text stays neutral.

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

// True if the node is an inline-atomic node: a non-text node with no (non-empty) children array, e.g. an inline image / decorator. A link (element with text children) does NOT qualify.
function isInlineAtomic(node: SerializedLexicalNode): boolean {
  if (isTextNode(node)) return false;
  return !Array.isArray(node.children) || node.children.length === 0;
}

// A block is "simple text" if it is a known simple type and every child is either a text leaf or an inline-atomic node (text + inline images), so it can be word/node-diffed; a block containing an element-with-children (e.g. a link) stays non-simple and is diffed whole-block.
function isSimpleTextBlock(node: SerializedLexicalNode): boolean {
  if (!SIMPLE_TEXT_BLOCK_TYPES.has(node.type)) return false;
  const children = node.children;
  if (!Array.isArray(children)) return true;
  return children.every((child) => isTextNode(child) || isInlineAtomic(child));
}

// Sort CSS declarations so property order never causes a false diff; non-strings and empties normalize to "".
function normalizeStyle(style: unknown): string {
  if (typeof style !== "string" || style.length === 0) return "";
  return style
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(";");
}

// Attrs excluded from a node's signature: children (recursed separately), version (bump-only), direction (auto-computed from content — would false-positive).
const SIGNATURE_EXCLUDE = new Set(["children", "version", "direction"]);

// Deterministic structural signature of a node and its subtree: captures type, all content-bearing own attrs (format/style/indent/checked/src/width/language/...), and recursively its children — so any meaningful change alters the key. Used as the block-level LCS key and the matched-block equality check.
function nodeSignature(node: SerializedLexicalNode): string {
  if (isTextNode(node)) {
    const text = typeof node.text === "string" ? node.text : "";
    return `T${text}${node.format ?? 0}${normalizeStyle(
      node.style
    )}${node.mode ?? ""}${node.detail ?? 0}`;
  }
  const attrs: string[] = [];
  for (const key of Object.keys(node).sort()) {
    if (SIGNATURE_EXCLUDE.has(key)) continue;
    if (key === "type") continue;
    attrs.push(`${key}=${JSON.stringify(node[key])}`);
  }
  const children = Array.isArray(node.children) ? node.children : [];
  return `E${node.type}${attrs.join("")}[${children
    .map(nodeSignature)
    .join("")}]`;
}

// Deep-clone a plain-JSON node so we never mutate the caller's input.
function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}

// A token is either a text/whitespace token (text + source format/style, used to reconstruct a text node) or a node token (`node` set to an inline-atomic node; `text` unused for reconstruction).
interface Token {
  text: string;
  format?: number | string;
  style?: string;
  node?: SerializedLexicalNode;
}

// Tokenize a simple text block's DIRECT children (guaranteed flat: text or inline-atomic) into words, whitespace runs, and single node tokens, in document order.
function tokenize(node: SerializedLexicalNode): Token[] {
  const children = Array.isArray(node.children) ? node.children : [];
  const tokens: Token[] = [];
  for (const child of children) {
    if (isTextNode(child)) {
      const text = typeof child.text === "string" ? child.text : "";
      if (!text) continue;
      // Split so whitespace runs survive as their own tokens.
      for (const piece of text.split(/(\s+)/)) {
        if (piece === "") continue;
        tokens.push({ text: piece, format: child.format, style: child.style });
      }
    } else {
      // Inline-atomic node (e.g. inline image): one indivisible node token.
      tokens.push({ text: "", node: child });
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

// Emit classified tokens: node tokens are emitted standalone (cloned when equal, else wrapped in an inline diff-mark) and never coalesced; text tokens coalesce adjacent runs sharing class + format + style into a single text node, to avoid node explosion. v1 collapses a changed text run to its first token's format.
function emitClassifiedTokens(
  entries: Array<{ token: Token; cls: TokenClass }>
): SerializedLexicalNode[] {
  const out: SerializedLexicalNode[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (entry.token.node) {
      // Inline-atomic node token: emit the node itself, wrapped in an inline diff-mark if changed.
      const cloned = cloneNode(entry.token.node);
      if (entry.cls === "equal") out.push(cloned);
      else out.push(wrapRun([cloned], entry.cls));
      i++;
      continue;
    }
    const cls = entry.cls;
    const format = entry.token.format;
    const style = entry.token.style;
    let text = "";
    while (
      i < entries.length &&
      !entries[i].token.node &&
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

// Format-aware token key: a node token keys on its structural signature (so identical inline nodes align equal, a changed one matches nothing); whitespace ignores format (avoids spurious space diffs); a real word carries its format + normalized style, so re-formatting identical text aligns as removed(old)+added(new).
function tokenKey(t: Token): string {
  if (t.node) return ` N${nodeSignature(t.node)}`;
  if (/^\s+$/.test(t.text)) return t.text;
  return `${t.text}${t.format ?? 0}${normalizeStyle(t.style)}`;
}

// Word-level diff between two matched simple-text blocks; returns the after block with inline children replaced by the merged token runs, plus whether the alignment found any inline change.
function diffSimpleTextBlock(
  beforeBlock: SerializedLexicalNode,
  afterBlock: SerializedLexicalNode
): { block: SerializedLexicalNode; hasInlineChange: boolean } {
  const beforeTokens = tokenize(beforeBlock);
  const afterTokens = tokenize(afterBlock);
  const aligned = lcsAlign(
    beforeTokens,
    afterTokens,
    beforeTokens.map(tokenKey),
    afterTokens.map(tokenKey)
  );
  const entries: Array<{ token: Token; cls: TokenClass }> = [];
  let hasInlineChange = false;
  for (const pair of aligned) {
    if (pair.before && pair.after) entries.push({ token: pair.after, cls: "equal" });
    else if (pair.after) {
      entries.push({ token: pair.after, cls: "added" });
      hasInlineChange = true;
    } else if (pair.before) {
      entries.push({ token: pair.before, cls: "removed" });
      hasInlineChange = true;
    }
  }
  const clone = cloneNode(afterBlock);
  clone.children = emitClassifiedTokens(entries);
  return { block: clone, hasInlineChange };
}

// Emit a MATCHED block pair (same change region, same type): structurally identical → after unchanged; simple text with an inline change → word-level diff; simple text differing only in block-level attrs (align/indent) or any non-simple block → removed+added block pair, so the edit is never rendered as "no change".
function emitMatchedBlock(
  beforeBlock: SerializedLexicalNode,
  afterBlock: SerializedLexicalNode
): SerializedLexicalNode[] {
  if (nodeSignature(beforeBlock) === nodeSignature(afterBlock)) {
    return [cloneNode(afterBlock)];
  }
  if (isSimpleTextBlock(beforeBlock) && isSimpleTextBlock(afterBlock)) {
    const { block, hasInlineChange } = diffSimpleTextBlock(beforeBlock, afterBlock);
    if (hasInlineChange) return [block];
    // Text + inline formatting identical; only block-level attrs (alignment/indent) differ.
    return [
      wrapBlock(cloneNode(beforeBlock), "removed"),
      wrapBlock(cloneNode(afterBlock), "added"),
    ];
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

  // Block-level LCS anchors structurally identical blocks (full signature precomputed once — never inside the DP); blocks that differ in any content-bearing way fall into change regions and are paired there.
  const aligned = lcsAlign(
    beforeBlocks,
    afterBlocks,
    beforeBlocks.map(nodeSignature),
    afterBlocks.map(nodeSignature)
  );

  const merged: SerializedLexicalNode[] = [];
  let i = 0;
  while (i < aligned.length) {
    const pair = aligned[i];
    if (pair.before && pair.after) {
      // LCS anchor: structurally identical block, emit unchanged.
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
