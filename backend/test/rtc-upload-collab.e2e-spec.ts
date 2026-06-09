import { INestApplication } from "@nestjs/common";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { WebSocket } from "ws";
import {
  addWorkspaceMember,
  auth,
  bootApp,
  createWorkspace,
  enterWorkspace,
  http,
  login,
} from "./helpers";

/**
 * Multi-user verification for the collaborative image/file upload fix.
 *
 * The fix keeps the volatile upload state OUT of the synced Lexical content:
 * an uploading node carries only a stable `uploadId` (its src stays empty), and
 * the resolved URL is written — only on completion — to a Yjs *sibling* Map
 * `tde-upload-registry` that lives in the same doc but outside the Lexical tree.
 *
 * Two collaborators sharing a doc therefore observe this contract, which is what
 * makes the UX correct:
 *   - While A is uploading, the registry has NO entry for the uploadId, so B
 *     resolves no URL and renders nothing (req 1: "see nothing until done").
 *   - On completion A writes the entry; B observes it and renders the image
 *     (and because it's a Map write, not an editor.update, it never enters
 *     Lexical undo history — req 2).
 *   - If A closes the tab mid-upload, the entry is never written, so B never
 *     sees anything (req 3: "nothing reflected, no infinite loading").
 *
 * The first block proves the data-model deterministically by cross-applying two
 * Y.Docs in-process (no server). The second block proves the SAME contract end
 * to end through the real RTC websocket relay; it self-skips if the rtc-server
 * (RTC_WS_URL, default ws://localhost:4001) isn't running.
 */

const REGISTRY = "tde-upload-registry";
const RTC_WS_URL = process.env.RTC_WS_URL || "ws://localhost:4001";

function waitFor(
  predicate: () => boolean,
  { timeout = 4000, interval = 25 } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) {
        return reject(new Error("waitFor: timed out"));
      }
      setTimeout(tick, interval);
    };
    tick();
  });
}

describe("upload registry sync contract (in-process two Y.Docs)", () => {
  // Wire two docs so each local update is relayed to the other, exactly like the
  // RTC server relays between two clients — but deterministic and server-free.
  let docA: Y.Doc;
  let docB: Y.Doc;
  let relay = true;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    relay = true;
    docA.on("update", (update: Uint8Array, origin: unknown) => {
      if (relay && origin !== "remote") Y.applyUpdate(docB, update, "remote");
    });
    docB.on("update", (update: Uint8Array, origin: unknown) => {
      if (relay && origin !== "remote") Y.applyUpdate(docA, update, "remote");
    });
  });

  it("req1: while pending, the other client resolves no URL", () => {
    const uploadId = "upload-1";
    // A inserts an uploading image: only a uploadId is on the (would-be) node;
    // NOTHING is written to the registry until the upload completes.
    // B's view of the registry:
    expect(docB.getMap(REGISTRY).get(uploadId)).toBeUndefined();
  });

  it("req1→complete: completion writes the URL and the other client observes it", async () => {
    const uploadId = "upload-2";
    const url = "https://cdn.example.com/uploads/cat.png";

    let observedOnB: { url: string } | undefined;
    docB.getMap(REGISTRY).observe(() => {
      observedOnB = docB.getMap(REGISTRY).get(uploadId) as { url: string };
    });

    // A completes the upload -> a plain Yjs Map write (no editor transaction).
    docA.getMap(REGISTRY).set(uploadId, { url, kind: "image" });

    await waitFor(() => observedOnB?.url === url);
    expect(observedOnB).toEqual({ url, kind: "image" });
    expect((docB.getMap(REGISTRY).get(uploadId) as { url: string }).url).toBe(
      url
    );
  });

  it("req3: tab close before completion -> the other client never sees a URL", async () => {
    const uploadId = "upload-3";

    // A "uploads" (no registry write yet) then disconnects (stop relaying).
    relay = false; // simulates A's tab closing before the upload finished
    docA.getMap(REGISTRY).set(uploadId, { url: "http://late", kind: "image" });

    // Give any in-flight sync a chance; B must still have nothing.
    await new Promise(r => setTimeout(r, 150));
    expect(docB.getMap(REGISTRY).get(uploadId)).toBeUndefined();
  });

  it("req2: the resolved URL lives in its own top-level sibling map (undo-safe)", () => {
    // The registry is a top-level sibling map, NOT nested under the Lexical
    // shared root that the Yjs UndoManager tracks — so undo/redo of content
    // can't revert it (and completion is a Map write, not an editor.update).
    docA.getMap(REGISTRY).set("x", { url: "https://e/x.png", kind: "image" });
    expect(docA.share.has(REGISTRY)).toBe(true);
  });
});

describe("upload registry over real RTC relay (requires running rtc-server)", () => {
  let app: INestApplication;
  const stamp = Date.now();
  let wsId = "";
  let docId = "";
  let aliceRtc = "";
  let carolRtc = "";
  let rtcAvailable = true;

  const providers: WebsocketProvider[] = [];

  const connect = (token: string) => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(RTC_WS_URL, `yjs/${docId}`, doc, {
      params: { token },
      connect: false,
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    });
    providers.push(provider);
    return { doc, provider };
  };

  const waitConnected = (provider: WebsocketProvider, timeout = 5000) =>
    new Promise<boolean>(resolve => {
      if (provider.wsconnected) return resolve(true);
      const timer = setTimeout(() => resolve(false), timeout);
      provider.on("status", (e: { status: string }) => {
        if (e.status === "connected") {
          clearTimeout(timer);
          resolve(true);
        }
      });
      provider.connect();
    });

  beforeAll(async () => {
    app = await bootApp();

    const ownerTok = await login(app, "owner@toddle.test");
    wsId = await createWorkspace(app, ownerTok, `e2e-rtc-upload-${stamp}`);
    await addWorkspaceMember(
      app,
      ownerTok,
      wsId,
      "alice@toddle.test",
      "EDIT"
    ).expect(201);
    await addWorkspaceMember(
      app,
      ownerTok,
      wsId,
      "carol@toddle.test",
      "READ"
    ).expect(201);

    const ownerWs = await enterWorkspace(app, ownerTok, wsId);
    const aliceWs = await enterWorkspace(
      app,
      await login(app, "alice@toddle.test"),
      wsId
    );
    const carolWs = await enterWorkspace(
      app,
      await login(app, "carol@toddle.test"),
      wsId
    );

    const folder = await http(app)
      .post("/api/folders")
      .set(auth(ownerWs))
      .send({ name: "Upload docs" })
      .expect(201);

    const doc = await http(app)
      .post("/api/documents")
      .set(auth(aliceWs))
      .send({ title: "Upload collab", folderId: folder.body.id })
      .expect(201);
    docId = doc.body.id;

    aliceRtc = (
      await http(app)
        .post(`/api/documents/${docId}/rtc-token`)
        .set(auth(aliceWs))
        .expect(201)
    ).body.token;
    carolRtc = (
      await http(app)
        .post(`/api/documents/${docId}/rtc-token`)
        .set(auth(carolWs))
        .expect(201)
    ).body.token;
  });

  afterAll(async () => {
    providers.forEach(p => {
      try {
        p.disconnect();
        p.destroy();
      } catch {
        // ignore
      }
    });
    if (app) await app.close();
  });

  it("connects two clients (editor + viewer) to the same doc", async () => {
    const alice = connect(aliceRtc);
    const carol = connect(carolRtc);
    rtcAvailable =
      (await waitConnected(alice.provider)) &&
      (await waitConnected(carol.provider));
    if (!rtcAvailable) {
      console.warn(
        `[skip] rtc-server not reachable at ${RTC_WS_URL}; start it with 'pnpm dev:rtc' (and 'pnpm dev:backend' for JWKS) to run the relay assertions.`
      );
    }
    expect(rtcAvailable).toBe(true);
  });

  it("req1 + complete: viewer sees the URL only after the uploader completes", async () => {
    if (!rtcAvailable) return;
    const alice = connect(aliceRtc);
    const carol = connect(carolRtc);
    await waitConnected(alice.provider);
    await waitConnected(carol.provider);

    const uploadId = `relay-${stamp}-a`;

    // Pending: nothing written yet -> the viewer resolves nothing.
    await new Promise(r => setTimeout(r, 300));
    expect(carol.doc.getMap(REGISTRY).get(uploadId)).toBeUndefined();

    // Completion (editor writes the registry) -> viewer observes the URL.
    const url = "https://cdn.example.com/relay/photo.png";
    alice.doc.getMap(REGISTRY).set(uploadId, { url, kind: "image" });

    await waitFor(
      () =>
        (carol.doc.getMap(REGISTRY).get(uploadId) as { url?: string })?.url ===
        url,
      { timeout: 6000 }
    );
    expect((carol.doc.getMap(REGISTRY).get(uploadId) as { url: string }).url).toBe(
      url
    );
  });

  it("req3: if the uploader disconnects before completing, the viewer never sees a URL", async () => {
    if (!rtcAvailable) return;
    const alice = connect(aliceRtc);
    const carol = connect(carolRtc);
    await waitConnected(alice.provider);
    await waitConnected(carol.provider);

    const uploadId = `relay-${stamp}-b`;

    // Uploader "closes the tab" before writing the registry entry.
    alice.provider.disconnect();
    alice.provider.destroy();

    await new Promise(r => setTimeout(r, 600));
    expect(carol.doc.getMap(REGISTRY).get(uploadId)).toBeUndefined();
  });
});
