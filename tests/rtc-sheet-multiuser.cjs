// Multi-user SHEET (ds-data-grid) RTC test (protocol-level; no browser).
//
// Exercises the collaborative SHEET path end-to-end against the real rtc-server:
//   concurrent per-cell edits converge · added rows converge · a fresh reload
//   sees the persisted grid (server replay) · the internal versions/sessions APIs
//   reconstruct the grid and report changedCells (sheet history).
//
// Mirrors the Yjs sheet model the editor uses (see VersionsService.extractSheet):
//   getArray('rows') → one Y.Map per row ('__id' + one key per column id)
//   getMap('colTypes') → column id → cell type
//
// Prereqs (both running): backend :4000 (JWKS), rtc-server :4001 (WS) + :4002 (internal).
// Run:  node tests/rtc-sheet-multiuser.cjs
const path = require("path");
const fs = require("fs");

const reqRtc = (p) =>
  require(require.resolve(p, {
    paths: [path.join(__dirname, "..", "rtc-server", "node_modules")],
  }));
const reqBackend = (p) =>
  require(require.resolve(p, {
    paths: [path.join(__dirname, "..", "backend", "node_modules")],
  }));

const Y = reqRtc("yjs");
const { WebsocketProvider } = reqRtc("y-websocket");
const WS = reqRtc("ws");
const jose = reqBackend("jose");

const WS_BASE = "ws://localhost:4001/yjs";
const INTERNAL = "http://localhost:4002";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "dev-internal-secret-change-me";
const DOC_ID = "test-sheet-" + Date.now();

let pass = 0;
let total = 0;
const t = async (n, f) => {
  total++;
  try {
    await f();
    pass++;
    console.log("  PASS " + n);
  } catch (e) {
    console.log("  FAIL " + n + "\n        " + (e && e.message ? e.message : e));
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signToken({ sub, docId, role }) {
  const pem = fs.readFileSync(path.join(__dirname, "..", ".keys", "rtc-private.pem"), "utf8");
  const key = await jose.importPKCS8(pem, "RS256");
  return new jose.SignJWT({ docId, role, name: sub, email: `${sub}@toddle.test`, color: "#f04c54" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "rtc-key-1" })
    .setSubject(sub)
    .setAudience("rtc-server")
    .setIssuer("toddlecompose-backend")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

function connect(token) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(WS_BASE, DOC_ID, doc, {
    params: { token },
    WebSocketPolyfill: WS,
    connect: true,
    disableBc: true, // force every frame through the server (no peer-to-peer BroadcastChannel)
  });
  return { doc, provider, rows: doc.getArray("rows"), colTypes: doc.getMap("colTypes") };
}
const waitSynced = (provider) =>
  new Promise((res) => {
    if (provider.synced) return res();
    provider.once("sync", res);
    setTimeout(res, 4000);
  });

const rowMap = (rows, rowId) => rows.toArray().find((m) => m.get("__id") === rowId);
const cellOf = (rows, rowId, colId) => {
  const m = rowMap(rows, rowId);
  return m ? m.get(colId) : undefined;
};

(async () => {
  console.log("=== rtc SHEET multi-user: collab · persistence · changedCells ===");
  const editorA = await signToken({ sub: "alice", docId: DOC_ID, role: "editor" });
  const editorB = await signToken({ sub: "bob", docId: DOC_ID, role: "editor" });
  let a, b;

  await t("editor A seeds the grid (cols + one row)", async () => {
    a = connect(editorA);
    await waitSynced(a.provider);
    a.doc.transact(() => {
      a.colTypes.set("name", "text");
      a.colTypes.set("qty", "number");
      const row = new Y.Map();
      row.set("__id", "r1");
      row.set("name", "Widget");
      row.set("qty", 10);
      a.rows.push([row]);
    });
    await sleep(800);
    assert(cellOf(a.rows, "r1", "name") === "Widget", "A seeded r1.name");
  });

  await t("editor B converges on the seeded grid", async () => {
    b = connect(editorB);
    await waitSynced(b.provider);
    await sleep(1000);
    assert(b.rows.length === 1, `B sees ${b.rows.length} rows`);
    assert(cellOf(b.rows, "r1", "qty") === 10, `B sees r1.qty=${cellOf(b.rows, "r1", "qty")}`);
  });

  await t("concurrent edits to different cells of the same row converge", async () => {
    // A edits 'name' while B edits 'qty' on r1 at ~the same time → per-key merge.
    rowMap(a.rows, "r1").set("name", "Gadget");
    rowMap(b.rows, "r1").set("qty", 42);
    await sleep(1500);
    for (const [who, s] of [["A", a], ["B", b]]) {
      assert(cellOf(s.rows, "r1", "name") === "Gadget", `${who} r1.name=${cellOf(s.rows, "r1", "name")}`);
      assert(cellOf(s.rows, "r1", "qty") === 42, `${who} r1.qty=${cellOf(s.rows, "r1", "qty")}`);
    }
  });

  await t("B appends a second row; A converges", async () => {
    b.doc.transact(() => {
      const row = new Y.Map();
      row.set("__id", "r2");
      row.set("name", "Sprocket");
      row.set("qty", 7);
      b.rows.push([row]);
    });
    await sleep(1500);
    assert(a.rows.length === 2, `A sees ${a.rows.length} rows`);
    assert(cellOf(a.rows, "r2", "name") === "Sprocket", `A r2.name=${cellOf(a.rows, "r2", "name")}`);
  });

  await t("a fresh client reload sees the persisted grid (server replay)", async () => {
    a.provider.destroy();
    b.provider.destroy();
    await sleep(2500); // let the debounced writer flush to the rtc DB
    const fresh = connect(await signToken({ sub: "carol", docId: DOC_ID, role: "editor" }));
    await waitSynced(fresh.provider);
    await sleep(1200);
    assert(fresh.rows.length === 2, `reload sees ${fresh.rows.length} rows`);
    assert(cellOf(fresh.rows, "r1", "name") === "Gadget", "reload: r1.name persisted");
    assert(cellOf(fresh.rows, "r1", "qty") === 42, "reload: r1.qty persisted");
    assert(cellOf(fresh.rows, "r2", "name") === "Sprocket", "reload: r2.name persisted");
    fresh.provider.destroy();
    await sleep(500);
  });

  await t("internal preview reconstructs the SHEET grid at head (preview.sheet)", async () => {
    const head = await fetch(`${INTERNAL}/internal/docs/${DOC_ID}/versions`, {
      headers: { "X-Internal-Token": INTERNAL_TOKEN },
    }).then((r) => r.json());
    assert(head.head >= 1, `head=${head.head}`);
    const preview = await fetch(`${INTERNAL}/internal/docs/${DOC_ID}/versions/${head.head}`, {
      headers: { "X-Internal-Token": INTERNAL_TOKEN },
    }).then((r) => r.json());
    assert(preview.sheet, "preview.sheet is null (grid not reconstructed)");
    assert(preview.sheet.rows.length === 2, `preview rows=${preview.sheet.rows.length}`);
    const r1 = preview.sheet.rows.find((r) => r.rowId === "r1");
    assert(r1 && r1.values.name === "Gadget", "preview r1.name=Gadget");
    assert(preview.sheet.colTypes.qty === "number", "preview colTypes.qty=number");
  });

  await t("internal sessions: SHEET sessions are non-noop and report changedCells", async () => {
    const res = await fetch(`${INTERNAL}/internal/docs/${DOC_ID}/sessions`, {
      headers: { "X-Internal-Token": INTERNAL_TOKEN },
    });
    assert(res.ok, `sessions HTTP ${res.status}`);
    const body = await res.json();
    // On the pre-fix code a SHEET's lexical text was empty → every session looked
    // like a no-op and got filtered out; the fix makes the boundary text the grid.
    assert(Array.isArray(body.sessions) && body.sessions.length >= 1, `expected >=1 session, got ${body.sessions && body.sessions.length}`);
    const cells = body.sessions.flatMap((s) => s.changedCells || []);
    const has = (rowId, colId) => cells.some((c) => c.rowId === rowId && c.colId === colId);
    assert(cells.length > 0, "no changedCells reported for a SHEET");
    assert(has("r1", "name") || has("r1", "qty"), "expected an r1 cell change");
    assert(has("r2", "name"), "expected r2.name change (appended row)");
  });

  console.log(`\n=== ${pass}/${total} passed ===`);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error("uncaught:", e);
  process.exit(1);
});
