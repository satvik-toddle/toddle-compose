import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

export const PW = "password123";

/** Boot the real AppModule the same way main.ts does (prefix + validation pipe). */
export async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api", {
    exclude: ["health", ".well-known/rtc-jwks.json"],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

export const http = (app: INestApplication) => request(app.getHttpServer());
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function login(
  app: INestApplication,
  email: string,
  password = PW
): Promise<string> {
  const res = await http(app)
    .post("/api/auth/login")
    .send({ email, password })
    .expect(201);
  return res.body.accessToken as string;
}

/** Ensure a demo/seeded user exists (register is idempotent-ish; 409 if present). */
export async function ensureUser(
  app: INestApplication,
  email: string,
  name: string
): Promise<void> {
  await http(app)
    .post("/api/auth/register")
    .send({ email, password: PW, name })
    .then(() => undefined)
    .catch(() => undefined);
}

export async function createWorkspace(
  app: INestApplication,
  token: string,
  name: string
): Promise<string> {
  const res = await http(app)
    .post("/api/workspaces")
    .set(auth(token))
    .send({ name, visibility: "PRIVATE", defaultRole: "READ" })
    .expect(201);
  return res.body.id as string;
}

export function addWorkspaceMember(
  app: INestApplication,
  token: string,
  wsId: string,
  email: string,
  role: "READ" | "COMMENT" | "EDIT" | "ADMIN"
) {
  return http(app)
    .post(`/api/workspaces/${wsId}/users`)
    .set(auth(token))
    .send({ email, role });
}

export function addRealmMember(
  app: INestApplication,
  token: string,
  email: string,
  role: "MAINTAINER" | "MEMBER"
) {
  return http(app)
    .post("/api/realm/users")
    .set(auth(token))
    .send({ email, role });
}

/** Enter a workspace → returns a workspace-scoped access token. */
export async function enterWorkspace(
  app: INestApplication,
  token: string,
  wsId: string
): Promise<string> {
  const res = await http(app)
    .post("/api/auth/workspace/enter")
    .set(auth(token))
    .send({ workspaceId: wsId })
    .expect(201);
  return res.body.accessToken as string;
}
