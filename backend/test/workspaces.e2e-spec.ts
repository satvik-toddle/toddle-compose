import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { addRealmMember, auth, bootApp, http, login } from "./helpers";

/**
 * Workspaces (e2e) — full surface: CRUD + authz, membership management (with
 * last-admin protection), PUBLIC self-join, PRIVATE request/approve/reject, and
 * the discoverable + join-request inbox listings. Boots the real AppModule.
 *
 * Workspace admin ops use the owner's IDENTITY token: realm OWNER projects to
 * workspace ADMIN on every workspace via the AuthzService overlay (no "enter" needed).
 */
describe("Workspaces (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  let ownerTok = "";
  let daveTok = "";
  let bobTok = "";
  let carolTok = "";
  let eveTok = "";

  let privWs = ""; // PRIVATE workspace
  let pubWs = ""; // PUBLIC workspace
  let aliceUserId = "";

  const createWs = async (
    token: string,
    name: string,
    visibility: "PRIVATE" | "PUBLIC",
    defaultRole: "READ" | "EDIT" = "READ"
  ) => {
    const res = await http(app)
      .post("/api/workspaces")
      .set(auth(token))
      .send({ name, visibility, defaultRole })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);

    ownerTok = await login(app, "owner@toddle.test");
    // All actors are plain realm MEMBERs — discover/join/request require realm
    // membership now (they persist across runs → tolerate 409).
    for (const email of [
      "dave@toddle.test",
      "bob@toddle.test",
      "carol@toddle.test",
      "eve@toddle.test",
    ]) {
      await addRealmMember(app, ownerTok, email, "MEMBER").then((r) =>
        expect([201, 409]).toContain(r.status)
      );
    }
    daveTok = await login(app, "dave@toddle.test");
    bobTok = await login(app, "bob@toddle.test");
    carolTok = await login(app, "carol@toddle.test");
    eveTok = await login(app, "eve@toddle.test");

    privWs = await createWs(ownerTok, `e2e-ws-priv-${stamp}`, "PRIVATE");
    pubWs = await createWs(ownerTok, `e2e-ws-pub-${stamp}`, "PUBLIC");
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: [privWs, pubWs] } } });
    await app.close();
  });

  // ---- CRUD + authz ----

  it("a realm MEMBER (not MAINTAINER) cannot create a workspace → 403", async () => {
    await http(app)
      .post("/api/workspaces")
      .set(auth(daveTok))
      .send({ name: "nope", visibility: "PRIVATE" })
      .expect(403);
  });

  it("creator gets the workspace with role ADMIN", async () => {
    const res = await http(app)
      .get(`/api/workspaces/${privWs}`)
      .set(auth(ownerTok))
      .expect(200);
    expect(res.body.id).toBe(privWs);
    expect(res.body.role).toBe("ADMIN");
  });

  it("a non-member cannot read an in-realm workspace → 403 (existence not hidden)", async () => {
    await http(app).get(`/api/workspaces/${privWs}`).set(auth(bobTok)).expect(403);
  });

  it("get a nonexistent workspace → 404", async () => {
    await http(app)
      .get(`/api/workspaces/does-not-exist`)
      .set(auth(ownerTok))
      .expect(404);
  });

  it("an ADMIN can update name / visibility / defaultRole", async () => {
    const res = await http(app)
      .patch(`/api/workspaces/${privWs}`)
      .set(auth(ownerTok))
      .send({ name: `e2e-ws-priv-${stamp}-renamed`, defaultRole: "EDIT" })
      .expect(200);
    expect(res.body.name).toContain("renamed");
    expect(res.body.defaultRole).toBe("EDIT");
  });

  it("a non-admin cannot update → 403/404", async () => {
    await http(app)
      .patch(`/api/workspaces/${privWs}`)
      .set(auth(bobTok))
      .send({ name: "hijack" })
      .expect((r) => expect([403, 404]).toContain(r.status));
  });

  // ---- membership ----

  it("lists members (creator present as ADMIN)", async () => {
    const res = await http(app)
      .get(`/api/workspaces/${privWs}/users`)
      .set(auth(ownerTok))
      .expect(200);
    const admins = res.body.filter((m: { role: string }) => m.role === "ADMIN");
    expect(admins.length).toBeGreaterThanOrEqual(1);
  });

  it("adds a member by email; rejects unknown email and duplicates", async () => {
    const res = await http(app)
      .post(`/api/workspaces/${privWs}/users`)
      .set(auth(ownerTok))
      .send({ email: "alice@toddle.test", role: "EDIT" })
      .expect(201);
    aliceUserId = res.body.userId;
    expect(res.body.role).toBe("EDIT");

    await http(app)
      .post(`/api/workspaces/${privWs}/users`)
      .set(auth(ownerTok))
      .send({ email: "ghost@nowhere.test", role: "READ" })
      .expect(404);

    await http(app)
      .post(`/api/workspaces/${privWs}/users`)
      .set(auth(ownerTok))
      .send({ email: "alice@toddle.test", role: "READ" })
      .expect(409);
  });

  it("updates a member's role; 404 for a non-member target", async () => {
    await http(app)
      .patch(`/api/workspaces/${privWs}/users/${aliceUserId}`)
      .set(auth(ownerTok))
      .send({ role: "ADMIN" })
      .expect(200);

    await http(app)
      .patch(`/api/workspaces/${privWs}/users/nonmember-id`)
      .set(auth(ownerTok))
      .send({ role: "READ" })
      .expect(404);
  });

  it("removes a member, and protects the last remaining ADMIN", async () => {
    // alice is ADMIN now → owner + alice = 2 admins; removing alice is allowed
    await http(app)
      .delete(`/api/workspaces/${privWs}/users/${aliceUserId}`)
      .set(auth(ownerTok))
      .expect(200);

    // owner is now the last ADMIN → removing them is blocked
    const ownerMe = await http(app).get("/api/auth/me").set(auth(ownerTok)).expect(200);
    await http(app)
      .delete(`/api/workspaces/${privWs}/users/${ownerMe.body.user.id}`)
      .set(auth(ownerTok))
      .expect(409);
  });

  // ---- PUBLIC self-join ----

  it("PUBLIC workspace shows up in discoverable for a non-member", async () => {
    const res = await http(app)
      .get("/api/workspaces/discoverable")
      .set(auth(daveTok))
      .expect(200);
    expect(res.body.map((w: { id: string }) => w.id)).toContain(pubWs);
  });

  it("a user can self-join a PUBLIC workspace; double-join → 409", async () => {
    await http(app).post(`/api/workspaces/${pubWs}/join`).set(auth(daveTok)).expect(201);
    await http(app).post(`/api/workspaces/${pubWs}/join`).set(auth(daveTok)).expect(409);
  });

  it("cannot self-join a PRIVATE workspace → 403", async () => {
    await http(app).post(`/api/workspaces/${privWs}/join`).set(auth(eveTok)).expect(403);
  });

  // ---- PRIVATE request / approve / reject ----

  it("request to join a PRIVATE workspace → PENDING; PUBLIC request → 400", async () => {
    const res = await http(app)
      .post(`/api/workspaces/${privWs}/requests`)
      .set(auth(bobTok))
      .send({ requestedRole: "READ" })
      .expect(201);
    expect(res.body.state).toBe("PENDING");

    await http(app)
      .post(`/api/workspaces/${pubWs}/requests`)
      .set(auth(eveTok))
      .send({})
      .expect(400);
  });

  it("admin sees the request in the per-workspace list and the realm inbox", async () => {
    const perWs = await http(app)
      .get(`/api/workspaces/${privWs}/requests?state=PENDING`)
      .set(auth(ownerTok))
      .expect(200);
    expect(perWs.body.some((r: { user: { email: string } }) => r.user.email === "bob@toddle.test")).toBe(true);

    const inbox = await http(app)
      .get(`/api/workspaces/join-requests?state=PENDING&workspaceId=${privWs}`)
      .set(auth(ownerTok))
      .expect(200);
    expect(inbox.body.length).toBeGreaterThanOrEqual(1);
  });

  it("approving a request makes the requester a member", async () => {
    const list = await http(app)
      .get(`/api/workspaces/${privWs}/requests?state=PENDING`)
      .set(auth(ownerTok));
    const reqId = list.body.find(
      (r: { user: { email: string }; id: string }) => r.user.email === "bob@toddle.test"
    ).id;

    await http(app)
      .post(`/api/workspaces/${privWs}/requests/${reqId}/approve`)
      .set(auth(ownerTok))
      .send({ role: "READ" })
      .expect(201);

    // bob can now read the workspace
    await http(app).get(`/api/workspaces/${privWs}`).set(auth(bobTok)).expect(200);
  });

  it("rejecting a request leaves the requester a non-member", async () => {
    const req = await http(app)
      .post(`/api/workspaces/${privWs}/requests`)
      .set(auth(carolTok))
      .send({})
      .expect(201);

    await http(app)
      .post(`/api/workspaces/${privWs}/requests/${req.body.id}/reject`)
      .set(auth(ownerTok))
      .expect(201);

    await http(app).get(`/api/workspaces/${privWs}`).set(auth(carolTok)).expect(403);
  });

  // ---- list + delete ----

  it("realm admin lists all workspaces; the throwaway ones are included", async () => {
    const res = await http(app).get("/api/workspaces").set(auth(ownerTok)).expect(200);
    const ids = res.body.map((w: { id: string }) => w.id);
    expect(ids).toEqual(expect.arrayContaining([privWs, pubWs]));
  });

  it("a non-admin cannot delete; an ADMIN can", async () => {
    await http(app).delete(`/api/workspaces/${pubWs}`).set(auth(daveTok)).expect(403);
    await http(app).delete(`/api/workspaces/${pubWs}`).set(auth(ownerTok)).expect(200);
    await http(app).get(`/api/workspaces/${pubWs}`).set(auth(ownerTok)).expect(404);
  });
});
