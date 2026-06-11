import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@app/database";
import { AppModule } from "../src/app.module";
import { ActiveRealmService } from "../src/realm/active-realm.service";

/**
 * Full RBAC matrix (role × capability × scope) for the realm/workspace layer:
 *   realm context · realm membership mgmt · workspace CRUD · workspace membership ·
 *   the realm→workspace ADMIN overlay · last-admin guard · enter/leave session.
 *
 * Boots the real AppModule against DATABASE_URL. The pinned realm (REALM_ID) + a static
 * OWNER are provisioned BEFORE the app boots (ActiveRealmService refuses to boot otherwise).
 * All users/workspaces are stamped per run and cleaned up, so it is repeatable.
 */
const REALM_ID = process.env.REALM_ID ?? "realm_toddle";
const OWNER_EMAIL = "owner@toddle.test";
const PASSWORD = "password123";
const stamp = Date.now();
const db = new PrismaClient();

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("Realm / Workspace RBAC (e2e)", () => {
  let app: INestApplication;
  let server: import("http").Server;
  let ownerId = "";
  let ownerToken = "";

  // Reused actors.
  let maintainer: Actor; // realm MAINTAINER
  let member: Actor; //     realm MEMBER, in no workspace
  let outsider: Actor; //   registered, NOT a realm member

  type Actor = { token: string; id: string; email: string };

  async function register(local: string): Promise<Actor> {
    const email = `rbac_${local}_${stamp}@toddle.test`;
    const res = await request(server)
      .post("/api/auth/register")
      .send({ email, password: PASSWORD, name: local })
      .expect(201);
    return { token: res.body.accessToken, id: res.body.user.id, email };
  }

  /** Owner adds an existing user to the realm with a role. */
  async function addRealmUser(email: string, role: "MAINTAINER" | "MEMBER") {
    return request(server)
      .post("/api/realm/users")
      .set(auth(ownerToken))
      .send({ email, role })
      .expect(201);
  }

  async function createWorkspace(token: string, local: string): Promise<string> {
    const res = await request(server)
      .post("/api/workspaces")
      .set(auth(token))
      .send({ name: `ws_${local}_${stamp}` })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    // Provision realm + static OWNER before boot.
    await db.realm.upsert({
      where: { id: REALM_ID },
      update: {},
      create: { id: REALM_ID, name: "Toddle" },
    });
    const owner = await db.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: {
        email: OWNER_EMAIL,
        name: "Realm Owner",
        color: "#f04c54",
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    ownerId = owner.id;
    await db.realmMember.upsert({
      where: { realmId_userId: { realmId: REALM_ID, userId: owner.id } },
      update: { role: "OWNER" },
      create: { realmId: REALM_ID, userId: owner.id, role: "OWNER" },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api", {
      exclude: ["health", ".well-known/rtc-jwks.json"],
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();

    const login = await request(server)
      .post("/api/auth/login")
      .send({ email: OWNER_EMAIL, password: PASSWORD })
      .expect(201);
    ownerToken = login.body.accessToken;

    // Shared actors.
    maintainer = await register("maintainer");
    await addRealmUser(maintainer.email, "MAINTAINER");
    member = await register("member");
    await addRealmUser(member.email, "MEMBER");
    outsider = await register("outsider");
  });

  afterAll(async () => {
    await db.workspace.deleteMany({ where: { name: { contains: `_${stamp}` } } });
    await db.user.deleteMany({
      where: { email: { contains: `_${stamp}@toddle.test` } },
    });
    await app.close();
    await db.$disconnect();
  });

  // ---------------------------------------------------------------- boot guard

  describe("ActiveRealmService boot validation", () => {
    it("throws when REALM_ID has no matching realm row", async () => {
      const svc = new ActiveRealmService(
        { realm: { findUnique: async () => null } } as never,
        { get: () => "does-not-exist" } as never
      );
      await expect(svc.onModuleInit()).rejects.toThrow(/does not exist/);
    });

    it("pins to the realm when it exists", async () => {
      const svc = new ActiveRealmService(
        { realm: { findUnique: async () => ({ id: "r1", name: "R1" }) } } as never,
        { get: () => "r1" } as never
      );
      await svc.onModuleInit();
      expect(svc.id).toBe("r1");
      expect(svc.name).toBe("R1");
    });
  });

  // -------------------------------------------------------------- realm context

  describe("GET /api/realm", () => {
    it("owner sees role OWNER + realm identity", async () => {
      const res = await request(server)
        .get("/api/realm")
        .set(auth(ownerToken))
        .expect(200);
      expect(res.body.id).toBe(REALM_ID);
      expect(res.body.role).toBe("OWNER");
    });

    it("non-member sees role null", async () => {
      const res = await request(server)
        .get("/api/realm")
        .set(auth(outsider.token))
        .expect(200);
      expect(res.body.role).toBeNull();
    });

    it("requires authentication", async () => {
      await request(server).get("/api/realm").expect(401);
    });
  });

  // ------------------------------------------------------ realm membership mgmt

  describe("realm membership management", () => {
    it("owner adds a MAINTAINER and a MEMBER", async () => {
      const m = await register("addmaint");
      const u = await register("addmember");
      const r1 = await addRealmUser(m.email, "MAINTAINER");
      expect(r1.body.role).toBe("MAINTAINER");
      const r2 = await addRealmUser(u.email, "MEMBER");
      expect(r2.body.role).toBe("MEMBER");
    });

    it("maintainer can add a MEMBER but NOT a MAINTAINER", async () => {
      const u = await register("byMaintMember");
      await request(server)
        .post("/api/realm/users")
        .set(auth(maintainer.token))
        .send({ email: u.email, role: "MEMBER" })
        .expect(201);

      const m = await register("byMaintMaint");
      await request(server)
        .post("/api/realm/users")
        .set(auth(maintainer.token))
        .send({ email: m.email, role: "MAINTAINER" })
        .expect(403);
    });

    it("plain member and outsider cannot add realm users (403)", async () => {
      const u = await register("denied");
      await request(server)
        .post("/api/realm/users")
        .set(auth(member.token))
        .send({ email: u.email, role: "MEMBER" })
        .expect(403);
      await request(server)
        .post("/api/realm/users")
        .set(auth(outsider.token))
        .send({ email: u.email, role: "MEMBER" })
        .expect(403);
    });

    it("rejects OWNER as an assignable role (400)", async () => {
      const u = await register("wantowner");
      await request(server)
        .post("/api/realm/users")
        .set(auth(ownerToken))
        .send({ email: u.email, role: "OWNER" })
        .expect(400);
    });

    it("unknown email → 404, duplicate → 409", async () => {
      await request(server)
        .post("/api/realm/users")
        .set(auth(ownerToken))
        .send({ email: `ghost_${stamp}@toddle.test`, role: "MEMBER" })
        .expect(404);
      // member is already a realm member from beforeAll.
      await request(server)
        .post("/api/realm/users")
        .set(auth(ownerToken))
        .send({ email: member.email, role: "MEMBER" })
        .expect(409);
    });

    it("GET /api/realm/users: member can list, outsider 403", async () => {
      const res = await request(server)
        .get("/api/realm/users")
        .set(auth(member.token))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      await request(server)
        .get("/api/realm/users")
        .set(auth(outsider.token))
        .expect(403);
    });

    it("owner can promote/demote a MEMBER; maintainer cannot touch a MAINTAINER", async () => {
      const u = await register("promote");
      await addRealmUser(u.email, "MEMBER");
      await request(server)
        .patch(`/api/realm/users/${u.id}`)
        .set(auth(ownerToken))
        .send({ role: "MAINTAINER" })
        .expect(200);
      // maintainer trying to demote a (now) MAINTAINER → 403 (owner-only)
      await request(server)
        .patch(`/api/realm/users/${u.id}`)
        .set(auth(maintainer.token))
        .send({ role: "MEMBER" })
        .expect(403);
    });

    it("the OWNER membership cannot be changed or removed", async () => {
      await request(server)
        .patch(`/api/realm/users/${ownerId}`)
        .set(auth(ownerToken))
        .send({ role: "MEMBER" })
        .expect(403);
      await request(server)
        .delete(`/api/realm/users/${ownerId}`)
        .set(auth(ownerToken))
        .expect(403);
    });

    it("maintainer can remove a MEMBER but not a MAINTAINER; owner removes a MAINTAINER", async () => {
      const target = await register("removable");
      await addRealmUser(target.email, "MEMBER");
      await request(server)
        .delete(`/api/realm/users/${target.id}`)
        .set(auth(maintainer.token))
        .expect(200);

      const maint2 = await register("removableMaint");
      await addRealmUser(maint2.email, "MAINTAINER");
      await request(server)
        .delete(`/api/realm/users/${maint2.id}`)
        .set(auth(maintainer.token))
        .expect(403);
      await request(server)
        .delete(`/api/realm/users/${maint2.id}`)
        .set(auth(ownerToken))
        .expect(200);
    });
  });

  // ------------------------------------------------------- workspace CRUD

  describe("workspace creation & listing", () => {
    it("maintainer creates a workspace and is its ADMIN; member/outsider cannot create", async () => {
      const wsId = await createWorkspace(maintainer.token, "byMaint");
      const users = await request(server)
        .get(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .expect(200);
      const me = users.body.find((m: { userId: string }) => m.userId === maintainer.id);
      expect(me.role).toBe("ADMIN");

      await request(server)
        .post("/api/workspaces")
        .set(auth(member.token))
        .send({ name: `ws_denied_${stamp}` })
        .expect(403);
      await request(server)
        .post("/api/workspaces")
        .set(auth(outsider.token))
        .send({ name: `ws_denied2_${stamp}` })
        .expect(403);
    });

    it("listing: outsider sees [], members see only theirs, realm admins see all", async () => {
      await createWorkspace(ownerToken, "listed");

      const out = await request(server)
        .get("/api/workspaces")
        .set(auth(outsider.token))
        .expect(200);
      expect(out.body).toEqual([]);

      const asOwner = await request(server)
        .get("/api/workspaces")
        .set(auth(ownerToken))
        .expect(200);
      expect(asOwner.body.length).toBeGreaterThan(0);
      expect(asOwner.body.every((w: { role: string }) => w.role === "ADMIN")).toBe(true);
    });

    it("GET /workspaces/:id: missing → 404, in-realm but no access → 403", async () => {
      await request(server)
        .get("/api/workspaces/nonexistent-id")
        .set(auth(ownerToken))
        .expect(404);

      const wsId = await createWorkspace(maintainer.token, "private");
      await request(server)
        .get(`/api/workspaces/${wsId}`)
        .set(auth(member.token))
        .expect(403);
    });

    it("rename/delete require workspace ADMIN", async () => {
      const wsId = await createWorkspace(maintainer.token, "rename");
      await request(server)
        .patch(`/api/workspaces/${wsId}`)
        .set(auth(member.token))
        .send({ name: `ws_renamed_${stamp}` })
        .expect(403);
      await request(server)
        .patch(`/api/workspaces/${wsId}`)
        .set(auth(maintainer.token))
        .send({ name: `ws_renamed_${stamp}` })
        .expect(200);
      await request(server)
        .delete(`/api/workspaces/${wsId}`)
        .set(auth(maintainer.token))
        .expect(200);
    });
  });

  // -------------------------------------------------- workspace membership

  describe("workspace membership management", () => {
    it("admin adds a user (READ+), who is auto-added as a realm MEMBER", async () => {
      const wsId = await createWorkspace(maintainer.token, "addusers");
      // outsider is NOT a realm member yet.
      const before = await request(server)
        .get("/api/realm")
        .set(auth(outsider.token))
        .expect(200);
      expect(before.body.role).toBeNull();

      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .send({ email: outsider.email, role: "EDIT" })
        .expect(201);

      const after = await request(server)
        .get("/api/realm")
        .set(auth(outsider.token))
        .expect(200);
      expect(after.body.role).toBe("MEMBER"); // tenant integrity
    });

    it("realm owner manages workspace members via the ADMIN overlay (no direct membership)", async () => {
      const wsId = await createWorkspace(maintainer.token, "overlay");
      const u = await register("overlayee");
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(ownerToken)) // owner is not a direct member
        .send({ email: u.email, role: "READ" })
        .expect(201);
    });

    it("non-admin workspace members cannot add users (403)", async () => {
      const wsId = await createWorkspace(maintainer.token, "noadd");
      const reader = await register("reader");
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .send({ email: reader.email, role: "READ" })
        .expect(201);
      const victim = await register("victim");
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(reader.token))
        .send({ email: victim.email, role: "READ" })
        .expect(403);
    });

    it("unknown email → 404, duplicate → 409", async () => {
      const wsId = await createWorkspace(maintainer.token, "dups");
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .send({ email: `ghost_${stamp}@toddle.test`, role: "READ" })
        .expect(404);
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .send({ email: member.email, role: "READ" })
        .expect(201);
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .send({ email: member.email, role: "READ" })
        .expect(409);
    });

    it("listing members: READ+ allowed, non-member 403; role change requires ADMIN", async () => {
      const wsId = await createWorkspace(maintainer.token, "list");
      const reader = await register("listreader");
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .send({ email: reader.email, role: "READ" })
        .expect(201);

      await request(server)
        .get(`/api/workspaces/${wsId}/users`)
        .set(auth(reader.token))
        .expect(200);
      await request(server)
        .get(`/api/workspaces/${wsId}/users`)
        .set(auth(outsider.token))
        .expect(403);

      // reader (non-admin) cannot change roles
      await request(server)
        .patch(`/api/workspaces/${wsId}/users/${reader.id}`)
        .set(auth(reader.token))
        .send({ role: "ADMIN" })
        .expect(403);
      // admin can
      await request(server)
        .patch(`/api/workspaces/${wsId}/users/${reader.id}`)
        .set(auth(maintainer.token))
        .send({ role: "EDIT" })
        .expect(200);
    });

    it("the last ADMIN cannot be demoted or removed (409)", async () => {
      const u = await register("soleadmin");
      await addRealmUser(u.email, "MAINTAINER"); // can create; becomes the only ADMIN
      const wsId = await createWorkspace(u.token, "soleadmin");

      await request(server)
        .patch(`/api/workspaces/${wsId}/users/${u.id}`)
        .set(auth(u.token))
        .send({ role: "READ" })
        .expect(409);
      await request(server)
        .delete(`/api/workspaces/${wsId}/users/${u.id}`)
        .set(auth(u.token))
        .expect(409);

      // Add a second admin → now the first can be removed.
      const u2 = await register("secondadmin");
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(u.token))
        .send({ email: u2.email, role: "ADMIN" })
        .expect(201);
      await request(server)
        .delete(`/api/workspaces/${wsId}/users/${u.id}`)
        .set(auth(u2.token))
        .expect(200);
    });
  });

  // --------------------------------------------------- enter / leave session

  describe("workspace session (enter / leave)", () => {
    it("enter a workspace you can access → scoped token; /me reflects activeWorkspaceId", async () => {
      const wsId = await createWorkspace(maintainer.token, "session");
      const reader = await register("sessreader");
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .send({ email: reader.email, role: "READ" })
        .expect(201);

      const entered = await request(server)
        .post("/api/auth/workspace/enter")
        .set(auth(reader.token))
        .send({ workspaceId: wsId })
        .expect(201);
      expect(entered.body.workspaceId).toBe(wsId);
      expect(entered.body.role).toBe("READ");
      expect(typeof entered.body.accessToken).toBe("string");

      const me = await request(server)
        .get("/api/auth/me")
        .set(auth(entered.body.accessToken))
        .expect(200);
      expect(me.body.user.activeWorkspaceId).toBe(wsId);

      const left = await request(server)
        .post("/api/auth/workspace/leave")
        .set(auth(entered.body.accessToken))
        .expect(201);
      expect(left.body.workspaceId).toBeNull();
      const meAfter = await request(server)
        .get("/api/auth/me")
        .set(auth(left.body.accessToken))
        .expect(200);
      expect(meAfter.body.user.activeWorkspaceId).toBeNull();
    });

    it("enter without access → 403, missing workspace → 404, no token → 401", async () => {
      const wsId = await createWorkspace(maintainer.token, "noenter");
      await request(server)
        .post("/api/auth/workspace/enter")
        .set(auth(outsider.token))
        .send({ workspaceId: wsId })
        .expect(403);
      await request(server)
        .post("/api/auth/workspace/enter")
        .set(auth(ownerToken))
        .send({ workspaceId: "missing-ws-id" })
        .expect(404);
      await request(server)
        .post("/api/auth/workspace/enter")
        .send({ workspaceId: wsId })
        .expect(401);
    });
  });

  // ------------------------------------------------------- join lifecycle

  async function createPublic(local: string, defaultRole = "READ"): Promise<string> {
    const res = await request(server)
      .post("/api/workspaces")
      .set(auth(maintainer.token))
      .send({ name: `ws_${local}_${stamp}`, visibility: "PUBLIC", defaultRole })
      .expect(201);
    return res.body.id as string;
  }
  const hasId = (id: string) => (r: { id: string }) => r.id === id;

  describe("public workspaces — self-join", () => {
    it("outsiders (non-realm members) get 403 on discover / join / request", async () => {
      const wsId = await createPublic("gated");
      // Fresh registration: the shared `outsider` gets realm membership in an
      // earlier test (auto-added when joined to a workspace).
      const stranger = await register("stranger");
      await request(server)
        .get("/api/workspaces/discoverable")
        .set(auth(stranger.token))
        .expect(403);
      await request(server)
        .post(`/api/workspaces/${wsId}/join`)
        .set(auth(stranger.token))
        .expect(403);
      await request(server)
        .post(`/api/workspaces/${wsId}/requests`)
        .set(auth(stranger.token))
        .send({})
        .expect(403);
    });

    it("discoverable + self-join as defaultRole; stays realm MEMBER; re-join 409", async () => {
      const wsId = await createPublic("public", "COMMENT");
      const joiner = await register("joiner");
      await addRealmUser(joiner.email, "MEMBER"); // join requires realm membership

      const disc = await request(server)
        .get("/api/workspaces/discoverable")
        .set(auth(joiner.token))
        .expect(200);
      expect(disc.body.some(hasId(wsId))).toBe(true);

      const joined = await request(server)
        .post(`/api/workspaces/${wsId}/join`)
        .set(auth(joiner.token))
        .expect(201);
      expect(joined.body.role).toBe("COMMENT");

      const realm = await request(server)
        .get("/api/realm")
        .set(auth(joiner.token))
        .expect(200);
      expect(realm.body.role).toBe("MEMBER"); // tenant integrity

      const disc2 = await request(server)
        .get("/api/workspaces/discoverable")
        .set(auth(joiner.token))
        .expect(200);
      expect(disc2.body.some(hasId(wsId))).toBe(false); // already a member

      await request(server)
        .post(`/api/workspaces/${wsId}/join`)
        .set(auth(joiner.token))
        .expect(409);
    });

    it("cannot self-join a PRIVATE workspace (403); cannot request a PUBLIC one (400)", async () => {
      const priv = await createWorkspace(maintainer.token, "joinpriv"); // default PRIVATE
      const u = await register("privjoiner");
      await addRealmUser(u.email, "MEMBER");
      await request(server)
        .post(`/api/workspaces/${priv}/join`)
        .set(auth(u.token))
        .expect(403);

      const pub = await createPublic("reqpub");
      await request(server)
        .post(`/api/workspaces/${pub}/requests`)
        .set(auth(u.token))
        .send({})
        .expect(400);
    });
  });

  describe("private workspaces — request / approve / reject", () => {
    it("request → realm admin approves → member with requested role; re-decide 409", async () => {
      const wsId = await createWorkspace(maintainer.token, "reqapprove");
      const requester = await register("requester");
      await addRealmUser(requester.email, "MEMBER");

      const req = await request(server)
        .post(`/api/workspaces/${wsId}/requests`)
        .set(auth(requester.token))
        .send({ requestedRole: "EDIT" })
        .expect(201);
      expect(req.body.state).toBe("PENDING");

      // duplicate pending → 409; still not a member → 403
      await request(server)
        .post(`/api/workspaces/${wsId}/requests`)
        .set(auth(requester.token))
        .send({})
        .expect(409);
      await request(server)
        .get(`/api/workspaces/${wsId}`)
        .set(auth(requester.token))
        .expect(403);

      // per-workspace list (admin sees it; requester cannot)
      const list = await request(server)
        .get(`/api/workspaces/${wsId}/requests`)
        .set(auth(maintainer.token))
        .expect(200);
      expect(list.body.some(hasId(req.body.id))).toBe(true);
      await request(server)
        .get(`/api/workspaces/${wsId}/requests`)
        .set(auth(requester.token))
        .expect(403);

      // top-level inbox (realm owner), filtered by workspaceId
      const inbox = await request(server)
        .get(`/api/workspaces/join-requests?workspaceId=${wsId}`)
        .set(auth(ownerToken))
        .expect(200);
      expect(inbox.body.some(hasId(req.body.id))).toBe(true);

      // approve by realm owner
      const approved = await request(server)
        .post(`/api/workspaces/${wsId}/requests/${req.body.id}/approve`)
        .set(auth(ownerToken))
        .send({})
        .expect(201);
      expect(approved.body.role).toBe("EDIT");
      await request(server)
        .get(`/api/workspaces/${wsId}`)
        .set(auth(requester.token))
        .expect(200);

      // already decided → 409
      await request(server)
        .post(`/api/workspaces/${wsId}/requests/${req.body.id}/approve`)
        .set(auth(ownerToken))
        .send({})
        .expect(409);
    });

    it("reject a request; requester is not added and may re-request", async () => {
      const wsId = await createWorkspace(maintainer.token, "reject");
      const requester = await register("rejectee");
      await addRealmUser(requester.email, "MEMBER");
      const req = await request(server)
        .post(`/api/workspaces/${wsId}/requests`)
        .set(auth(requester.token))
        .send({})
        .expect(201);
      await request(server)
        .post(`/api/workspaces/${wsId}/requests/${req.body.id}/reject`)
        .set(auth(maintainer.token))
        .expect(201);
      await request(server)
        .get(`/api/workspaces/${wsId}`)
        .set(auth(requester.token))
        .expect(403);
      await request(server)
        .post(`/api/workspaces/${wsId}/requests`)
        .set(auth(requester.token))
        .send({})
        .expect(201); // re-request allowed after rejection
    });

    it("non-admins cannot approve/reject and don't see the request in their inbox", async () => {
      const wsId = await createWorkspace(maintainer.token, "authz");
      const requester = await register("authzreq");
      await addRealmUser(requester.email, "MEMBER");
      const req = await request(server)
        .post(`/api/workspaces/${wsId}/requests`)
        .set(auth(requester.token))
        .send({})
        .expect(201);

      await request(server)
        .post(`/api/workspaces/${wsId}/requests/${req.body.id}/approve`)
        .set(auth(member.token))
        .send({})
        .expect(403);
      await request(server)
        .post(`/api/workspaces/${wsId}/requests/${req.body.id}/reject`)
        .set(auth(member.token))
        .expect(403);

      const inbox = await request(server)
        .get("/api/workspaces/join-requests")
        .set(auth(member.token))
        .expect(200);
      expect(inbox.body.some(hasId(req.body.id))).toBe(false); // administers nothing
    });

    it("a workspace ADMIN (not a realm admin) sees + approves its own requests", async () => {
      const wsId = await createWorkspace(maintainer.token, "wsadmin");
      const wsAdmin = await register("wsadmin");
      await request(server)
        .post(`/api/workspaces/${wsId}/users`)
        .set(auth(maintainer.token))
        .send({ email: wsAdmin.email, role: "ADMIN" })
        .expect(201);
      const requester = await register("wsadminreq");
      await addRealmUser(requester.email, "MEMBER");
      const req = await request(server)
        .post(`/api/workspaces/${wsId}/requests`)
        .set(auth(requester.token))
        .send({})
        .expect(201);

      const inbox = await request(server)
        .get("/api/workspaces/join-requests")
        .set(auth(wsAdmin.token))
        .expect(200);
      expect(inbox.body.some(hasId(req.body.id))).toBe(true);

      await request(server)
        .post(`/api/workspaces/${wsId}/requests/${req.body.id}/approve`)
        .set(auth(wsAdmin.token))
        .send({ role: "READ" })
        .expect(201);
    });
  });
});
