// Multi-user RTC integration test (protocol-level; no browser).
//
// Mirrors the POC's tests/multiuser.cjs intent against the real rtc-server:
//   editor↔editor convergence · viewer write-drop · denied reject · persistence
//   to the SEPARATE rtc database (asserted via the internal versions API).
//
// Prereqs (both running):
//   - backend  :4000  (serves the JWKS the rtc-server verifies tokens against)
//   - rtc-server :4001 (WS) + :4002 (internal HTTP)
// Run:  node tests/rtc-multiuser.cjs
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
const DOC_ID = "test-multiuser-" + Date.now();

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
    // All clients share one Node process; without this they'd sync peer-to-peer via
    // BroadcastChannel and bypass the server (hiding the viewer write-drop). Force
    // every frame through the rtc-server so server-side authorization is observable.
    disableBc: true,
  });
  return { doc, provider, text: doc.getText("content") };
}
const waitSynced = (provider) =>
  new Promise((res) => {
    if (provider.synced) return res();
    provider.once("sync", res);
    setTimeout(res, 4000);
  });

(async () => {
  console.log("=== rtc multi-user collaboration + persistence ===");
  const editorA = await signToken({ sub: "alice", docId: DOC_ID, role: "editor" });
  const editorB = await signToken({ sub: "bob", docId: DOC_ID, role: "editor" });
  const viewerC = await signToken({ sub: "carol", docId: DOC_ID, role: "viewer" });

  let a, b, c;

  await t("editor A connects and writes (lazy-creates the doc)", async () => {
    a = connect(editorA);
    await waitSynced(a.provider);
    a.text.insert(0, "Hello from Alice");
    await sleep(800);
    assert(a.text.toString() === "Hello from Alice", "A local text set");
  });

  await t("editor B converges on A's content", async () => {
    b = connect(editorB);
    await waitSynced(b.provider);
    await sleep(1000);
    assert(b.text.toString().includes("Hello from Alice"), `B sees: "${b.text.toString()}"`);
  });

  await t("B edits; A converges (bidirectional)", async () => {
    b.text.insert(b.text.length, " and Bob");
    await sleep(1200);
    assert(a.text.toString().includes("and Bob"), `A: "${a.text.toString()}"`);
    assert(a.text.toString() === b.text.toString(), "converged");
  });

  await t("viewer C reads but its writes are DROPPED", async () => {
    c = connect(viewerC);
    await waitSynced(c.provider);
    await sleep(800);
    assert(c.text.toString().includes("Hello from Alice"), "C reads current state");
    const before = a.text.toString();
    c.text.insert(0, "VIEWER-HACK ");
    await sleep(1200);
    assert(!a.text.toString().includes("VIEWER-HACK"), `viewer write leaked to editor A: "${a.text.toString()}"`);
    assert(!b.text.toString().includes("VIEWER-HACK"), `viewer write leaked to editor B: "${b.text.toString()}"`);
    assert(a.text.toString() === before, "editors unchanged by viewer write");
  });

  await t("denied token never reaches connected state", async () => {
    const deniedTok = await signToken({ sub: "mallory", docId: DOC_ID, role: "denied" });
    const d = connect(deniedTok);
    let connected = false;
    d.provider.on("status", (e) => {
      if (e.status === "connected") connected = true;
    });
    await sleep(1500);
    assert(!connected, "denied must not connect");
    d.provider.destroy();
  });

  await t("edits persisted to the SEPARATE rtc DB (internal versions API)", async () => {
    await sleep(2500); // let the debounced writer flush
    const res = await fetch(`${INTERNAL}/internal/docs/${DOC_ID}/versions`, {
      headers: { "X-Internal-Token": INTERNAL_TOKEN },
    });
    assert(res.ok, `internal versions HTTP ${res.status}`);
    const body = await res.json();
    assert(body.head >= 1, `expected >=1 persisted update, head=${body.head}`);
  });

  a.provider.destroy();
  b.provider.destroy();
  c.provider.destroy();
  console.log(`\n=== ${pass}/${total} passed ===`);
  process.exit(pass === total ? 0 : 1);
})().catch((e) => {
  console.error("uncaught:", e);
  process.exit(1);
});
