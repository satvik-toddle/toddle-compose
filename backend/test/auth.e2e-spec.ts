import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { SignJWT } from "jose";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

/** Sign an HS256 access-type JWT the same way the backend does, for crafting edge-case tokens. */
async function signUserToken(
  payload: Record<string, unknown>,
  expSecondsFromNow: number,
  secret = process.env.JWT_USER_SECRET ?? "dev-user-jwt-secret-change-me"
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ type: "access", ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + expSecondsFromNow)
    .sign(new TextEncoder().encode(secret));
}

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

/**
 * End-to-end coverage for the "till user creation" flows + access/refresh tokens:
 *   health · JWKS · register · login · refresh · logout · /auth/me · /api/users
 *
 * Boots the real AppModule against the configured DATABASE_URL, so it requires a
 * migrated Postgres (see backend/routes.md → "Running the tests"). Uses unique
 * emails per run and cleans them up, so it is repeatable and does not pollute seed data.
 */
describe("Auth / Users (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const user = {
    email: `e2e+${stamp}@toddle.test`,
    password: "password123",
    name: "E2E Tester",
  };
  let accessToken = "";
  let accessExpiresIn = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts so routes/validation match production behaviour.
    app.setGlobalPrefix("api", {
      exclude: ["health", ".well-known/rtc-jwks.json"],
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Cascade also removes any refresh tokens for these users.
    await prisma.user.deleteMany({
      where: { email: { contains: `+${stamp}@toddle.test` } },
    });
    await app.close();
  });

  /** Register, force-verify (independent of the email-bypass mode), then log in → a real token pair. */
  async function registerVerifiedAndLogin(
    email: string,
    name: string,
    password = "password123"
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email, password, name })
      .expect(201);
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password })
      .expect(201);
    return res.body;
  }

  // ---- infra ----

  it("GET /health → 200 ok (no /api prefix)", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /.well-known/rtc-jwks.json → 200 RSA public JWK (kid, no private exponent)", async () => {
    const res = await request(app.getHttpServer())
      .get("/.well-known/rtc-jwks.json")
      .expect(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(res.body.keys[0].kty).toBe("RSA");
    expect(res.body.keys[0].use).toBe("sig");
    expect(res.body.keys[0].kid).toBe("rtc-key-1");
    expect(res.body.keys[0].alg).toBe("RS256");
    expect(res.body.keys[0]).not.toHaveProperty("d");
  });

  // ---- register ----

  it("POST /api/auth/register → 201 verification pending (no session issued)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send(user)
      .expect(201);
    // Registration starts email verification instead of auto-logging-in.
    expect(res.body.status).toBe("verification_sent");
    expect(res.body.email).toBe(user.email);
    expect(res.body).not.toHaveProperty("accessToken");
    expect(res.body).not.toHaveProperty("refreshToken");

    // Verify (bypass-independent), then capture a real session from login for the tests below.
    await prisma.user.update({ where: { email: user.email }, data: { emailVerifiedAt: new Date() } });
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password })
      .expect(201);
    expect(login.body.expiresIn).toBeGreaterThan(0);
    expect(login.body.user.email).toBe(user.email);
    expect(login.body.user).not.toHaveProperty("passwordHash");
    accessToken = login.body.accessToken;
    accessExpiresIn = login.body.expiresIn;
  });

  it("access token is type=access and lives exactly ACCESS_TOKEN_TTL_SEC", () => {
    const payload = decodeJwt(accessToken) as { type: string; exp: number; iat: number };
    expect(payload.type).toBe("access");
    expect(accessExpiresIn).toBeGreaterThan(0);
    // Reads the configured TTL via the API's expiresIn, so it holds for any env value.
    expect(payload.exp - payload.iat).toBe(accessExpiresIn);
  });

  it("POST /api/auth/register duplicate → 409", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send(user)
      .expect(409);
  });

  it("POST /api/auth/register empty body → 400", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({})
      .expect(400);
  });

  it("POST /api/auth/register missing each required field → 400", async () => {
    const base = { email: `v+${stamp}@toddle.test`, password: "password123", name: "V" };
    for (const field of ["email", "password", "name"] as const) {
      const body: Record<string, unknown> = { ...base };
      delete body[field];
      await request(app.getHttpServer())
        .post("/api/auth/register")
        .send(body)
        .expect(400);
    }
  });

  it("POST /api/auth/register password too short (5) → 400", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: `short+${stamp}@toddle.test`, password: "12345", name: "Sh" })
      .expect(400);
  });

  it("POST /api/auth/register password too long (>200) → 400", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: `long+${stamp}@toddle.test`, password: "p".repeat(201), name: "Lo" })
      .expect(400);
  });

  it("POST /api/auth/register name too long (>120) → 400", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: `name+${stamp}@toddle.test`, password: "password123", name: "n".repeat(121) })
      .expect(400);
  });

  it("POST /api/auth/register ignores unexpected fields (no over-posting)", async () => {
    const email = `extra+${stamp}@toddle.test`;
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email, password: "password123", name: "Extra", role: "admin", id: "spoofed-id" })
      .expect(201);
    // Over-posting guard: the account gets a server-generated id, never the client-supplied one.
    const created = await prisma.user.findUnique({ where: { email } });
    expect(created).not.toBeNull();
    expect(created!.id).not.toBe("spoofed-id");
  });

  // ---- login ----

  it("POST /api/auth/login correct credentials → access + refresh", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password })
      .expect(201);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
  });

  it("POST /api/auth/login wrong password → 401", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: user.email, password: "wrong-password" })
      .expect(401);
  });

  it("POST /api/auth/login non-existent email → 401", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: `nobody+${stamp}@toddle.test`, password: "password123" })
      .expect(401);
  });

  it("POST /api/auth/login invalid payload (missing password) → 400", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: user.email })
      .expect(400);
  });

  it("POST /api/auth/login unverified account → 403 EMAIL_NOT_VERIFIED", async () => {
    const email = `unverified+${stamp}@toddle.test`;
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email, password: "password123", name: "Unv" })
      .expect(201);
    // Force the unverified state regardless of the email-bypass mode.
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: null } });
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "password123" })
      .expect(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  // ---- refresh / logout ----

  it("POST /api/auth/refresh rotates the pair; reuse of old token → 401", async () => {
    const { refreshToken: r1 } = await registerVerifiedAndLogin(
      `rot+${stamp}@toddle.test`,
      "Rot"
    );

    const rotated = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({ refreshToken: r1 })
      .expect(201);
    expect(typeof rotated.body.accessToken).toBe("string");
    expect(typeof rotated.body.refreshToken).toBe("string");
    expect(rotated.body.refreshToken).not.toBe(r1); // rotated

    // Reusing the now-rotated token is rejected (and revokes the family).
    await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({ refreshToken: r1 })
      .expect(401);

    // The freshly-issued token is also dead after the reuse-triggered family revoke.
    await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it("POST /api/auth/refresh with unknown token → 401", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({ refreshToken: "not-a-real-token" })
      .expect(401);
  });

  it("POST /api/auth/refresh with empty payload → 400", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({})
      .expect(400);
  });

  it("POST /api/auth/logout invalidates the refresh token", async () => {
    const { refreshToken: r } = await registerVerifiedAndLogin(
      `out+${stamp}@toddle.test`,
      "Out"
    );

    await request(app.getHttpServer())
      .post("/api/auth/logout")
      .send({ refreshToken: r })
      .expect(201);

    // Token no longer usable.
    await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({ refreshToken: r })
      .expect(401);

    // Logout is idempotent.
    await request(app.getHttpServer())
      .post("/api/auth/logout")
      .send({ refreshToken: r })
      .expect(201);
  });

  // ---- /auth/me + guard ----

  it("GET /api/auth/me with access token → 200 current user", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.user.email).toBe(user.email);
  });

  it("GET /api/auth/me without token → 401", async () => {
    await request(app.getHttpServer()).get("/api/auth/me").expect(401);
  });

  it("GET /api/auth/me with non-Bearer scheme → 401", async () => {
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Token ${accessToken}`)
      .expect(401);
  });

  it("GET /api/auth/me with tampered signature → 401", async () => {
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken.slice(0, -2)}xx`)
      .expect(401);
  });

  it("GET /api/auth/me with wrong-secret token → 401", async () => {
    const forged = await signUserToken({ sub: "x", email: user.email }, 3600, "different-secret");
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${forged}`)
      .expect(401);
  });

  it("GET /api/auth/me with expired token → 401", async () => {
    const expired = await signUserToken({ sub: "x", email: user.email }, -60);
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);
  });

  it("GET /api/auth/me with a refresh-type token used as bearer → 401", async () => {
    const refreshTyped = await signUserToken({ sub: "x", email: user.email, type: "refresh" }, 3600);
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${refreshTyped}`)
      .expect(401);
  });

  it("GET /api/auth/me with valid token but deleted user → 401", async () => {
    const ghost = await prisma.user.create({
      data: { email: `ghost+${stamp}@toddle.test`, name: "Ghost", color: "#000", passwordHash: "x" },
    });
    const ghostToken = await signUserToken({ sub: ghost.id, email: ghost.email }, 3600);
    await prisma.user.delete({ where: { id: ghost.id } });
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${ghostToken}`)
      .expect(401);
  });

  // ---- no-leak ----

  it("never leaks passwordHash on /me", async () => {
    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.user).not.toHaveProperty("passwordHash");
  });
});
