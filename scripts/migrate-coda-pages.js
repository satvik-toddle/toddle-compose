/* eslint-disable */
// Migrate Coda docs: walk the sidebar page-list into nested
// { name, href, children } JSON, then optionally enrich each page with its
// content HTML.
//
// Usage (paste into the browser devtools console on the Coda doc):
//   const tree = await getPageTree();      // structure only (expands sidebar, nests)
//   await getPageContents(tree);           // adds node.content (2s between pages)
//   copy(JSON.stringify(tree, null, 2));   // devtools helper: copies to clipboard
//
// getPageTree options:
//   { expand: false }  -> serialize only what's already open (no clicking)
//   { href: false }    -> omit the href field
//   { debug: false }   -> silence the console logging
//
// Stable hooks (Coda's class names are hashed and change per build, so we avoid them):
//   [data-coda-ui-id="page-list-item"]      an item row, carries data-object-id="section-…"
//   [data-coda-ui-id="page-list-anchor"]    the <a>; aria-labelledby points at the title
//   [data-object-id$="-chevron"]            present ONLY on expandable items (with aria-expanded)
//   ul[data-object-id="<item-id>-children"] an item's children list — EXACT id match, so it
//                                           doesn't matter how many wrapper <div>s sit between.

async function getPageTree({ expand = true, href = true, debug = true } = {}) {
  const log = debug ? (...a) => console.log('[coda-tree]', ...a) : () => {};

  // 1) Expand every collapsed node, looping because expanding reveals more.
  if (expand) {
    for (let round = 0; round < 50; round++) {
      const collapsed = document.querySelectorAll(
        '[data-object-id$="-chevron"][aria-expanded="false"]'
      );
      if (!collapsed.length) break;
      log(`expand round ${round + 1}: clicking ${collapsed.length} collapsed node(s)`);
      collapsed.forEach((c) => c.click());
      await new Promise((r) => setTimeout(r, 350)); // let Coda render the children
    }
  }

  const allItems = [...document.querySelectorAll('[data-coda-ui-id="page-list-item"]')];
  const childUls = [...document.querySelectorAll('ul[data-object-id$="-children"]')];
  log(`found ${allItems.length} page items, ${childUls.length} children-lists in DOM`);

  // The page-list-item that <el> belongs to (nearest ancestor/self).
  const ownerItem = (el) => el.closest('[data-coda-ui-id="page-list-item"]');

  const build = (item) => {
    // This item's OWN anchor (not a descendant page's), matched by ownership.
    const anchor = [...item.querySelectorAll('[data-coda-ui-id="page-list-anchor"]')].find(
      (a) => ownerItem(a) === item
    );
    const titleEl = anchor && document.getElementById(anchor.getAttribute('aria-labelledby'));
    const node = { name: titleEl ? titleEl.textContent.trim() : '' };
    if (href && anchor) node.href = anchor.getAttribute('href');

    // Children list is named exactly "<this item's object-id>-children".
    const id = item.getAttribute('data-object-id');
    const childUl = id && document.querySelector(`ul[data-object-id="${id}-children"]`);
    if (childUl) {
      const kids = [...childUl.querySelectorAll('[data-coda-ui-id="page-list-item"]')]
        // keep only DIRECT children of this ul, not deeper grandchildren
        .filter((it) => it.closest('ul[data-object-id$="-children"]') === childUl)
        .map(build);
      if (kids.length) {
        node.children = kids;
        log(`"${node.name}" -> ${kids.length} child(ren)`);
      }
    }
    return node;
  };

  // Roots = items that live in the top list (not inside any "-children" ul).
  const roots = allItems.filter((it) => !it.closest('ul[data-object-id$="-children"]'));
  log(`${roots.length} root item(s)`);

  const tree = roots.map(build);
  const count = (nodes) => nodes.reduce((n, x) => n + 1 + (x.children ? count(x.children) : 0), 0);
  log(`done: ${count(tree)} pages total`);
  return tree;
}

// ---------------------------------------------------------------------------
// Enrich a tree (from getPageTree) with each page's content HTML.
//
//   const tree = await getPageTree();
//   await getPageContents(tree);           // mutates tree, adds node.content
//   copy(JSON.stringify(tree, null, 2));
//
// How it works per page:
//   1. click the sidebar anchor  -> SPA navigates in place (our fn survives)
//   2. wait for that page's editor ([data-coda-ui-id="editable"]) to load
//   3. dispatch real Cmd/Ctrl+A keydowns so CODA'S OWN selection model selects
//      the whole doc — a plain DOM Range doesn't update Coda's model, so it drops
//      tables (Coda stores them as grid objects, not contenteditable text).
//   4. execCommand('copy') and read text/html off the copy event; Coda's copy
//      handler serializes ITS selection (incl. tables) into clean export HTML.
//   5. fallback: serialize a DOM Range's cloneContents() (rawer, may miss tables,
//      but never empty) only if the copy event yielded nothing.
//
// Options:
//   settle          ms to wait after the editor appears, for lazy content  (default 2000)
//   pageDelay       ms to pause between pages, after each capture           (default 2000)
//   selectAllPresses  how many Cmd/Ctrl+A presses to fire (Coda's progressive
//                     select-all needs ~2; extra is harmless)              (default 3)
//   limit           only process the first N pages (for testing)          (default Infinity)
//   timeout         ms to wait for the editor to load per page             (default 15000)
//   debug           console logging                                        (default true)
//
//   // e.g. quick test on the first 10 pages:
//   await getPageContents(tree, { limit: 10 });
//
// Run it in the Coda tab and don't touch the browser while it walks the pages.

async function getPageContents(
  tree,
  {
    settle = 2000,
    pageDelay = 2000,
    selectAllPresses = 3,
    limit = Infinity,
    timeout = 15000,
    debug = true,
  } = {}
) {
  const log = debug ? (...a) => console.log('[coda-content]', ...a) : () => {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  // Fire a real Cmd/Ctrl+A keydown so Coda's editor runs its own select-all.
  const pressSelectAll = (el) => {
    const init = { key: 'a', code: 'KeyA', keyCode: 65, which: 65, bubbles: true, cancelable: true };
    if (isMac) init.metaKey = true;
    else init.ctrlKey = true;
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  };

  // Flatten depth-first, keeping references so we can mutate nodes in place.
  const flat = [];
  (function walk(nodes) {
    for (const n of nodes) {
      flat.push(n);
      if (n.children) walk(n.children);
    }
  })(tree);
  const pages = flat.slice(0, limit);
  log(`extracting content for ${pages.length} of ${flat.length} pages`);

  const waitFor = async (cond) => {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      const v = cond();
      if (v) return v;
      await sleep(150);
    }
    return null;
  };

  // Fire a copy and read the HTML Coda wrote onto the copy event.
  const readCopiedHtml = () =>
    new Promise((resolve) => {
      let settled = false;
      const handler = (e) => {
        settled = true;
        resolve(e.clipboardData ? e.clipboardData.getData('text/html') : '');
      };
      document.addEventListener('copy', handler, { once: true });
      document.execCommand('copy');
      setTimeout(() => {
        if (!settled) {
          document.removeEventListener('copy', handler);
          resolve('');
        }
      }, 500);
    });

  for (let i = 0; i < pages.length; i++) {
    const node = pages[i];
    const tag = `(${i + 1}/${pages.length}) ${node.name}`;

    const anchor = document.querySelector(
      `a[data-coda-ui-id="page-list-anchor"][href="${node.href}"]`
    );
    if (!anchor) {
      log(`${tag}: SKIP — anchor not in sidebar (expand it first?)`);
      node.content = null;
      continue;
    }

    anchor.click();

    // Prefer the editor whose aria-label matches this page; fall back to any editor.
    const editable =
      (await waitFor(() =>
        [...document.querySelectorAll('[data-coda-ui-id="editable"][contenteditable="true"]')].find(
          (el) => el.getAttribute('aria-label') === `${node.name} editor`
        )
      )) ||
      document.querySelector('[data-coda-ui-id="editable"][contenteditable="true"]');

    if (!editable) {
      log(`${tag}: SKIP — no editor loaded`);
      node.content = null;
      continue;
    }

    await sleep(settle); // let lazy blocks render

    // Drive Coda's native select-all (captures tables); a DOM Range would not.
    editable.focus();
    for (let p = 0; p < selectAllPresses; p++) {
      pressSelectAll(editable);
      await sleep(120);
    }

    let html = await readCopiedHtml();
    let via = 'copy-event';
    if (!html) {
      // Last resort: raw DOM Range (may miss tables, but never empty).
      const range = document.createRange();
      range.selectNodeContents(editable);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      html = await readCopiedHtml();
      via = 'copy-event(range)';
      if (!html) {
        const tmp = document.createElement('div');
        tmp.appendChild(range.cloneContents());
        html = tmp.innerHTML;
        via = 'dom-fallback';
      }
    }
    window.getSelection().removeAllRanges();

    node.content = html;
    log(`${tag}: ${html.length} chars (${via})`);
    await sleep(pageDelay); // pause before switching to the next page
  }

  log('done');
  return tree;
}

// ---------------------------------------------------------------------------
// Write an HTML string to the clipboard AS html (so pasting yields rich content,
// not the raw markup). Useful for pushing a captured node.content somewhere.
//
//   await copyHtmlToClipboard('<b>hello</b> <i>world</i>');
//   // then Cmd+V into any rich editor
//
// Note: the clipboard write needs the page focused — if it fails, click once on
// the page body (not the devtools panel) and re-run.

async function copyHtmlToClipboard(html) {
  // Preferred: async Clipboard API with an explicit text/html item.
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([html], { type: 'text/plain' }),
        }),
      ]);
      console.log('[copyHtml] wrote', html.length, 'chars via Clipboard API');
      return true;
    } catch (e) {
      console.warn('[copyHtml] Clipboard API failed, falling back to execCommand:', e);
    }
  }
  // Fallback: intercept the copy event and set the data ourselves.
  const ok = await new Promise((resolve) => {
    const handler = (e) => {
      e.preventDefault();
      e.clipboardData.setData('text/html', html);
      e.clipboardData.setData('text/plain', html);
    };
    document.addEventListener('copy', handler, { once: true });
    const done = document.execCommand('copy');
    document.removeEventListener('copy', handler);
    resolve(done);
  });
  console.log('[copyHtml]', ok ? `wrote ${html.length} chars via execCommand` : 'FAILED');
  return ok;
}

// Node/module export (harmless in the console).
if (typeof module !== 'undefined' && module.exports)
  module.exports = { getPageTree, getPageContents, copyHtmlToClipboard };
