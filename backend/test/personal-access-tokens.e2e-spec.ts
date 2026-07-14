import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import bcrypt from "bcrypt";
import { createHash } from "crypto";
import { PrismaClient } from "@app/database";
import { PrismaPg } from "@prisma/adapter-pg";
import { AppModule } from "../src/app.module";

/**
 * Access-token feature (e2e): minting authorization, the per-request permission
 * cap, workspace confinement, live-role weakening on demotion, revocation,
 * expiry, and the "tokens can't manage tokens" guard.
 *
 * Boots the real AppModule against DATABASE_URL with the pinned realm + a static
 * OWNER provisioned before boot (same pattern as realm.e2e-spec). Stamped per run.
 */
const REALM_ID = process.env.REALM_ID ?? "realm_toddle";
const OWNER_EMAIL = "owner@toddle.test";
const PASSWORD = "password123";
const stamp = Date.now();
// Prisma 7 requires a driver adapter; DATABASE_URL is exported by the test script.
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Decode a JWT payload without verifying — enough to assert the claims the
// rtc-server will act on (role/docId/sub). The rtc-server verifies the RS256
// signature via JWKS; here we only need the frozen capability.
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, body] = jwt.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

describe("Personal access tokens (e2e)", () => {
  let app: INestApplication;
  let server: import("http").Server;
  let ownerToken = "";
  let alice: { token: string; id: string; email: string };
  let wsA = "";
  let wsB = "";

  async function register(local: string) {
    const email = `tok_${local}_${stamp}@toddle.test`;
    // Sign-up no longer issues a session (email-verification flow). The suite runs
    // with BYPASS_EMAIL_SERVICE, which auto-verifies the account, so log in for tokens.
    await request(server)
      .post("/api/auth/register")
      .send({ email, password: PASSWORD, name: local })
      .expect(201);
    const res = await request(server)
      .post("/api/auth/login")
      .send({ email, password: PASSWORD })
      .expect(201);
    return { token: res.body.accessToken as string, id: res.body.user.id as string, email };
  }

  function createToken(
    token: string,
    body: Record<string, unknown>
  ): request.Test {
    return request(server).post("/api/personal-access-tokens").set(auth(token)).send(body);
  }

  function createDoc(token: string, workspaceId?: string): request.Test {
    const body: Record<string, unknown> = { title: "t" };
    if (workspaceId) body.workspaceId = workspaceId;
    return request(server).post("/api/documents").set(auth(token)).send(body);
  }

  beforeAll(async () => {
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
    await db.realmMember.upsert({
      where: { realmId_userId: { realmId: REALM_ID, userId: owner.id } },
      update: { role: "OWNER" },
      create: { realmId: REALM_ID, userId: owner.id, role: "OWNER" },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api", { exclude: ["health", ".well-known/rtc-jwks.json"] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();

    const login = await request(server)
      .post("/api/auth/login")
      .send({ email: OWNER_EMAIL, password: PASSWORD })
      .expect(201);
    ownerToken = login.body.accessToken;

    // Two workspaces (owner is ADMIN in both via the realm overlay).
    wsA = (
      await request(server)
        .post("/api/workspaces")
        .set(auth(ownerToken))
        .send({ name: `wsA_${stamp}` })
        .expect(201)
    ).body.id;
    wsB = (
      await request(server)
        .post("/api/workspaces")
        .set(auth(ownerToken))
        .send({ name: `wsB_${stamp}` })
        .expect(201)
    ).body.id;

    // Alice: realm MEMBER, EDIT in workspace A only.
    alice = await register("alice");
    await request(server)
      .post("/api/realm/users")
      .set(auth(ownerToken))
      .send({ email: alice.email, role: "MEMBER" })
      .expect(201);
    await request(server)
      .post(`/api/workspaces/${wsA}/users`)
      .set(auth(ownerToken))
      .send({ email: alice.email, role: "EDIT" })
      .expect(201);
  });

  afterAll(async () => {
    await db.personalAccessToken.deleteMany({ where: { name: { contains: `_${stamp}` } } });
    await db.workspace.deleteMany({ where: { name: { contains: `_${stamp}` } } });
    await db.user.deleteMany({
      where: { email: { contains: `_${stamp}@toddle.test` } },
    });
    await app.close();
    await db.$disconnect();
  });

  // -------------------------------------------------------------- minting authz

  it("workspace member mints a token at or below their role; above is rejected", async () => {
    await createToken(alice.token, {
      name: `a_edit_${stamp}`,
      scope: "WORKSPACE",
      workspaceId: wsA,
      permission: "EDIT",
    }).expect(201);

    // Alice is only EDIT in A — she cannot mint an ADMIN token.
    await createToken(alice.token, {
      name: `a_admin_${stamp}`,
      scope: "WORKSPACE",
      workspaceId: wsA,
      permission: "ADMIN",
    }).expect(403);
  });

  it("only realm MAINTAINER+ can mint a REALM token", async () => {
    await createToken(alice.token, {
      name: `a_realm_${stamp}`,
      scope: "REALM",
      permission: "EDIT",
    }).expect(403);

    await createToken(ownerToken, {
      name: `o_realm_${stamp}`,
      scope: "REALM",
      permission: "EDIT",
    }).expect(201);
  });

  it("MAINTAINER permission is only valid on a REALM token", async () => {
    await createToken(ownerToken, {
      name: `bad_${stamp}`,
      scope: "WORKSPACE",
      workspaceId: wsA,
      permission: "MAINTAINER",
    }).expect(400);
  });

  it("create response returns the raw secret once; listings never do", async () => {
    const res = await createToken(ownerToken, {
      name: `secret_${stamp}`,
      scope: "WORKSPACE",
      workspaceId: wsA,
      permission: "VIEW",
    }).expect(201);
    expect(res.body.token).toMatch(/^ctk_/);
    expect(res.body.accessToken.prefix).toMatch(/^ctk_/);
    expect(res.body.accessToken).not.toHaveProperty("tokenHash");

    const list = await request(server)
      .get("/api/personal-access-tokens")
      .set(auth(ownerToken))
      .expect(200);
    for (const t of list.body) {
      expect(t).not.toHaveProperty("token");
      expect(t).not.toHaveProperty("tokenHash");
    }
  });

  // ------------------------------------------------------------- use: cap/scope

  it("REALM token reaches every workspace; cap limits capability", async () => {
    const edit = (
      await createToken(ownerToken, {
        name: `realm_edit_${stamp}`,
        scope: "REALM",
        permission: "EDIT",
      }).expect(201)
    ).body.token;
    await createDoc(edit, wsA).expect(201);
    await createDoc(edit, wsB).expect(201);

    // VIEW caps below EDIT, so document creation is forbidden everywhere.
    const view = (
      await createToken(ownerToken, {
        name: `realm_view_${stamp}`,
        scope: "REALM",
        permission: "VIEW",
      }).expect(201)
    ).body.token;
    await createDoc(view, wsA).expect(403);
  });

  it("WORKSPACE token is confined to its workspace", async () => {
    const tok = (
      await createToken(ownerToken, {
        name: `confined_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;

    // Works in A...
    const doc = await createDoc(tok, wsA).expect(201);
    // ...but cannot create in B even though the owner (creator) is ADMIN there.
    await createDoc(tok, wsB).expect(403);

    // And a doc that lives in B is invisible (404) — even owner-owned ones.
    const docInB = await createDoc(ownerToken, wsB).expect(201);
    await request(server)
      .get(`/api/documents/${docInB.body.id}`)
      .set(auth(tok))
      .expect(404);

    // Reading its own-workspace doc is fine.
    await request(server)
      .get(`/api/documents/${doc.body.id}`)
      .set(auth(tok))
      .expect(200);
  });

  it("demoting the creator weakens the token (live-role cap)", async () => {
    const tok = (
      await createToken(alice.token, {
        name: `demote_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;
    await createDoc(tok, wsA).expect(201);

    // Drop Alice to READ in A; the EDIT-ceiling token now caps to READ.
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: wsA, userId: alice.id } },
      data: { role: "READ" },
    });
    await createDoc(tok, wsA).expect(403);

    // Restore for any later assertions.
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: wsA, userId: alice.id } },
      data: { role: "EDIT" },
    });
  });

  // --------------------------------------------- using a token like a real user

  it("identifies as its creator on GET /api/auth/me", async () => {
    const tok = (
      await createToken(alice.token, {
        name: `me_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;
    const res = await request(server)
      .get("/api/auth/me")
      .set(auth(tok))
      .expect(200);
    expect(res.body.user.email).toBe(alice.email);
  });

  it("creates, lists, and reads folders with the token", async () => {
    // Workspace token: activeWorkspaceId defaults to its workspace, so no explicit id needed.
    const tok = (
      await createToken(alice.token, {
        name: `folders_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;

    const created = await request(server)
      .post("/api/folders")
      .set(auth(tok))
      .send({ name: `f_${stamp}` })
      .expect(201);
    const folderId = created.body.id;

    const list = await request(server)
      .get("/api/folders")
      .set(auth(tok))
      .expect(200);
    expect(list.body.map((f: { id: string }) => f.id)).toContain(folderId);

    await request(server).get(`/api/folders/${folderId}`).set(auth(tok)).expect(200);
  });

  it("creates, reads, lists, and walks the hierarchy of documents with the token", async () => {
    const tok = (
      await createToken(alice.token, {
        name: `docs_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;

    const created = await createDoc(tok).expect(201); // workspace defaults to A
    const docId = created.body.id;

    const got = await request(server)
      .get(`/api/documents/${docId}`)
      .set(auth(tok))
      .expect(200);
    expect(got.body.id).toBe(docId);
    expect(got.body).toHaveProperty("breadcrumbs");

    const list = await request(server)
      .get(`/api/documents?workspaceId=${wsA}`)
      .set(auth(tok))
      .expect(200);
    expect(list.body.map((d: { id: string }) => d.id)).toContain(docId);

    await request(server)
      .get(`/api/documents/${docId}/hierarchy`)
      .set(auth(tok))
      .expect(200);
  });

  it("mints an RTC token for a document (editor for an EDIT-capable token)", async () => {
    const tok = (
      await createToken(alice.token, {
        name: `rtc_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;
    const doc = await createDoc(tok).expect(201);

    const res = await request(server)
      .post(`/api/documents/${doc.body.id}/rtc-token`)
      .set(auth(tok))
      .expect(201);
    expect(res.body.role).toBe("editor");
    expect(typeof res.body.token).toBe("string");
  });

  it("a VIEW token reads but cannot write", async () => {
    const tok = (
      await createToken(ownerToken, {
        name: `viewer_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "VIEW",
      }).expect(201)
    ).body.token;
    // Seed a doc as the owner, then read it through the VIEW token.
    const doc = await createDoc(ownerToken, wsA).expect(201);
    await request(server)
      .get(`/api/documents/${doc.body.id}`)
      .set(auth(tok))
      .expect(200);
    // ...but creating is forbidden (READ < EDIT).
    await createDoc(tok, wsA).expect(403);
    // ...and its RTC token is viewer, not editor.
    const rtc = await request(server)
      .post(`/api/documents/${doc.body.id}/rtc-token`)
      .set(auth(tok))
      .expect(201);
    expect(rtc.body.role).toBe("viewer");
  });

  it("REALM token operates across workspaces like a member", async () => {
    const tok = (
      await createToken(ownerToken, {
        name: `realm_use_${stamp}`,
        scope: "REALM",
        permission: "EDIT",
      }).expect(201)
    ).body.token;

    await request(server).get("/api/workspaces").set(auth(tok)).expect(200);
    // Create a folder in each workspace (explicit id — a REALM token has no default).
    await request(server)
      .post("/api/folders")
      .set(auth(tok))
      .send({ name: `rf_a_${stamp}`, workspaceId: wsA })
      .expect(201);
    await request(server)
      .post("/api/folders")
      .set(auth(tok))
      .send({ name: `rf_b_${stamp}`, workspaceId: wsB })
      .expect(201);
  });

  // --------------------------------------------- full API surface, via a token

  it("documents: full lifecycle through an EDIT token", async () => {
    const tok = (
      await createToken(alice.token, {
        name: `doclife_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;

    const doc = (await createDoc(tok).expect(201)).body;
    const folder = (
      await request(server)
        .post("/api/folders")
        .set(auth(tok))
        .send({ name: `df_${stamp}` })
        .expect(201)
    ).body;

    await request(server)
      .patch(`/api/documents/${doc.id}`)
      .set(auth(tok))
      .send({ title: "renamed" })
      .expect(200);
    await request(server)
      .patch(`/api/documents/${doc.id}/move`)
      .set(auth(tok))
      .send({ folderId: folder.id })
      .expect(200);
    await request(server)
      .get(`/api/documents/${doc.id}/subdocs`)
      .set(auth(tok))
      .expect(200);
    // (/history proxies to the rtc-server, which isn't booted in this backend-only suite.)
    // Deleting is an ADMIN op, so an EDIT-ceiling token can't — even for a doc it created (403).
    await request(server)
      .delete(`/api/documents/${doc.id}`)
      .set(auth(tok))
      .expect(403);
    // ...but the owner's ADMIN session (no token ceiling) can delete it.
    await request(server)
      .delete(`/api/documents/${doc.id}`)
      .set(auth(ownerToken))
      .expect(200);
  });

  it("folders: full lifecycle through an EDIT token", async () => {
    const tok = (
      await createToken(alice.token, {
        name: `folderlife_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;

    const parent = (
      await request(server)
        .post("/api/folders")
        .set(auth(tok))
        .send({ name: `fp_${stamp}` })
        .expect(201)
    ).body;
    const child = (
      await request(server)
        .post("/api/folders")
        .set(auth(tok))
        .send({ name: `fc_${stamp}` })
        .expect(201)
    ).body;

    await request(server)
      .patch(`/api/folders/${child.id}`)
      .set(auth(tok))
      .send({ name: "renamed" })
      .expect(200);
    await request(server)
      .patch(`/api/folders/${child.id}/move`)
      .set(auth(tok))
      .send({ parentId: parent.id })
      .expect(200);
    await request(server)
      .delete(`/api/folders/${parent.id}`)
      .set(auth(tok))
      .expect(200);
  });

  it("workspaces: read + member management through a REALM MAINTAINER token", async () => {
    const tok = (
      await createToken(ownerToken, {
        name: `wsadmin_${stamp}`,
        scope: "REALM",
        permission: "MAINTAINER",
      }).expect(201)
    ).body.token;

    await request(server).get("/api/workspaces").set(auth(tok)).expect(200);
    await request(server).get("/api/workspaces/discoverable").set(auth(tok)).expect(200);
    await request(server).get(`/api/workspaces/${wsA}`).set(auth(tok)).expect(200);
    await request(server).get("/api/workspaces/join-requests").set(auth(tok)).expect(200);

    // Create a workspace (realm MAINTAINER op) through the token.
    const newWs = (
      await request(server)
        .post("/api/workspaces")
        .set(auth(tok))
        .send({ name: `wsNew_${stamp}` })
        .expect(201)
    ).body;

    // Add → update → remove a member, all through the token.
    const bob = await register("bob");
    await request(server)
      .post("/api/realm/users")
      .set(auth(tok))
      .send({ email: bob.email, role: "MEMBER" })
      .expect(201);
    await request(server)
      .post(`/api/workspaces/${newWs.id}/users`)
      .set(auth(tok))
      .send({ email: bob.email, role: "READ" })
      .expect(201);
    await request(server)
      .get(`/api/workspaces/${newWs.id}/users`)
      .set(auth(tok))
      .expect(200);
    await request(server)
      .patch(`/api/workspaces/${newWs.id}/users/${bob.id}`)
      .set(auth(tok))
      .send({ role: "EDIT" })
      .expect(200);
    await request(server)
      .delete(`/api/workspaces/${newWs.id}/users/${bob.id}`)
      .set(auth(tok))
      .expect(200);
  });

  it("realm: read + member management through a REALM MAINTAINER token", async () => {
    const tok = (
      await createToken(ownerToken, {
        name: `realmadmin_${stamp}`,
        scope: "REALM",
        permission: "MAINTAINER",
      }).expect(201)
    ).body.token;

    const ctx = await request(server).get("/api/realm").set(auth(tok)).expect(200);
    expect(ctx.body.id).toBe(REALM_ID);
    await request(server).get("/api/realm/users").set(auth(tok)).expect(200);

    const carol = await register("carol");
    await request(server)
      .post("/api/realm/users")
      .set(auth(tok))
      .send({ email: carol.email, role: "MEMBER" })
      .expect(201);
    // A MAINTAINER-capped token cannot grant MAINTAINER (owner-only authority).
    const dave = await register("dave");
    await request(server)
      .post("/api/realm/users")
      .set(auth(tok))
      .send({ email: dave.email, role: "MAINTAINER" })
      .expect(403);
    await request(server)
      .delete(`/api/realm/users/${carol.id}`)
      .set(auth(tok))
      .expect(200);
  });

  it("uploads: a token can upload, and the object is served back", async () => {
    const tok = (
      await createToken(alice.token, {
        name: `upload_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;

    const up = await request(server)
      .post("/api/uploads")
      .set(auth(tok))
      .attach("file", Buffer.from("hello"), "hello.txt")
      .expect(201);
    expect(up.body).toHaveProperty("key");
    await request(server).get(`/api/uploads/${up.body.key}`).expect(200);
  });

  // ----------------------------------------------------- RTC editor/viewer gate

  it("RTC: an EDIT token mints an editor RTC token (may send updates)", async () => {
    const tok = (
      await createToken(alice.token, {
        name: `rtc_edit_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;
    const doc = (await createDoc(tok).expect(201)).body;

    const res = await request(server)
      .post(`/api/documents/${doc.id}/rtc-token`)
      .set(auth(tok))
      .expect(201);
    expect(res.body.role).toBe("editor");
    const claims = decodeJwtPayload(res.body.token);
    expect(claims.role).toBe("editor"); // rtc-server accepts write frames
    expect(claims.docId).toBe(doc.id);
    expect(claims.sub).toBe(alice.id); // acts as the creator
  });

  it("RTC: a COMMENT token mints a viewer RTC token (read-only — writes dropped)", async () => {
    // Seed a doc as owner, then mint a COMMENT token confined to A.
    const doc = (await createDoc(ownerToken, wsA).expect(201)).body;
    const tok = (
      await createToken(ownerToken, {
        name: `rtc_comment_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "COMMENT",
      }).expect(201)
    ).body.token;

    const res = await request(server)
      .post(`/api/documents/${doc.id}/rtc-token`)
      .set(auth(tok))
      .expect(201);
    expect(res.body.role).toBe("viewer");
    expect(decodeJwtPayload(res.body.token).role).toBe("viewer");
  });

  it("RTC: a confined token cannot mint a token for another workspace's doc", async () => {
    const docInB = (await createDoc(ownerToken, wsB).expect(201)).body;
    const tok = (
      await createToken(ownerToken, {
        name: `rtc_confined_${stamp}`,
        scope: "WORKSPACE",
        workspaceId: wsA,
        permission: "EDIT",
      }).expect(201)
    ).body.token;
    await request(server)
      .post(`/api/documents/${docInB.id}/rtc-token`)
      .set(auth(tok))
      .expect(404);
  });

  // ----------------------------------------------------------- lifecycle/guards

  it("a token cannot mint or revoke tokens", async () => {
    const tok = (
      await createToken(ownerToken, {
        name: `noescalate_${stamp}`,
        scope: "REALM",
        permission: "ADMIN",
      }).expect(201)
    ).body.token;
    await createToken(tok, {
      name: `child_${stamp}`,
      scope: "REALM",
      permission: "ADMIN",
    }).expect(403);
    await request(server).get("/api/personal-access-tokens").set(auth(tok)).expect(403);
  });

  it("revoked and expired tokens are rejected (401)", async () => {
    const created = await createToken(ownerToken, {
      name: `revoke_${stamp}`,
      scope: "WORKSPACE",
      workspaceId: wsA,
      permission: "EDIT",
    }).expect(201);
    const raw = created.body.token;
    await createDoc(raw, wsA).expect(201);

    await request(server)
      .delete(`/api/personal-access-tokens/${created.body.accessToken.id}`)
      .set(auth(ownerToken))
      .expect(200);
    await createDoc(raw, wsA).expect(401);

    // Directly insert an already-expired token and confirm it's refused.
    const expiredRaw = `ctk_expired_${stamp}`;
    await db.personalAccessToken.create({
      data: {
        name: `expired_${stamp}`,
        tokenHash: createHash("sha256").update(expiredRaw).digest("hex"),
        prefix: expiredRaw.slice(0, 12),
        scope: "WORKSPACE",
        permission: "EDIT",
        workspaceId: wsA,
        createdById: alice.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await createDoc(expiredRaw, wsA).expect(401);
  });
});
