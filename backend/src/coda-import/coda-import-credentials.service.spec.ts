import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthzService } from "../realm/authz.service";
import type { TokenCipher } from "../migration/token-cipher";
import { CodaImportCredentialsService } from "./coda-import-credentials.service";

function makeService(opts: {
  findMany?: jest.Mock;
  findUnique?: jest.Mock;
  create?: jest.Mock;
  deleteMany?: jest.Mock;
  requireRealmRole?: jest.Mock;
}) {
  const prisma = {
    codaImportCredential: {
      findMany: opts.findMany ?? jest.fn().mockResolvedValue([]),
      findUnique: opts.findUnique ?? jest.fn().mockResolvedValue(null),
      create: opts.create ?? jest.fn(),
      deleteMany: opts.deleteMany ?? jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;

  const authz = {
    requireRealmRole:
      opts.requireRealmRole ?? jest.fn().mockResolvedValue("OWNER"),
  } as unknown as AuthzService;

  const cipher = {
    encrypt: jest.fn((plain: string) => `enc:${plain}`),
    decrypt: jest.fn((enc: string) => enc.replace(/^enc:/, "")),
  } as unknown as TokenCipher;

  return {
    svc: new CodaImportCredentialsService(prisma, authz, cipher),
    prisma,
    authz,
    cipher,
  };
}

describe("CodaImportCredentialsService.create", () => {
  it("encrypts the token, stores a last-4 hint, and never returns plaintext", async () => {
    const create = jest.fn(async ({ data }: any) => ({
      id: "c1",
      codaTokenEnc: data.codaTokenEnc,
      codaTokenHint: data.codaTokenHint,
      label: data.label,
      createdById: data.createdById,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const { svc, cipher } = makeService({ create });

    const view = await svc.create("user1", {
      token: "tok-abcd1234",
      label: "svc account",
    });

    const data = create.mock.calls[0][0].data;
    expect(data.codaTokenEnc).toBe("enc:tok-abcd1234");
    expect(data.codaTokenHint).toBe("1234");
    expect(data.createdById).toBe("user1");
    expect(cipher.encrypt).toHaveBeenCalledWith("tok-abcd1234");

    // Response is masked: hint only, no plaintext, no ciphertext.
    expect(view.hint).toBe("1234");
    expect(JSON.stringify(view)).not.toContain("tok-abcd1234");
    expect(JSON.stringify(view)).not.toContain("enc:");
  });

  it("rejects a non-realm-admin caller before touching the DB", async () => {
    const create = jest.fn();
    const { svc } = makeService({
      create,
      requireRealmRole: jest.fn().mockRejectedValue(new ForbiddenException()),
    });
    await expect(
      svc.create("user1", { token: "tok-1" }),
    ).rejects.toThrow(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("CodaImportCredentialsService.list", () => {
  it("returns masked views only (id/label/hint), never ciphertext", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "c1",
        codaTokenEnc: "enc:tok-secret-abcd",
        codaTokenHint: "abcd",
        label: "u1",
        createdById: "user1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const { svc } = makeService({ findMany });
    const views = await svc.list("user1");
    const serialized = JSON.stringify(views);
    expect(views[0].hint).toBe("abcd");
    expect(serialized).not.toContain("codaTokenEnc");
    expect(serialized).not.toContain("tok-secret");
  });
});

describe("CodaImportCredentialsService.getTokenPool", () => {
  it("decrypts every stored credential (DB is the only source — no env fallback)", async () => {
    const findMany = jest.fn().mockResolvedValue([
      { codaTokenEnc: "enc:tok-1" },
      { codaTokenEnc: "enc:tok-2" },
    ]);
    const { svc } = makeService({ findMany });
    await expect(svc.getTokenPool()).resolves.toEqual(["tok-1", "tok-2"]);
  });
});

describe("CodaImportCredentialsService.getToken", () => {
  it("decrypts the one credential picked for a job", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ codaTokenEnc: "enc:tok-picked" });
    const { svc, cipher } = makeService({ findUnique });
    await expect(svc.getToken("c1")).resolves.toBe("tok-picked");
    expect(findUnique.mock.calls[0][0].where).toEqual({ id: "c1" });
    expect(cipher.decrypt).toHaveBeenCalledWith("enc:tok-picked");
  });

  it("throws NotFound when the credential is missing or deleted", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const { svc } = makeService({ findUnique });
    await expect(svc.getToken("gone")).rejects.toThrow(NotFoundException);
  });
});
