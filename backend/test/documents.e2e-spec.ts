import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  addRealmMember,
  addWorkspaceMember,
  auth,
  bootApp,
  createWorkspace,
  enterWorkspace,
  http,
  login,
} from "./helpers";

/**
 * Documents (e2e) — workspace-scoped CRUD, PRIVATE-by-default, the public toggle,
 * the full read/write authorization matrix, and the RTC token endpoint
 * (editor/viewer/denied resolution). Boots the real AppModule against DATABASE_URL.
 *
 * Cast of users:
 *   owner  — realm OWNER (workspace ADMIN via overlay)
 *   alice  — workspace EDIT member
 *   carol  — workspace READ member
 *   dave   — realm MEMBER, NOT in the workspace (for the PUBLIC cross-workspace case)
 *   bob    — neither realm nor workspace member
 */
describe("Documents (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const wsName = `e2e-docs-${stamp}`;
  let wsId = "";
  let ownerWs = "";
  let aliceWs = "";
  let carolWs = "";
  let daveTok = "";
  let bobTok = "";
  let docId = "";
  let subdocId = "";
  let folderId = "";

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);

    const ownerTok = await login(app, "owner@toddle.test");
    wsId = await createWorkspace(app, ownerTok, wsName);
    await addWorkspaceMember(app, ownerTok, wsId, "alice@toddle.test", "EDIT").expect(201);
    await addWorkspaceMember(app, ownerTok, wsId, "carol@toddle.test", "READ").expect(201);
    // Realm membership persists across runs — tolerate "already a member" (409).
    await addRealmMember(app, ownerTok, "dave@toddle.test", "MEMBER").then(
      (r) => expect([201, 409]).toContain(r.status)
    );

    ownerWs = await enterWorkspace(app, ownerTok, wsId);
    aliceWs = await enterWorkspace(app, await login(app, "alice@toddle.test"), wsId);
    carolWs = await enterWorkspace(app, await login(app, "carol@toddle.test"), wsId);
    daveTok = await login(app, "dave@toddle.test"); // identity token (dave can't enter)
    bobTok = await login(app, "bob@toddle.test");

    const f = await http(app)
      .post("/api/folders")
      .set(auth(ownerWs))
      .send({ name: "Docs folder" })
      .expect(201);
    folderId = f.body.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: wsId } });
    await app.close();
  });

  // ---- create ----

  it("creates a document, PRIVATE by default, in the active workspace", async () => {
    const res = await http(app)
      .post("/api/documents")
      .set(auth(ownerWs))
      .send({ title: "Design Notes", folderId })
      .expect(201);
    expect(res.body.visibility).toBe("PRIVATE");
    expect(res.body.workspaceId).toBe(wsId);
    docId = res.body.id;
  });

  it("rejects creating in a folder of another workspace", async () => {
    await http(app)
      .post("/api/documents")
      .set(auth(ownerWs))
      .send({ title: "x", folderId: "does-not-exist" })
      .expect(404);
  });

  it("lists documents in the active workspace and filters by folder", async () => {
    const all = await http(app).get("/api/documents").set(auth(ownerWs)).expect(200);
    expect(all.body.map((d: { id: string }) => d.id)).toContain(docId);

    const inFolder = await http(app)
      .get(`/api/documents?folderId=${folderId}`)
      .set(auth(ownerWs))
      .expect(200);
    expect(inFolder.body.every((d: { folderId: string }) => d.folderId === folderId)).toBe(true);
  });

  it("a non-member cannot list the workspace's documents → 403", async () => {
    await http(app)
      .get(`/api/documents?workspaceId=${wsId}`)
      .set(auth(bobTok))
      .expect(403);
  });

  // ---- read matrix (PRIVATE) ----

  it("owner can read its private doc", async () => {
    await http(app).get(`/api/documents/${docId}`).set(auth(ownerWs)).expect(200);
  });

  it("a workspace member (READ) can read it", async () => {
    await http(app).get(`/api/documents/${docId}`).set(auth(carolWs)).expect(200);
  });

  it("a realm member NOT in the workspace cannot read a PRIVATE doc → 404", async () => {
    await http(app).get(`/api/documents/${docId}`).set(auth(daveTok)).expect(404);
  });

  it("a complete outsider cannot read it → 404", async () => {
    await http(app).get(`/api/documents/${docId}`).set(auth(bobTok)).expect(404);
  });

  // ---- write matrix ----

  it("a READ member cannot rename → 403", async () => {
    await http(app)
      .patch(`/api/documents/${docId}`)
      .set(auth(carolWs))
      .send({ title: "hijack" })
      .expect(403);
  });

  it("an EDIT member can rename", async () => {
    await http(app)
      .patch(`/api/documents/${docId}`)
      .set(auth(aliceWs))
      .send({ title: "Design Notes v2" })
      .expect(200);
  });

  it("owner can move it to root and back into the folder", async () => {
    await http(app)
      .patch(`/api/documents/${docId}/move`)
      .set(auth(ownerWs))
      .send({ folderId: null })
      .expect(200);
    await http(app)
      .patch(`/api/documents/${docId}/move`)
      .set(auth(ownerWs))
      .send({ folderId })
      .expect(200);
  });

  // ---- nesting (subdocs) ----

  it("creates a subdoc nested under the document (parentId set, folderId cleared)", async () => {
    const res = await http(app)
      .post("/api/documents")
      .set(auth(ownerWs))
      .send({ title: "Appendix", parentId: docId, folderId })
      .expect(201);
    // parentId wins over folderId: a subdoc is located by its parent, not a folder.
    expect(res.body.parentId).toBe(docId);
    expect(res.body.folderId).toBeNull();
    subdocId = res.body.id;
  });

  it("rejects nesting under a parent in another workspace → 404", async () => {
    await http(app)
      .post("/api/documents")
      .set(auth(ownerWs))
      .send({ title: "x", parentId: "does-not-exist" })
      .expect(404);
  });

  it("GET /:id returns breadcrumbs root → current (current last)", async () => {
    const parent = await http(app)
      .get(`/api/documents/${docId}`)
      .set(auth(ownerWs))
      .expect(200);
    expect(parent.body.breadcrumbs.map((c: { id: string }) => c.id)).toEqual([docId]);

    const child = await http(app)
      .get(`/api/documents/${subdocId}`)
      .set(auth(ownerWs))
      .expect(200);
    expect(child.body.breadcrumbs.map((c: { id: string }) => c.id)).toEqual([
      docId,
      subdocId,
    ]);
    expect(child.body.breadcrumbs[0]).toMatchObject({ id: docId });
  });

  it("GET /:id/subdocs lists the document's direct children", async () => {
    const res = await http(app)
      .get(`/api/documents/${docId}/subdocs`)
      .set(auth(carolWs)) // a READ member can list subdocs of a doc they can read
      .expect(200);
    expect(res.body.map((d: { id: string }) => d.id)).toContain(subdocId);
    expect(res.body.every((d: { parentId: string }) => d.parentId === docId)).toBe(true);
  });

  it("a non-member cannot list a doc's subdocs → 404", async () => {
    await http(app)
      .get(`/api/documents/${docId}/subdocs`)
      .set(auth(bobTok))
      .expect(404);
  });

  it("?parentId=null lists only top-level docs (excludes the subdoc)", async () => {
    const res = await http(app)
      .get("/api/documents?parentId=null")
      .set(auth(ownerWs))
      .expect(200);
    const ids = res.body.map((d: { id: string }) => d.id);
    expect(ids).toContain(docId);
    expect(ids).not.toContain(subdocId);
  });

  it("?parentId=<id> lists that document's subdocs", async () => {
    const res = await http(app)
      .get(`/api/documents?parentId=${docId}`)
      .set(auth(ownerWs))
      .expect(200);
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([subdocId]);
  });

  it("rejects self-parenting and cycles (parent into its own subtree) → 400", async () => {
    await http(app)
      .patch(`/api/documents/${docId}/move`)
      .set(auth(ownerWs))
      .send({ parentId: docId })
      .expect(400);
    await http(app)
      .patch(`/api/documents/${docId}/move`)
      .set(auth(ownerWs))
      .send({ parentId: subdocId })
      .expect(400);
  });

  it("re-parenting a doc clears its folderId; detaching to root clears parentId", async () => {
    // Detach the subdoc to the workspace root.
    const detached = await http(app)
      .patch(`/api/documents/${subdocId}/move`)
      .set(auth(ownerWs))
      .send({ parentId: null })
      .expect(200);
    expect(detached.body.parentId).toBeNull();

    // Re-nest it under the parent again (and confirm folderId is cleared).
    const renested = await http(app)
      .patch(`/api/documents/${subdocId}/move`)
      .set(auth(ownerWs))
      .send({ parentId: docId })
      .expect(200);
    expect(renested.body.parentId).toBe(docId);
    expect(renested.body.folderId).toBeNull();
  });

  it("GET /:id/hierarchy returns the root ancestor expanded down the spine", async () => {
    // Build docId → subdocId → grandchild, plus an off-path sibling of subdocId.
    const grandchild = await http(app)
      .post("/api/documents")
      .set(auth(ownerWs))
      .send({ title: "Grandchild", parentId: subdocId })
      .expect(201);
    const sibling = await http(app)
      .post("/api/documents")
      .set(auth(ownerWs))
      .send({ title: "Sibling", parentId: docId })
      .expect(201);

    const res = await http(app)
      .get(`/api/documents/${grandchild.body.id}/hierarchy`)
      .set(auth(ownerWs))
      .expect(200);

    // Root is the topmost ancestor (docId), with both children present.
    expect(res.body.id).toBe(docId);
    expect(res.body.parentId).toBeNull();
    const rootChildIds = res.body.children.map((c: { id: string }) => c.id);
    expect(rootChildIds).toEqual(expect.arrayContaining([subdocId, sibling.body.id]));

    // Off-path sibling is collapsed; on-path child is expanded.
    const sib = res.body.children.find((c: { id: string }) => c.id === sibling.body.id);
    expect(sib.children).toBeNull();
    const onPath = res.body.children.find((c: { id: string }) => c.id === subdocId);
    expect(Array.isArray(onPath.children)).toBe(true);

    // The spine continues down to the (expanded) target document.
    const target = onPath.children.find((c: { id: string }) => c.id === grandchild.body.id);
    expect(target).toBeDefined();
    expect(Array.isArray(target.children)).toBe(true);

    // cleanup the extra nodes so they don't perturb later counts
    await http(app).delete(`/api/documents/${grandchild.body.id}`).set(auth(ownerWs)).expect(200);
    await http(app).delete(`/api/documents/${sibling.body.id}`).set(auth(ownerWs)).expect(200);
  });

  it("deleting a parent cascade-deletes its subdoc subtree", async () => {
    const parent = await http(app)
      .post("/api/documents")
      .set(auth(ownerWs))
      .send({ title: "Parent" })
      .expect(201);
    const child = await http(app)
      .post("/api/documents")
      .set(auth(ownerWs))
      .send({ title: "Child", parentId: parent.body.id })
      .expect(201);

    const del = await http(app)
      .delete(`/api/documents/${parent.body.id}`)
      .set(auth(ownerWs))
      .expect(200);
    expect(del.body.deleted).toBe(2); // parent + child

    await http(app).get(`/api/documents/${child.body.id}`).set(auth(ownerWs)).expect(404);
  });

  // ---- public toggle ----

  it("owner makes it PUBLIC → a realm member outside the workspace can now read it", async () => {
    await http(app).get(`/api/documents/${docId}`).set(auth(daveTok)).expect(404);
    await http(app)
      .patch(`/api/documents/${docId}/visibility`)
      .set(auth(ownerWs))
      .send({ visibility: "PUBLIC" })
      .expect(200);
    await http(app).get(`/api/documents/${docId}`).set(auth(daveTok)).expect(200);
  });

  // ---- RTC token endpoint ----

  it("rtc-token: owner → editor", async () => {
    const res = await http(app)
      .post(`/api/documents/${docId}/rtc-token`)
      .set(auth(ownerWs))
      .expect(201);
    expect(res.body.role).toBe("editor");
    expect(res.body.docId).toBe(docId);
    const claims = decode(res.body.token);
    expect(claims.role).toBe("editor");
    expect(claims.docId).toBe(docId);
    // identity claims for presence/cursors are present
    expect(claims.email).toBe("owner@toddle.test");
    expect(typeof claims.name).toBe("string");
    expect(typeof claims.color).toBe("string");
  });

  it("rtc-token: EDIT member → editor", async () => {
    const res = await http(app)
      .post(`/api/documents/${docId}/rtc-token`)
      .set(auth(aliceWs))
      .expect(201);
    expect(res.body.role).toBe("editor");
  });

  it("rtc-token: READ member → viewer", async () => {
    const res = await http(app)
      .post(`/api/documents/${docId}/rtc-token`)
      .set(auth(carolWs))
      .expect(201);
    expect(res.body.role).toBe("viewer");
  });

  it("rtc-token: realm member on a PUBLIC doc → viewer", async () => {
    const res = await http(app)
      .post(`/api/documents/${docId}/rtc-token`)
      .set(auth(daveTok))
      .expect(201);
    expect(res.body.role).toBe("viewer");
  });

  it("rtc-token: total outsider → 403 (no token minted)", async () => {
    // flip back to PRIVATE so bob truly has no path in
    await http(app)
      .patch(`/api/documents/${docId}/visibility`)
      .set(auth(ownerWs))
      .send({ visibility: "PRIVATE" })
      .expect(200);
    await http(app)
      .post(`/api/documents/${docId}/rtc-token`)
      .set(auth(bobTok))
      .expect(403);
  });

  // ---- delete ----

  it("a READ member cannot delete; owner can", async () => {
    await http(app).delete(`/api/documents/${docId}`).set(auth(carolWs)).expect(403);
    await http(app).delete(`/api/documents/${docId}`).set(auth(ownerWs)).expect(200);
    await http(app).get(`/api/documents/${docId}`).set(auth(ownerWs)).expect(404);
  });
});

function decode(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
}
