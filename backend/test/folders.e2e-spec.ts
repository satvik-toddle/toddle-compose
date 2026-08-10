import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { FoldersService } from "../src/folders/folders.service";
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
 * Folders (e2e) — workspace-scoped CRUD, read/write authorization, soft delete +
 * subtree cascade + 30-day purge. Boots the real AppModule against DATABASE_URL.
 * Uses the seeded realm owner + demo users; creates a throwaway workspace per run.
 */
describe("Folders (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const wsName = `e2e-folders-${stamp}`;
  let wsId = "";
  let ownerWs = ""; // owner, workspace-scoped (ADMIN via realm overlay)
  let aliceWs = ""; // alice, EDIT member
  let carolWs = ""; // carol, READ member
  let bobTok = ""; // bob, non-member identity token
  let rootId = "";
  let childId = "";

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);

    const ownerTok = await login(app, "owner@toddle.test");
    wsId = await createWorkspace(app, ownerTok, wsName);
    await addWorkspaceMember(app, ownerTok, wsId, "alice@toddle.test", "EDIT").expect(
      201
    );
    await addWorkspaceMember(app, ownerTok, wsId, "carol@toddle.test", "READ").expect(
      201
    );

    ownerWs = await enterWorkspace(app, ownerTok, wsId);
    aliceWs = await enterWorkspace(app, await login(app, "alice@toddle.test"), wsId);
    carolWs = await enterWorkspace(app, await login(app, "carol@toddle.test"), wsId);
    bobTok = await login(app, "bob@toddle.test");
  });

  afterAll(async () => {
    // Cascade-delete the throwaway workspace (removes its folders/docs/members).
    await prisma.workspace.deleteMany({ where: { id: wsId } });
    await app.close();
  });

  it("creates a top-level folder in the active workspace (EDIT+)", async () => {
    const res = await http(app)
      .post("/api/folders")
      .set(auth(ownerWs))
      .send({ name: "Root", icon: "📂" })
      .expect(201);
    expect(res.body.workspaceId).toBe(wsId);
    expect(res.body.deletedAt ?? null).toBeNull();
    rootId = res.body.id;
  });

  it("creates a child folder under it", async () => {
    const res = await http(app)
      .post("/api/folders")
      .set(auth(ownerWs))
      .send({ name: "Child", parentId: rootId })
      .expect(201);
    childId = res.body.id;
    expect(res.body.parentId).toBe(rootId);
  });

  it("gets a live folder by id", async () => {
    const res = await http(app)
      .get(`/api/folders/${rootId}`)
      .set(auth(ownerWs))
      .expect(200);
    expect(res.body.id).toBe(rootId);
  });

  it("lists the workspace's folders (root + child present)", async () => {
    const res = await http(app)
      .get("/api/folders?skip=0&take=100")
      .set(auth(ownerWs))
      .expect(200);
    const ids = res.body.map((f: { id: string }) => f.id);
    expect(ids).toEqual(expect.arrayContaining([rootId, childId]));
  });

  it("renames a folder / changes its icon", async () => {
    const res = await http(app)
      .patch(`/api/folders/${rootId}`)
      .set(auth(ownerWs))
      .send({ name: "Root (renamed)", icon: "🗂️" })
      .expect(200);
    expect(res.body.name).toBe("Root (renamed)");
    expect(res.body.icon).toBe("🗂️");
  });

  it("moves the child to the top level and back under the parent", async () => {
    let res = await http(app)
      .patch(`/api/folders/${childId}/move`)
      .set(auth(ownerWs))
      .send({ parentId: null })
      .expect(200);
    expect(res.body.parentId).toBeNull();

    res = await http(app)
      .patch(`/api/folders/${childId}/move`)
      .set(auth(ownerWs))
      .send({ parentId: rootId })
      .expect(200);
    expect(res.body.parentId).toBe(rootId);
  });

  it("rejects moving into a folder of another workspace / nonexistent parent → 404", async () => {
    await http(app)
      .patch(`/api/folders/${childId}/move`)
      .set(auth(ownerWs))
      .send({ parentId: "does-not-exist" })
      .expect(404);
  });

  it("a workspace member with EDIT can create folders", async () => {
    await http(app)
      .post("/api/folders")
      .set(auth(aliceWs))
      .send({ name: "Alice folder" })
      .expect(201);
  });

  it("a READ member cannot create folders (needs EDIT) → 403", async () => {
    await http(app)
      .post("/api/folders")
      .set(auth(carolWs))
      .send({ name: "nope" })
      .expect(403);
  });

  it("a non-member cannot list the workspace's folders → 403", async () => {
    await http(app)
      .get(`/api/folders?workspaceId=${wsId}`)
      .set(auth(bobTok))
      .expect(403);
  });

  it("listing with the identity token (no active workspace) → 400", async () => {
    const ownerTok = await login(app, "owner@toddle.test");
    await http(app).get("/api/folders").set(auth(ownerTok)).expect(400);
  });

  it("rejects a cycle (moving a parent into its own child) → 400", async () => {
    await http(app)
      .patch(`/api/folders/${rootId}/move`)
      .set(auth(ownerWs))
      .send({ parentId: childId })
      .expect(400);
  });

  it("a READ member cannot delete someone else's folder → 403", async () => {
    await http(app).delete(`/api/folders/${rootId}`).set(auth(carolWs)).expect(403);
  });

  it("soft-deletes the folder AND its subtree (hidden from reads, rows remain)", async () => {
    const del = await http(app)
      .delete(`/api/folders/${rootId}`)
      .set(auth(ownerWs))
      .expect(200);
    expect(del.body.softDeleted).toBeGreaterThanOrEqual(2); // root + child

    const list = await http(app).get("/api/folders").set(auth(ownerWs)).expect(200);
    const ids = list.body.map((f: { id: string }) => f.id);
    expect(ids).not.toContain(rootId);
    expect(ids).not.toContain(childId);

    // get on a soft-deleted folder → 404
    await http(app).get(`/api/folders/${rootId}`).set(auth(ownerWs)).expect(404);

    // rows still present in the DB with deletedAt set
    const row = await prisma.folder.findUnique({ where: { id: rootId } });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("purges only folders soft-deleted longer than the retention window", async () => {
    const folders = app.get(FoldersService);

    // young soft-delete (just now) must survive a 30-day purge
    const survivedBefore = await prisma.folder.count({
      where: { id: rootId, deletedAt: { not: null } },
    });
    expect(survivedBefore).toBe(1);
    expect(await folders.purgeSoftDeleted(30)).toBe(0);

    // back-date past the window → next purge hard-deletes the subtree
    await prisma.folder.updateMany({
      where: { id: { in: [rootId, childId] } },
      data: { deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });
    const purged = await folders.purgeSoftDeleted(30);
    expect(purged).toBeGreaterThanOrEqual(2);
    expect(await prisma.folder.findUnique({ where: { id: rootId } })).toBeNull();
  });
});
