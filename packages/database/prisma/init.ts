import { PrismaClient } from "../generated/client";
import bcrypt from "bcryptjs";

// Realm bootstrap (the backend refuses to start without a realm matching REALM_ID); prod-safe and idempotent.
const prisma = new PrismaClient();
const BCRYPT_COST = 12; // matches the auth service

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for db:init — set it in .env (local) or your secret store (prod)`
    );
  }
  return value;
}

async function main() {
  const realmId = process.env.REALM_ID ?? "realm_toddle";
  const realmName = process.env.REALM_NAME ?? "Toddle";
  const ownerEmail = required("REALM_OWNER_EMAIL");
  const ownerPassword = required("REALM_OWNER_PASSWORD");
  const ownerName = process.env.REALM_OWNER_NAME ?? "Realm Owner";

  const realm = await prisma.realm.upsert({
    where: { id: realmId },
    update: { name: realmName },
    create: { id: realmId, name: realmName },
  });

  const passwordHash = await bcrypt.hash(ownerPassword, BCRYPT_COST);
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    // Never clobber a rotated password on re-run — only set it on first create.
    // Backfill emailVerifiedAt so the owner isn't locked out by the verify gate.
    update: { name: ownerName, emailVerifiedAt: new Date() },
    create: {
      email: ownerEmail,
      name: ownerName,
      color: "#f04c54",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.realmMember.upsert({
    where: { realmId_userId: { realmId: realm.id, userId: owner.id } },
    update: { role: "OWNER" },
    create: { realmId: realm.id, userId: owner.id, role: "OWNER" },
  });

  // Intentionally does NOT print the password.
  console.log(
    `Realm "${realm.name}" (${realm.id}) initialised. Owner: ${ownerEmail} (role OWNER).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
