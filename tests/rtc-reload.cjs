// RTC cold-reload test: proves persisted state rebuilds correctly from the DB.
//   mode=write : connect, type text, wait for the debounced flush, disconnect.
//   mode=read  : connect fresh and assert the server served the persisted content.
// Between the two, the rtc-server is RESTARTED (by the runner) so the in-memory doc
// is gone and the state can only come from the rtc database (yjsState + update log).
//
// Usage: node tests/rtc-reload.cjs <write|read> <docId> "<expected text>"
const path = require("path");
const fs = require("fs");
const reqRtc = (p) =>
  require(require.resolve(p, { paths: [path.join(__dirname, "..", "rtc-server", "node_modules")] }));
const reqBackend = (p) =>
  require(require.resolve(p, { paths: [path.join(__dirname, "..", "backend", "node_modules")] }));

const Y = reqRtc("yjs");
const { WebsocketProvider } = reqRtc("y-websocket");
const WS = reqRtc("ws");
const jose = reqBackend("jose");

const [, , mode, docId, text] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token(sub, role) {
  const pem = fs.readFileSync(path.join(__dirname, "..", ".keys", "rtc-private.pem"), "utf8");
  const key = await jose.importPKCS8(pem, "RS256");
  return new jose.SignJWT({ docId, role, name: sub, email: `${sub}@toddle.test`, color: "#fff" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "rtc-key-1" })
    .setSubject(sub).setAudience("rtc-server").setIssuer("toddlecompose-backend")
    .setIssuedAt().setExpirationTime("1h").sign(key);
}

function connect(tok) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider("ws://localhost:4001/yjs", docId, doc, {
    params: { token: tok }, WebSocketPolyfill: WS, connect: true, disableBc: true,
  });
  return { doc, provider, text: doc.getText("content") };
}
const waitSynced = (p) =>
  new Promise((res) => { if (p.synced) return res(); p.once("sync", res); setTimeout(res, 4000); });

(async () => {
  const tok = await token("writer", "editor");
  const c = connect(tok);
  await waitSynced(c.provider);

  if (mode === "write") {
    c.text.delete(0, c.text.length);
    c.text.insert(0, text);
    await sleep(3000); // exceed RTC_DEBOUNCE_IDLE_MS so the writer flushes to the DB
    c.provider.destroy();
    console.log(`wrote "${text}" to ${docId}`);
    process.exit(0);
  }

  // mode === "read": server was restarted; this state can only come from the DB
  await sleep(800);
  const got = c.text.toString();
  c.provider.destroy();
  if (got === text) {
    console.log(`PASS reload: server rebuilt "${got}" from the DB`);
    process.exit(0);
  }
  console.log(`FAIL reload: expected "${text}", got "${got}"`);
  process.exit(1);
})().catch((e) => { console.error("uncaught:", e); process.exit(1); });
