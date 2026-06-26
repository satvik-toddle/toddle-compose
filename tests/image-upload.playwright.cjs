// End-to-end check of doc-editor image insertion in toddle-compose. Verifies the
// `uploadToServer` prop (wired in frontend/src/features/workspace/DocEditor.tsx)
// is actually invoked for every insertion mechanism and that the rendered <img>
// resolves to a loadable backend URL (not a blob:/data: preview or broken image).
//
// Background: a refactor dropped the editor's `uploadToServer` prop, so NO image
// upload mechanism worked (the editor had no upload function). This asserts all
// three mechanisms now work, end-to-end, through the real backend upload route.
//
// Insertion mechanisms (the slash menu is the only image-insert entry point in
// toddle-compose — the editor's top toolbar "Insert" menu is disabled via the
// `toolbar: { enabled: false }` config in DocEditor.tsx):
//   1. URL add     — slash menu → "Insert image by URL" dialog → uploadToServer
//   2. File upload  — paste a File → DRAG_DROP_PASTE → uploadToServer
//   3. Drag & drop  — drop a File  → DRAG_DROP_PASTE → uploadToServer
//
// Data-ids mirror the doc-editor's own playground TEST_IDS
// (packages/playground/tests/constants.js): note the DS Button appends "-button"
// to its testId (modal-accept-button → modal-accept-button-button).
//
// Prereqs: postgres + backend :4000 + rtc :4001 + frontend :5173, seeded
// (`pnpm db:seed`). IMPORTANT: BACKEND_PUBLIC_URL must be reachable by the
// browser (http://localhost:4000 for local dev) or uploaded <img> URLs render as
// broken images. Run with a playwright install on NODE_PATH, e.g.:
//   node tests/image-upload.playwright.cjs
const { chromium } = require("playwright");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const API = "http://localhost:4000/api";
const APP = "http://localhost:5173";
const PW = "password123";
const EDITOR = ".ds-de-contentEditable";
const ART_DIR = path.join(__dirname, "artifacts", "image-upload");

// Canonical doc-editor test-ids (see playground/tests/constants.js TEST_IDS).
const TID = {
  IMAGE_URL_INPUT: "image-add-url-input",
  MODAL_ACCEPT: "modal-accept-button-button", // DS Button suffixes testId with "-button"
};

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log("  PASS " + msg); }
  else { fail++; console.log("  FAIL " + msg); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, { method = "GET", token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const login = (email) => api("/auth/login", { method: "POST", body: { email, password: PW } });

function makePng(width, height, [r, g, b]) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) { const row = y * (1 + width * 3); for (let x = 0; x < width; x++) { raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b; } }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A final, server-stored URL (vs. a local blob:/data: preview or empty src).
const isResolved = (src) => !!src && /^https?:\/\//.test(src) && /\/api\/uploads\//.test(src);

async function waitForResolvedImg(page, minCount, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const srcs = await page.$$eval(`${EDITOR} img`, (els) => els.map((e) => e.src));
    const resolved = srcs.filter(isResolved);
    if (resolved.length >= minCount) return resolved;
    await sleep(250);
  }
  const srcs = await page.$$eval(`${EDITOR} img`, (els) => els.map((e) => e.src)).catch(() => []);
  return srcs.filter(isResolved);
}

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });
  const stamp = Date.now();

  console.log("Setting up workspace/document via API…");
  const owner = await login("owner@toddle.test");
  const ws = await api("/workspaces", {
    method: "POST", token: owner.accessToken,
    body: { name: `img-e2e-${stamp}`, visibility: "PRIVATE", defaultRole: "READ" },
  });
  const ownerWs = await api("/auth/workspace/enter", {
    method: "POST", token: owner.accessToken, body: { workspaceId: ws.id },
  });
  const doc = await api("/documents", {
    method: "POST", token: ownerWs.accessToken, body: { title: "image e2e", workspaceId: ws.id },
  });
  const docUrl = `${APP}/w/${encodeURIComponent(ws.id)}?doc=${encodeURIComponent(doc.id)}`;
  console.log(`  doc: ${docUrl}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  // Seed the persisted auth store; bootstrapAuth() re-mints an access token from
  // the refresh token and the scope route enters the workspace from the URL.
  await ctx.addInitScript(
    ({ refresh, wsId }) => {
      localStorage.setItem("tc-auth", JSON.stringify({ state: { refreshToken: refresh, lastActiveWorkspaceId: wsId }, version: 0 }));
    },
    { refresh: owner.refreshToken, wsId: ws.id },
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

  let uploadPosts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/uploads")) uploadPosts++; });

  await page.goto(docUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(EDITOR, { timeout: 30000 });
  await sleep(1500); // let collab connect + editor settle
  console.log("Editor mounted.\n");

  // ---------- Path 1: URL add via the slash menu dialog ----------
  // Run first, on the empty doc: the slash typeahead only triggers from a clean
  // text caret, simplest to guarantee before any images are inserted.
  console.log("Path 1 — URL add (slash menu → insert image by URL):");
  const before1 = uploadPosts;
  await page.click(EDITOR);
  await page.keyboard.type("/");
  await page.waitForSelector(".ds-de-slash-menu", { timeout: 8000 });
  await page.keyboard.type("url"); // single keyword — matches the "Insert image by URL" option
  await sleep(400);
  await page.locator('[role="option"]', { hasText: /image by url/i }).first().click({ timeout: 8000 });
  await page.locator(`[data-test-id="${TID.IMAGE_URL_INPUT}"]`).waitFor({ timeout: 8000 });
  // A self-contained external URL the editor fetches + re-uploads via uploadToServer.
  const dataUrl = "data:image/png;base64," + makePng(180, 100, [60, 200, 90]).toString("base64");
  await page.locator(`[data-test-id="${TID.IMAGE_URL_INPUT}"]`).fill(dataUrl);
  await page.locator(`[data-test-id="${TID.MODAL_ACCEPT}"]`).click({ timeout: 8000 });
  let resolved = await waitForResolvedImg(page, 1);
  ok(uploadPosts > before1, `upload POST fired (${uploadPosts - before1})`);
  ok(resolved.length >= 1, `URL-added image resolved to a backend URL (${resolved[0] ? resolved[0].slice(0, 60) : "none"})`);

  // ---------- Path 2: file upload via paste ----------
  console.log("Path 2 — file upload (paste a File):");
  const before2 = uploadPosts;
  await page.click(EDITOR);
  await page.evaluate(({ b64, sel }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "paste.png", { type: "image/png" });
    const dt = new DataTransfer(); dt.items.add(file);
    document.querySelector(sel).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { b64: makePng(240, 160, [220, 60, 60]).toString("base64"), sel: EDITOR });
  resolved = await waitForResolvedImg(page, 2);
  ok(uploadPosts > before2, `upload POST fired (${uploadPosts - before2})`);
  ok(resolved.length >= 2, `pasted image resolved to a backend URL (total resolved: ${resolved.length})`);

  // ---------- Path 3: drag & drop a File ----------
  console.log("Path 3 — drag & drop a File:");
  const before3 = uploadPosts;
  await page.evaluate(({ b64, sel }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "drop.png", { type: "image/png" });
    const dt = new DataTransfer(); dt.items.add(file);
    const ed = document.querySelector(sel);
    const r = ed.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: r.top + 40 };
    ed.dispatchEvent(new DragEvent("dragenter", opts));
    ed.dispatchEvent(new DragEvent("dragover", opts));
    ed.dispatchEvent(new DragEvent("drop", opts));
  }, { b64: makePng(200, 120, [40, 140, 220]).toString("base64"), sel: EDITOR });
  resolved = await waitForResolvedImg(page, 3);
  ok(uploadPosts > before3, `upload POST fired (${uploadPosts - before3})`);
  ok(resolved.length >= 3, `dropped image resolved to a backend URL (total resolved: ${resolved.length})`);

  await page.screenshot({ path: path.join(ART_DIR, "result.png"), fullPage: true });
  console.log(`\nScreenshot: ${path.join(ART_DIR, "result.png")}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(2); });
