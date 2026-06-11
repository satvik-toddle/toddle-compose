// RTC history test: version log, point-in-time preview (reconstruct doc at a past
// seq), and editing sessions — and that all of it survives a server restart
// (served purely from the rtc database).
//
//   node tests/rtc-history.cjs write  <docId>   # make 3 distinct edits, flush
//   node tests/rtc-history.cjs check  <docId>   # assert history via the internal API
// The runner restarts the rtc-server between a live `check` and a post-restart `check`.
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

const [, , mode, docId] = process.argv;
const INTERNAL = "http://localhost:4002";
const TOK = process.env.INTERNAL_TOKEN || "dev-internal-secret-change-me";
const FINAL = "AAABBBCCC";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.log("  FAIL " + m); process.exit(1); } };

async function rtcToken() {
  const pem = fs.readFileSync(path.join(__dirname, "..", ".keys", "rtc-private.pem"), "utf8");
  const key = await jose.importPKCS8(pem, "RS256");
  return new jose.SignJWT({ docId, role: "editor", name: "hist", email: "h@t.test", color: "#fff" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "rtc-key-1" })
    .setSubject("hist").setAudience("rtc-server").setIssuer("toddlecompose-backend")
    .setIssuedAt().setExpirationTime("1h").sign(key);
}
const api = async (p) => {
  const r = await fetch(`${INTERNAL}${p}`, { headers: { "X-Internal-Token": TOK } });
  assert(r.ok, `${p} → HTTP ${r.status}`);
  return r.json();
};

(async () => {
  if (mode === "write") {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider("ws://localhost:4001/yjs", docId, doc, {
      params: { token: await rtcToken() }, WebSocketPolyfill: WS, connect: true, disableBc: true,
    });
    await new Promise((res) => { provider.once("sync", res); setTimeout(res, 4000); });
    const t = doc.getText("content");
    for (const part of ["AAA", "BBB", "CCC"]) { t.insert(t.length, part); await sleep(700); }
    await sleep(2500); // flush
    provider.destroy();
    console.log(`wrote "${FINAL}" in 3 edits`);
    process.exit(0);
  }

  // mode === "check": version log + preview + sessions, all from the DB
  const versions = await api(`/internal/docs/${docId}/versions`);
  assert(versions.head >= 1, `expected head>=1, got ${versions.head}`);
  assert(versions.updates.length === versions.head, "updates count matches head");
  console.log(`  PASS version log: head=${versions.head}, ${versions.updates.length} updates`);

  const atHead = await api(`/internal/docs/${docId}/versions/${versions.head}`);
  assert(atHead.rawTexts.content === FINAL, `preview@head expected "${FINAL}", got "${atHead.rawTexts.content}"`);
  console.log(`  PASS preview@head reconstructs "${atHead.rawTexts.content}"`);

  const atZero = await api(`/internal/docs/${docId}/versions/0`);
  assert(!atZero.rawTexts.content, `preview@0 should be empty, got "${atZero.rawTexts.content ?? ""}"`);
  console.log(`  PASS preview@0 is empty (start of history)`);

  if (versions.head >= 2) {
    const mid = await api(`/internal/docs/${docId}/versions/1`);
    const midText = mid.rawTexts.content ?? "";
    assert(midText.length > 0 && midText.length < FINAL.length && FINAL.startsWith(midText),
      `preview@1 should be an earlier prefix, got "${midText}"`);
    console.log(`  PASS preview@1 is an earlier state: "${midText}"`);
  }

  // includeNoop=true: session "noop" detection compares Lexical plainText (which we're
  // ignoring for now), so without it raw-text edits all look like noops and filter out.
  const sessions = await api(`/internal/docs/${docId}/sessions?includeNoop=true`);
  assert(sessions.sessions.length >= 1, `expected >=1 session, got ${sessions.sessions.length}`);
  console.log(`  PASS sessions: ${sessions.sessions.length} session(s)`);

  process.exit(0);
})().catch((e) => { console.error("uncaught:", e); process.exit(1); });
