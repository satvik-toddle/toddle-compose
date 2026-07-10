// Two-user collaborative upload semantics (current toddle-compose frontend):
//   A. While user1's upload is pending, user2 must see NOTHING for it — no <img>,
//      no image wrapper, no broken placeholder, no uploading spinner. The image
//      data must not be reflected to the collaborator until the upload completes.
//   B. After completion, user2 sees the real (server) image.
//   C. Exactly 1 upload POST from user1; 0 from user2 (no collaborator re-upload).
//   D. If user1 reloads MID-upload, no broken/visible state persists for either
//      user (UploadCleanupPlugin drops the own-pending node on unload).
//
// The pending window is made observable by delaying user1's POST /api/uploads
// response via Playwright route interception (no app code change).
//
// Prereqs: stack up (backend :4000, rtc :4001, frontend :5173), seeded, and
// BACKEND_PUBLIC_URL reachable by the browser (http://localhost:4000 local).
const { chromium } = require("playwright");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const API = "http://localhost:4000/api";
const APP = "http://localhost:5173";
const PW = "password123";
const EDITOR = ".ds-de-contentEditable";
const DELAY_MS = 6000;
const ART_DIR = path.join(__dirname, "artifacts", "multiuser");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS " + msg); } else { fail++; console.log("  FAIL " + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, { method = "GET", token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const login = (email) => api("/auth/login", { method: "POST", body: { email, password: PW } });

function makePng(w, h, [r, g, b]) {
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const bo = Buffer.concat([Buffer.from(t, "ascii"), d]); const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(bo)); return Buffer.concat([l, bo, cb]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3)); for (let y = 0; y < h; y++) { const ro = y * (1 + w * 3); for (let x = 0; x < w; x++) { raw[ro + 1 + x * 3] = r; raw[ro + 2 + x * 3] = g; raw[ro + 3 + x * 3] = b; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw)), ch("IEND", Buffer.alloc(0))]);
}

// What a collaborator could possibly see for an upload: rendered <img>, image
// wrapper, broken-image placeholder, or an explicit uploading spinner.
const LEAK_PROBE = `(() => {
  const ed = document.querySelector("${EDITOR}");
  if (!ed) return { ready: false };
  return {
    ready: true,
    imgs: ed.querySelectorAll("img").length,
    wrappers: ed.querySelectorAll(".ds-de-image-margin-wrapper").length,
    broken: ed.querySelectorAll('.ds-de-brokenImage-placeholder, [class*="broken"]').length,
    uploading: ed.querySelectorAll('[data-test-id*="uploading"]').length,
  };
})()`;

async function openDoc(browser, { refresh, wsId, docUrl, tag }) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  // Seed ONCE — refresh tokens rotate on use, so re-seeding the stale seed token
  // on reload would trigger a family-kill logout. Only set if absent.
  await ctx.addInitScript(({ r, w }) => { if (!localStorage.getItem("tc-auth")) localStorage.setItem("tc-auth", JSON.stringify({ state: { refreshToken: r, lastActiveWorkspaceId: w }, version: 0 })); }, { r: refresh, w: wsId });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [${tag}] pageerror: ${e.message}`));
  await page.goto(docUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(EDITOR, { timeout: 30000 });
  await sleep(1500);
  return { ctx, page };
}

const pasteImage = (page, b64) => page.evaluate(({ b64, sel }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], "u.png", { type: "image/png" });
  const dt = new DataTransfer(); dt.items.add(file);
  document.querySelector(sel).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, { b64, sel: EDITOR });

async function main() {
  fs.mkdirSync(ART_DIR, { recursive: true });
  const stamp = Date.now();

  console.log("Setup: workspace + doc, alice has EDIT…");
  const owner = await login("owner@toddle.test");
  const alice = await login("alice@toddle.test");
  const ws = await api("/workspaces", { method: "POST", token: owner.accessToken, body: { name: `mu-${stamp}`, visibility: "PRIVATE", defaultRole: "READ" } });
  await api(`/workspaces/${ws.id}/users`, { method: "POST", token: owner.accessToken, body: { email: "alice@toddle.test", role: "EDIT" } });
  const ownerWs = await api("/auth/workspace/enter", { method: "POST", token: owner.accessToken, body: { workspaceId: ws.id } });
  const doc = await api("/documents", { method: "POST", token: ownerWs.accessToken, body: { title: "mu", workspaceId: ws.id } });
  const docUrl = `${APP}/w/${encodeURIComponent(ws.id)}?doc=${encodeURIComponent(doc.id)}`;
  console.log(`  doc: ${docUrl}`);

  const browser = await chromium.launch();
  const u1 = await openDoc(browser, { refresh: owner.refreshToken, wsId: ws.id, docUrl, tag: "user1" });
  const u2 = await openDoc(browser, { refresh: alice.refreshToken, wsId: ws.id, docUrl, tag: "user2" });

  // Delay user1's upload POST so the pending window is observable.
  await u1.ctx.route("**/api/uploads", async (route) => { await sleep(DELAY_MS); await route.continue(); });

  const posts = { user1: 0, user2: 0 };
  u1.page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/uploads")) posts.user1++; });
  u2.page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/uploads")) posts.user2++; });

  // ===== A + B + C: pending visibility, completion, upload counts =====
  console.log("\nScenario A/B/C — pending visibility + completion:");
  await u1.page.click(EDITOR);
  await pasteImage(u1.page, makePng(280, 180, [220, 60, 60]).toString("base64"));

  await u1.page.waitForSelector(`${EDITOR} img`, { timeout: 10000 });
  const t0 = Date.now();
  const u1Src0 = await u1.page.$eval(`${EDITOR} img`, (e) => e.src);
  ok(u1Src0.startsWith("blob:"), `user1 sees own local preview immediately (${u1Src0.slice(0, 16)}…)`);

  let samples = 0, leaks = 0, resolvedAt = null;
  while (Date.now() - t0 < DELAY_MS + 20000) {
    const u1Src = await u1.page.$eval(`${EDITOR} img`, (e) => e.src).catch(() => null);
    const pending = u1Src && u1Src.startsWith("blob:");
    const probe = await u2.page.evaluate(LEAK_PROBE);
    if (pending && probe.ready) {
      samples++;
      if (probe.imgs || probe.wrappers || probe.broken || probe.uploading) { leaks++; console.log(`  leak: ${JSON.stringify(probe)}`); }
    }
    if (u1Src && !pending) { resolvedAt = Date.now(); break; }
    await sleep(250);
  }
  ok(samples >= 8, `sampled user2 throughout the pending window (${samples} samples)`);
  ok(leaks === 0, `user2 saw NOTHING while user1's upload was pending (${leaks} leaks)`);
  ok(resolvedAt !== null, "user1's preview swapped to the uploaded URL after the delay");
  ok(resolvedAt && resolvedAt - t0 >= DELAY_MS * 0.8, `upload stayed pending ~the delay (${resolvedAt ? resolvedAt - t0 : "n/a"}ms)`);

  // user2 now sees the real image
  const u2Resolved = await (async () => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const srcs = await u2.page.$$eval(`${EDITOR} img`, (els) => els.map((e) => e.src)).catch(() => []);
      const r = srcs.filter((s) => /^https?:\/\//.test(s) && /\/api\/uploads\//.test(s));
      if (r.length >= 1) return r;
      await sleep(250);
    }
    return [];
  })();
  ok(u2Resolved.length >= 1, `user2 sees the real image after completion (${u2Resolved[0] ? u2Resolved[0].slice(0, 50) : "none"})`);

  await sleep(1000);
  ok(posts.user1 === 1, `user1 uploaded exactly once (${posts.user1})`);
  ok(posts.user2 === 0, `user2 never uploaded (${posts.user2})`);

  await u1.page.screenshot({ path: path.join(ART_DIR, "A-user1-done.png") });
  await u2.page.screenshot({ path: path.join(ART_DIR, "A-user2-done.png") });

  // ===== D: reload mid-upload leaves no broken/visible state =====
  console.log("\nScenario D — reload user1 mid-upload:");
  await u1.page.click(EDITOR);
  await u1.page.keyboard.press("End");
  await u1.page.keyboard.press("Enter");
  await pasteImage(u1.page, makePng(260, 160, [40, 140, 220]).toString("base64"));
  await u1.page.waitForSelector(`${EDITOR} img`, { timeout: 10000 }); // user1 preview up
  await sleep(1500); // upload POST is in-flight (delayed); node has synced to user2
  console.log("  reloading user1 while upload pending…");
  await u1.page.reload({ waitUntil: "domcontentloaded" });
  await u1.page.waitForSelector(EDITOR, { timeout: 30000 });
  await sleep(3000); // re-sync

  const u1After = await u1.page.evaluate(LEAK_PROBE);
  const u2After = await u2.page.evaluate(LEAK_PROBE);
  // The first (red) image from scenario A should still be present & fine on both;
  // the second (blue) pending upload must NOT have produced a broken placeholder.
  ok(u1After.broken === 0, `user1: no broken-image placeholder after reload (broken=${u1After.broken})`);
  ok(u2After.broken === 0, `user2: no broken-image placeholder for the interrupted upload (broken=${u2After.broken})`);
  // Only the 1 completed image should remain visible (no phantom extra img).
  ok(u2After.imgs <= 1, `user2: no stray/phantom image from the interrupted upload (imgs=${u2After.imgs})`);
  // The interrupted upload's pending node must not linger as an empty block on
  // either side (UploadCleanupPlugin drops own-pending nodes on unload). Only the
  // one completed image's wrapper should remain.
  ok(u1After.wrappers <= 1, `user1: interrupted upload's pending node did not linger (wrappers=${u1After.wrappers})`);
  ok(u2After.wrappers <= 1, `user2: interrupted upload's pending node did not linger (wrappers=${u2After.wrappers})`);
  console.log(`  user1 after reload: ${JSON.stringify(u1After)}`);
  console.log(`  user2 after reload: ${JSON.stringify(u2After)}`);
  await u2.page.screenshot({ path: path.join(ART_DIR, "D-user2-after-reload.png") });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(2); });
