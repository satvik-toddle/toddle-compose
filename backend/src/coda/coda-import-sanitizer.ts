// Inbound counterpart to rtc-server's coda-html-sanitizer: turns Coda's page-export HTML into the
// clean, constrained subset our doc editor's importDOM understands (h1-h3, p, ul/ol/li, table,
// blockquote, pre/code, inline b/strong/i/em/u/code/color-spans, a, img). Backend ships no HTML
// parser (jsdom lives in the pnpm store but is not linked here, and the unit env is "node"), and we
// must not add a dependency — so this walks a small self-contained token stream instead of a DOM.
// Every transform mirrors an inverse of an outbound step; losses[] surfaces fidelity drops to the UI.

// Tags our editor accepts. Anything outside this set is unwrapped (kept children) unless it is a
// structural transform target (table/details/iframe/callout) or a drop-subtree tag.
const ALLOWED = new Set([
  "h1", "h2", "h3", "p", "ul", "ol", "li", "table", "thead", "tbody", "tr",
  "td", "th", "colgroup", "col", "blockquote", "pre", "code", "b", "strong",
  "i", "em", "u", "span", "a", "img", "br",
]);

// Coda export chrome whose text is noise, not content — removed subtree and all.
const DROP_SUBTREE = new Set([
  "script", "style", "noscript", "head", "title", "meta", "link", "base",
  "template", "svg", "figcaption",
]);

// Elements with no closing tag (or self-closed). iframe is intentionally NOT here — it has a close.
const VOID = new Set([
  "img", "br", "hr", "col", "input", "meta", "link", "base", "area", "source", "wbr",
]);

// Block-level tags, used to identify layout-only whitespace text nodes that can be dropped.
const BLOCK = new Set([
  "html", "body", "div", "section", "article", "main", "header", "footer",
  "aside", "figure", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th", "colgroup", "col", "blockquote",
  "pre", "details", "summary", "caption",
]);

// Per-tag attribute allowlist. Any attribute not listed (data-coda-*, class, id, …) is dropped.
const KEEP_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height"]),
  span: new Set(["style"]),
  td: new Set(["style"]),
  th: new Set(["style"]),
  col: new Set(["style"]),
};

type Attrs = Record<string, string>;

interface Tok {
  kind: "open" | "close" | "void" | "text";
  tag?: string;
  attrs?: Attrs;
  text?: string;
}

function parseAttrs(s: string): Attrs {
  const attrs: Attrs = {};
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = m[1].toLowerCase();
    if (name) attrs[name] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

function tokenize(html: string): Tok[] {
  const toks: Tok[] = [];
  // Comments / CDATA / doctype are matched only so they can be skipped; real tags carry name+attrs.
  const re =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) toks.push({ kind: "text", text: html.slice(last, m.index) });
    last = re.lastIndex;
    const full = m[0];
    if (full.startsWith("<!")) continue;
    if (m[1]) {
      toks.push({ kind: "close", tag: m[1].toLowerCase() });
      continue;
    }
    const tag = (m[2] || "").toLowerCase();
    const attrs = parseAttrs(m[3] || "");
    const selfClose = m[4] === "/" || VOID.has(tag);
    toks.push({ kind: selfClose ? "void" : "open", tag, attrs });
  }
  if (last < html.length) toks.push({ kind: "text", text: html.slice(last) });
  return toks;
}

function serialize(toks: Tok[]): string {
  let out = "";
  for (const t of toks) {
    if (t.kind === "text") {
      out += t.text ?? "";
    } else if (t.kind === "close") {
      out += `</${t.tag}>`;
    } else {
      let attr = "";
      const a = t.attrs ?? {};
      for (const k of Object.keys(a)) {
        // Values keep their source entities; only a stray double-quote needs escaping to stay valid.
        attr += ` ${k}="${a[k].replace(/"/g, "&quot;")}"`;
      }
      // Void tags emit without a trailing slash to match the editor/innerHTML style (e.g. <img ...>).
      out += `<${t.tag}${attr}>`;
    }
  }
  return out;
}

// Index of the </tag> that closes the open tag at `i`, honoring same-tag nesting; -1 if unbalanced.
function findMatching(toks: Tok[], i: number): number {
  const tag = toks[i].tag;
  let depth = 0;
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t.kind === "open" && t.tag === tag) depth++;
    else if (t.kind === "close" && t.tag === tag) {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

function textOf(toks: Tok[]): string {
  return toks
    .filter((t) => t.kind === "text")
    .map((t) => t.text ?? "")
    .join("");
}

function isWhitespace(s: string): boolean {
  return s.trim().length === 0;
}

// Keep only the listed style declarations; normalize a `width` to `Npx`; map the `background`
// shorthand color onto `background-color` (the longhand our importer reads for highlights).
function filterStyle(style: string, props: Set<string>): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    let prop = decl.slice(0, idx).trim().toLowerCase();
    let val = decl.slice(idx + 1).trim();
    if (prop === "background" && props.has("background-color")) prop = "background-color";
    if (!props.has(prop)) continue;
    if (prop === "width") {
      const px = parsePx(val);
      if (px === undefined) continue;
      val = `${px}px`;
    }
    kept.push(`${prop}: ${val}`);
  }
  return kept.join("; ");
}

// A pixel width from a style value ("320px", "320") or width attribute; undefined if not numeric.
function parsePx(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(val);
  return m ? Math.round(parseFloat(m[1])) : undefined;
}

// True when an element's class / role / attribute names or values mark it as a Coda callout.
function isCallout(attrs: Attrs): boolean {
  const cls = (attrs.class ?? "").toLowerCase();
  if (/callout/.test(cls)) return true;
  if ((attrs.role ?? "").toLowerCase() === "note") return true;
  for (const k of Object.keys(attrs)) {
    if (/callout/.test(k) || /callout/i.test(attrs[k])) return true;
  }
  return false;
}

function classMatches(attrs: Attrs, re: RegExp): boolean {
  return re.test((attrs.class ?? "").toLowerCase());
}

export function sanitizeCodaImportHtml(html: string): { html: string; losses: string[] } {
  const losses: string[] = [];
  let embeds = 0;
  let embedsDropped = 0;
  let callouts = 0;
  let collapsibles = 0;
  let mergedTables = 0;
  let imagesDropped = 0;
  let captionsDropped = 0;
  let headingsDowngraded = 0;

  if (!html || isWhitespace(html)) return { html: "", losses };

  let toks = tokenize(html);

  // 1. Drop export chrome: whole subtrees for script/style/head/svg/figcaption, and the
  // html/body wrappers themselves (keeping their children).
  toks = dropSubtrees(toks);
  toks = toks.filter((t) => !((t.tag === "html" || t.tag === "body") && t.kind !== "text"));

  // 2. Embeds/iframes (§14): Coda embeds don't survive our import either — preserve each as a link.
  const EMBED_TAGS = ["iframe", "embed", "object", "video", "audio", "source"];
  const toEmbedLink = (attrs: Attrs, inner: Tok[]): Tok[] => {
    let href = attrs.src || attrs["data-src"] || attrs["data-url"] || attrs.href || "";
    if (!/^https?:\/\//i.test(href)) {
      // Fall back to the first http(s) URL sitting in any attribute (Coda stores it inconsistently).
      href = Object.values(attrs).find((v) => /^https?:\/\//i.test(v)) ?? "";
    }
    if (!/^https?:\/\//i.test(href)) {
      embedsDropped++;
      return [];
    }
    embeds++;
    const label = attrs.title || attrs.name || attrs.alt || textOf(inner).trim() || href;
    return [
      { kind: "open", tag: "a", attrs: { href } },
      { kind: "text", text: label },
      { kind: "close", tag: "a" },
    ];
  };
  // Self-closed embeds first (no open/close pair), then the paired form.
  toks = toks.flatMap((t) =>
    t.kind === "void" && EMBED_TAGS.includes(t.tag ?? "") ? toEmbedLink(t.attrs ?? {}, []) : [t]
  );
  toks = transformBlocks(toks, EMBED_TAGS, (open, inner) => toEmbedLink(open.attrs ?? {}, inner));

  // 3. Callouts → <blockquote>: rename the callout container, its children carry through unchanged.
  toks = transformBlocks(
    toks,
    (t) => t.kind === "open" && isCallout(t.attrs ?? {}),
    (open, inner) => {
      // A callout already authored as a blockquote maps 1:1 and isn't a fidelity loss.
      if (open.tag !== "blockquote") callouts++;
      return [
        { kind: "open", tag: "blockquote", attrs: {} },
        ...inner,
        { kind: "close", tag: "blockquote" },
      ];
    }
  );

  // 4. Collapsibles → heading + body: <details>/<summary>, or a Coda collapsible div whose first
  // labelled child acts as the summary. No collapsible primitive exists in the target editor.
  toks = transformBlocks(
    toks,
    (t) =>
      t.kind === "open" &&
      (t.tag === "details" || (BLOCK.has(t.tag!) && classMatches(t.attrs ?? {}, /collaps/))),
    (open, inner) => flattenCollapsible(open, inner, () => collapsibles++)
  );

  // 5. Heading levels below h3 collapse to h3 (our editor tops out at h3).
  toks = toks.map((t) => {
    if ((t.kind === "open" || t.kind === "close") && /^h[4-6]$/.test(t.tag ?? "")) {
      if (t.kind === "open") headingsDowngraded++;
      return { ...t, tag: "h3" };
    }
    return t;
  });

  // 6. Tables → clean table: carry column widths into a <colgroup>, keep header rows as <thead>,
  // drop Coda's "Table N" caption, and flatten merged cells (recording the loss).
  toks = transformBlocks(toks, ["table"], (_open, inner) =>
    rebuildTable(inner, {
      onCaptionDrop: (auto) => {
        if (!auto) captionsDropped++;
      },
      onMerged: () => mergedTables++,
    })
  );

  // 7. Images: keep only https srcs, and only numeric width/height; drop everything else.
  toks = toks.filter((t) => {
    if (t.tag !== "img" || t.kind === "text") return true;
    const src = t.attrs?.src ?? "";
    if (!/^https:\/\//i.test(src)) {
      imagesDropped++;
      return false;
    }
    return true;
  });

  // 8a. Drop decorative spans (no color/background style), keeping their children.
  toks = transformBlocks(
    toks,
    (t) => t.kind === "open" && t.tag === "span",
    (open, inner) => {
      const style = filterStyle(open.attrs?.style ?? "", new Set(["color", "background-color"]));
      if (!style) return inner;
      return [{ kind: "open", tag: "span", attrs: open.attrs }, ...inner, { kind: "close", tag: "span" }];
    }
  );

  // 8b. Unwrap unknown/wrapper elements (div/section/figure/…), keeping their children. This is what
  // erases the remaining Coda layout chrome.
  toks = unwrapUnknown(toks);

  // 9. Attribute allowlist: strips every data-coda-*, class and id in one pass and filters style.
  toks = toks.map((t) => {
    if (t.kind === "text" || t.kind === "close") return t;
    return { ...t, attrs: cleanAttrs(t.tag!, t.attrs ?? {}) };
  });

  // 10. Drop inline elements left empty (e.g. an anchor whose only image was removed).
  toks = removeEmptyInline(toks);

  // 11. Drop layout-only whitespace between block boundaries (outside <pre>).
  toks = dropStructuralWhitespace(toks);

  if (embeds > 0) losses.push(`${embeds} embed${plural(embeds)} converted to ${embeds === 1 ? "a link" : "links"}`);
  if (embedsDropped > 0) losses.push(`${embedsDropped} embed${plural(embedsDropped)} dropped (no linkable URL)`);
  if (callouts > 0) losses.push(`${callouts} callout${plural(callouts)} converted to blockquote${plural(callouts)}`);
  if (collapsibles > 0) losses.push(`${collapsibles} collapsible section${plural(collapsibles)} flattened to a heading + body`);
  if (mergedTables > 0) losses.push(`merged table cells flattened in ${mergedTables} table${plural(mergedTables)}`);
  if (imagesDropped > 0) losses.push(`${imagesDropped} non-https image${plural(imagesDropped)} dropped`);
  if (captionsDropped > 0) losses.push(`${captionsDropped} table caption${plural(captionsDropped)} removed`);
  if (headingsDowngraded > 0) losses.push(`${headingsDowngraded} heading${plural(headingsDowngraded)} below level 3 downgraded to h3`);

  return { html: serialize(toks).trim(), losses };
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

// Remove DROP_SUBTREE elements together with everything they contain.
function dropSubtrees(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "void" && DROP_SUBTREE.has(t.tag ?? "")) continue;
    if (t.kind === "open" && DROP_SUBTREE.has(t.tag ?? "")) {
      const close = findMatching(toks, i);
      if (close !== -1) {
        i = close;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

// Iterate elements matching `match` (a tag list or predicate); replace each element (open→close)
// with the tokens `build` returns from the open token and its inner tokens.
function transformBlocks(
  toks: Tok[],
  match: string[] | ((t: Tok) => boolean),
  build: (open: Tok, inner: Tok[]) => Tok[]
): Tok[] {
  const pred =
    typeof match === "function"
      ? match
      : (t: Tok) => t.kind === "open" && match.includes(t.tag ?? "");
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "open" && pred(t)) {
      const close = findMatching(toks, i);
      if (close !== -1) {
        out.push(...build(t, toks.slice(i + 1, close)));
        i = close;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

function flattenCollapsible(_open: Tok, inner: Tok[], onFlatten: () => void): Tok[] {
  onFlatten();
  // Find the summary element: a real <summary>, else the first child flagged as summary/title/header.
  let sOpen = inner.findIndex((t) => t.kind === "open" && t.tag === "summary");
  if (sOpen === -1) {
    sOpen = inner.findIndex(
      (t) => t.kind === "open" && classMatches(t.attrs ?? {}, /summary|title|header/)
    );
  }
  let title: Tok[] = [];
  let body = inner;
  if (sOpen !== -1) {
    const sClose = findMatching(inner, sOpen);
    if (sClose !== -1) {
      title = inner.slice(sOpen + 1, sClose);
      body = inner.slice(0, sOpen).concat(inner.slice(sClose + 1));
    }
  }
  const head: Tok[] = [];
  if (textOf(title).trim().length > 0) {
    head.push({ kind: "open", tag: "h3", attrs: {} }, ...title, { kind: "close", tag: "h3" });
  }
  return head.concat(body);
}

interface Row {
  header: boolean;
  cells: { header: boolean; inner: Tok[]; width?: number }[];
}

function rebuildTable(
  inner: Tok[],
  hooks: { onCaptionDrop: (auto: boolean) => void; onMerged: () => void }
): Tok[] {
  const widths: (number | undefined)[] = [];
  let merged = false;

  // Column widths, preferred from an existing <colgroup>, else the first row's cell widths.
  const cols = inner.filter((t) => t.tag === "col" && t.kind !== "text");
  for (const col of cols) {
    widths.push(colWidth(col.attrs ?? {}));
  }

  // Drop Coda's auto caption ("Table 1"); a meaningful caption is a real loss worth surfacing.
  for (let i = 0; i < inner.length; i++) {
    if (inner[i].kind === "open" && inner[i].tag === "caption") {
      const close = findMatching(inner, i);
      const capText = close !== -1 ? textOf(inner.slice(i + 1, close)).trim() : "";
      hooks.onCaptionDrop(/^table\s*\d*$/i.test(capText));
    }
  }

  // Collect rows and cells; header = inside <thead> or a row of all-<th>.
  const rows: Row[] = [];
  let inThead = 0;
  for (let i = 0; i < inner.length; i++) {
    const t = inner[i];
    if (t.kind === "open" && t.tag === "thead") inThead++;
    else if (t.kind === "close" && t.tag === "thead") inThead = Math.max(0, inThead - 1);
    else if (t.kind === "open" && t.tag === "tr") {
      const close = findMatching(inner, i);
      if (close === -1) continue;
      const rowToks = inner.slice(i + 1, close);
      const cells: Row["cells"] = [];
      for (let j = 0; j < rowToks.length; j++) {
        const c = rowToks[j];
        if (c.kind === "open" && (c.tag === "td" || c.tag === "th")) {
          const cClose = findMatching(rowToks, j);
          if (cClose === -1) continue;
          const a = c.attrs ?? {};
          if ((a.colspan && a.colspan !== "1") || (a.rowspan && a.rowspan !== "1")) merged = true;
          cells.push({
            header: c.tag === "th",
            inner: rowToks.slice(j + 1, cClose),
            width: colWidth(a),
          });
          j = cClose;
        }
      }
      const allHeader = cells.length > 0 && cells.every((c) => c.header);
      rows.push({ header: inThead > 0 || allHeader, cells });
      i = close;
    }
  }

  if (merged) hooks.onMerged();

  const colCount = rows.reduce((n, r) => Math.max(n, r.cells.length), 0);
  if (widths.length === 0 && colCount > 0) {
    const first = rows[0];
    if (first) for (const c of first.cells) widths.push(c.width);
  }

  const out: Tok[] = [{ kind: "open", tag: "table", attrs: {} }];

  if (colCount > 0 && widths.some((w) => typeof w === "number")) {
    out.push({ kind: "open", tag: "colgroup", attrs: {} });
    for (let c = 0; c < colCount; c++) {
      const w = widths[c];
      out.push({
        kind: "void",
        tag: "col",
        attrs: typeof w === "number" ? { style: `width: ${w}px` } : {},
      });
    }
    out.push({ kind: "close", tag: "colgroup" });
  }

  emitSection(out, rows.filter((r) => r.header), "thead", "th");
  emitSection(out, rows.filter((r) => !r.header), "tbody", "td");

  out.push({ kind: "close", tag: "table" });
  return out;
}

function emitSection(out: Tok[], rows: Row[], section: string, cellTag: string): void {
  if (rows.length === 0) return;
  out.push({ kind: "open", tag: section, attrs: {} });
  for (const r of rows) {
    out.push({ kind: "open", tag: "tr", attrs: {} });
    for (const c of r.cells) {
      out.push({ kind: "open", tag: cellTag, attrs: {} }, ...c.inner, { kind: "close", tag: cellTag });
    }
    out.push({ kind: "close", tag: "tr" });
  }
  out.push({ kind: "close", tag: section });
}

function colWidth(attrs: Attrs): number | undefined {
  return parsePx(styleWidth(attrs.style) ?? attrs.width);
}

function styleWidth(style: string | undefined): string | undefined {
  if (!style) return undefined;
  const m = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(style);
  return m ? m[1].trim() : undefined;
}

// Unwrap any element outside the allowed set (keep children).
function unwrapUnknown(toks: Tok[]): Tok[] {
  return toks.filter((t) => {
    if (t.kind === "text") return true;
    // Unknown tag: drop this open/close/void token, its children survive around it.
    return ALLOWED.has(t.tag ?? "");
  });
}

function cleanAttrs(tag: string, attrs: Attrs): Attrs {
  const keep = KEEP_ATTRS[tag];
  if (!keep) return {};
  const out: Attrs = {};
  for (const name of Object.keys(attrs)) {
    if (!keep.has(name)) continue;
    let val = attrs[name];
    if (name === "style") {
      const props =
        tag === "span"
          ? new Set(["color", "background-color"])
          : new Set(["width"]);
      val = filterStyle(val, props);
      if (!val) continue;
    }
    if ((name === "width" || name === "height") && !/^\d+$/.test(val)) continue;
    out[name] = val;
  }
  return out;
}

const INLINE = new Set(["a", "span", "b", "strong", "i", "em", "u", "code"]);

// Repeatedly remove inline elements whose content is empty/whitespace until the stream is stable.
function removeEmptyInline(toks: Tok[]): Tok[] {
  let changed = true;
  let cur = toks;
  while (changed) {
    changed = false;
    const out: Tok[] = [];
    for (let i = 0; i < cur.length; i++) {
      const t = cur[i];
      if (t.kind === "open" && INLINE.has(t.tag ?? "")) {
        const close = findMatching(cur, i);
        if (close !== -1) {
          const body = cur.slice(i + 1, close);
          const empty =
            body.every((b) => b.kind === "text" && isWhitespace(b.text ?? "")) &&
            !body.some((b) => b.kind !== "text");
          if (empty) {
            changed = true;
            i = close;
            continue;
          }
        }
      }
      out.push(t);
    }
    cur = out;
  }
  return cur;
}

// Drop text nodes that are pure whitespace sitting between block boundaries (source indentation),
// leaving <pre> content untouched.
function dropStructuralWhitespace(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  let preDepth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.tag === "pre" && t.kind === "open") preDepth++;
    if (t.tag === "pre" && t.kind === "close") preDepth = Math.max(0, preDepth - 1);
    if (t.kind === "text" && preDepth === 0 && isWhitespace(t.text ?? "")) {
      const prev = out[out.length - 1];
      const next = toks[i + 1];
      const prevBlock = !prev || (prev.kind !== "text" && BLOCK.has(prev.tag ?? ""));
      const nextBlock = !next || (next.kind !== "text" && BLOCK.has(next.tag ?? ""));
      if (prevBlock && nextBlock) continue;
    }
    out.push(t);
  }
  return out;
}
