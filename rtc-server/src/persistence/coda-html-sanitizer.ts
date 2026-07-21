import { JSDOM } from "jsdom";

// Post-pass over doc-editor exportDOM output that constrains it to the lossy subset Coda's HTML
// import accepts (design §14, H4). Every transform is a structural DOM edit; nothing here recovers
// data the exportDOM already dropped (see coda-extract report for fixes deferred to the package).

// Move an element's children into its place, then remove the element (comment marks, added-diff, layout wrappers).
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

// True when an element carries no rendered text and no element children (comment-icon / chip spans).
function isEmptyInline(el: Element): boolean {
  return (
    el.children.length === 0 && (el.textContent ?? "").trim().length === 0
  );
}

export function sanitizeConstrainedHtml(html: string): string {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  const body = doc.body;

  // 1. Diff marks (C7): drop `removed` subtrees entirely, unwrap `added` keeping the real content.
  body
    .querySelectorAll(".ds-de-content-removed")
    .forEach((el) => el.remove());
  body
    .querySelectorAll(".ds-de-content-added")
    .forEach((el) => unwrap(el));

  // 2. Comment / inline-comment marks (C8): <mark> always wraps real text — unwrap, never delete.
  body.querySelectorAll("mark").forEach((el) => unwrap(el));

  // 3. Smart placeholders (C5, partial): exportDOM emits an empty span but preserves the label in
  // data-placeholder-name/-placeholder — recover it as text. A resolved runtime value is NOT in the
  // export and cannot be recovered here (deferred to a package exportDOM change).
  body
    .querySelectorAll('span[data-node-type="smart-placeholder"]')
    .forEach((el) => {
      const label =
        el.getAttribute("data-placeholder-name") ||
        el.getAttribute("data-placeholder") ||
        "";
      if (label) el.replaceWith(doc.createTextNode(label));
      else el.remove();
    });

  // 4. Collapsibles (§14): <details> has no Coda importer — flatten to a heading + its content.
  body.querySelectorAll("details").forEach((details) => {
    const frag = doc.createDocumentFragment();
    const summary = details.querySelector("summary");
    const titleText = (summary?.textContent ?? "").trim();
    if (titleText) {
      const h = doc.createElement("h3");
      h.textContent = titleText;
      frag.appendChild(h);
    }
    const content = details.querySelector(
      '[data-lexical-collapsible-content], div'
    );
    const source = content ?? details;
    // Move everything except the summary (its svg chevron + title already captured above).
    Array.from(source.childNodes).forEach((n) => {
      if (n.nodeType === 1 && (n as Element).tagName.toLowerCase() === "summary")
        return;
      frag.appendChild(n);
    });
    details.replaceWith(frag);
  });

  // 5. Layout columns (§14): display:grid is ignored by Coda — strip the grid so items stack
  // sequentially as plain block sections.
  body
    .querySelectorAll("[data-lexical-layout-item]")
    .forEach((item) => {
      item.removeAttribute("data-lexical-layout-item");
      item.removeAttribute("data-grid-column");
      item.removeAttribute("style");
    });
  body
    .querySelectorAll("[data-lexical-layout-container]")
    .forEach((container) => {
      container.removeAttribute("data-lexical-layout-container");
      container.removeAttribute("data-lexical-layout-container-version");
      container.removeAttribute("data-lexical-layout-template");
      container.removeAttribute("style");
    });

  // 6. Embeds / iframes (§14): unsupported — preserve only the URL as a plain link.
  body.querySelectorAll("iframe").forEach((iframe) => {
    const youtubeId = iframe.getAttribute("data-lexical-youtube");
    const href = youtubeId
      ? `https://www.youtube.com/watch?v=${youtubeId}`
      : iframe.getAttribute("src") ?? "";
    if (!/^https?:\/\//i.test(href)) {
      iframe.remove();
      return;
    }
    const a = doc.createElement("a");
    a.setAttribute("href", href);
    a.textContent = href;
    iframe.replaceWith(a);
  });

  // 7. Attachment / file-embed anchors (C3): keep a clean labeled download link, drop editor chrome.
  body.querySelectorAll('a[data-embed="embed-media"]').forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) {
      a.remove();
      return;
    }
    const label = a.getAttribute("data-name") || a.textContent || href;
    for (const attr of Array.from(a.attributes)) {
      if (attr.name !== "href") a.removeAttribute(attr.name);
    }
    a.textContent = label;
  });

  // 8. Images (C4, §14): keep only https srcs; drop empty / undefined / non-public ones. Never emit
  // src="undefined".
  body.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (!/^https:\/\//i.test(src)) {
      const parent = img.parentElement;
      img.remove();
      // A wrapping anchor that only held the dropped image is now empty chrome.
      if (parent && parent.tagName.toLowerCase() === "a" && isEmptyInline(parent))
        parent.remove();
      return;
    }
    const width = img.getAttribute("width");
    if (width !== null && !/^\d+$/.test(width)) img.removeAttribute("width");
    const height = img.getAttribute("height");
    if (height !== null && !/^\d+$/.test(height)) img.removeAttribute("height");
  });

  // 9. Strip <figure>/<figcaption> (§14): unsupported wrappers — keep the figure's contents.
  body.querySelectorAll("figcaption").forEach((el) => el.remove());
  body.querySelectorAll("figure").forEach((el) => unwrap(el));

  // 10. Tables (§14): reduce to a clean <table><tbody> — no headers, no merged cells. Accept the loss.
  body.querySelectorAll("table").forEach((table) => {
    const rows = Array.from(table.querySelectorAll("tr"));
    const tbody = doc.createElement("tbody");
    for (const tr of rows) {
      const cleanTr = doc.createElement("tr");
      const cells = Array.from(tr.children).filter((c) => {
        const t = c.tagName.toLowerCase();
        return t === "td" || t === "th";
      });
      for (const cell of cells) {
        const td = doc.createElement("td");
        while (cell.firstChild) td.appendChild(cell.firstChild);
        cleanTr.appendChild(td);
      }
      tbody.appendChild(cleanTr);
    }
    while (table.firstChild) table.removeChild(table.firstChild);
    table.appendChild(tbody);
  });

  // 11. Final cleanup: drop leftover empty inline spans (comment-icon / chip decorators).
  body.querySelectorAll("span").forEach((el) => {
    if (isEmptyInline(el)) el.remove();
  });

  return body.innerHTML;
}
