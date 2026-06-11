import { INestApplication } from "@nestjs/common";
import { auth, bootApp, http, login } from "./helpers";

/**
 * Uploads (e2e) — the object-storage upload/serve endpoints that back the doc
 * editor's image/file inserts. Boots the real AppModule (default local driver):
 *
 *   POST /api/uploads        — auth-guarded multipart upload (field "file")
 *   GET  /api/uploads/:key   — public fetch of the stored bytes
 *
 * Cast: owner@toddle.test (any authenticated realm user can upload).
 */
describe("Uploads (e2e)", () => {
  let app: INestApplication;
  let ownerTok = "";

  // A tiny but valid 1x1 PNG so content round-trips like a real image upload.
  const PNG_1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
    "base64"
  );

  beforeAll(async () => {
    app = await bootApp();
    ownerTok = await login(app, "owner@toddle.test");
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects an unauthenticated upload", async () => {
    await http(app)
      .post("/api/uploads")
      .attach("file", PNG_1x1, { filename: "x.png", contentType: "image/png" })
      .expect(401);
  });

  it("rejects an authenticated request with no file", async () => {
    await http(app).post("/api/uploads").set(auth(ownerTok)).expect(400);
  });

  it("stores an uploaded file and returns a fetchable URL", async () => {
    const res = await http(app)
      .post("/api/uploads")
      .set(auth(ownerTok))
      .attach("file", PNG_1x1, { filename: "logo.png", contentType: "image/png" })
      .expect(201);

    expect(typeof res.body.key).toBe("string");
    expect(res.body.key).toMatch(/\.png$/); // key preserves the extension
    expect(res.body.size).toBe(PNG_1x1.length);
    expect(res.body.contentType).toBe("image/png");
    expect(res.body.url).toContain(`/api/uploads/${res.body.key}`);
  });

  it("serves a stored object back byte-for-byte (public, no auth)", async () => {
    const up = await http(app)
      .post("/api/uploads")
      .set(auth(ownerTok))
      .attach("file", PNG_1x1, { filename: "pic.png", contentType: "image/png" })
      .expect(201);

    const got = await http(app)
      .get(`/api/uploads/${up.body.key}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(got.headers["content-type"]).toContain("image/png");
    expect(Buffer.compare(got.body as Buffer, PNG_1x1)).toBe(0);
  });

  it("404s an unknown key", async () => {
    await http(app).get("/api/uploads/does-not-exist.png").expect(404);
  });

  it("404s a path-traversal key instead of escaping the storage root", async () => {
    // %2e%2e%2f decodes to ../ — isSafeKey must reject it.
    await http(app).get("/api/uploads/..%2f..%2fpackage.json").expect(404);
  });
});
