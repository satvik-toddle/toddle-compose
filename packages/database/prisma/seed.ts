import { PrismaClient } from "../generated/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASSWORD = "password123";

// Realm bootstrap. Defaults mirror .env.example so the seeded realm id matches the
// backend's REALM_ID even when the seed is run without the root .env loaded.
const REALM_ID = process.env.REALM_ID ?? "realm_toddle";
const REALM_NAME = process.env.REALM_NAME ?? "Toddle";
const OWNER_EMAIL = process.env.REALM_OWNER_EMAIL ?? "owner@toddle.test";
const OWNER_PASSWORD = process.env.REALM_OWNER_PASSWORD ?? PASSWORD;
const OWNER_NAME = process.env.REALM_OWNER_NAME ?? "Realm Owner";

const USERS = [
  { email: "alice@toddle.test", name: "Alice", color: "#f04c54" },
  { email: "bob@toddle.test", name: "Bob", color: "#5a5ae2" },
  { email: "carol@toddle.test", name: "Carol", color: "#00ac8a" },
  { email: "dave@toddle.test", name: "Dave", color: "#e8653a" },
  { email: "eve@toddle.test", name: "Eve", color: "#b646ee" },
  { email: "frank@toddle.test", name: "Frank", color: "#00b0c2" },
  { email: "grace@toddle.test", name: "Grace", color: "#ef4371" },
  { email: "heidi@toddle.test", name: "Heidi", color: "#d67d00" },
  { email: "ivan@toddle.test", name: "Ivan", color: "#6d9c00" },
  { email: "judy@toddle.test", name: "Judy", color: "#a43dd7" },
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, color: u.color },
      create: { email: u.email, name: u.name, color: u.color, passwordHash },
    });
  }
  console.log(`Seeded ${USERS.length} demo users. Login password for all: "${PASSWORD}"`);
  for (const u of USERS) console.log(`  - ${u.email}`);

  // Realm + static owner. The backend (REALM_ID) refuses to boot without this realm row.
  const realm = await prisma.realm.upsert({
    where: { id: REALM_ID },
    update: { name: REALM_NAME },
    create: { id: REALM_ID, name: REALM_NAME },
  });

  const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { name: OWNER_NAME },
    create: {
      email: OWNER_EMAIL,
      name: OWNER_NAME,
      color: "#f04c54",
      passwordHash: ownerHash,
    },
  });

  await prisma.realmMember.upsert({
    where: { realmId_userId: { realmId: realm.id, userId: owner.id } },
    update: { role: "OWNER" },
    create: { realmId: realm.id, userId: owner.id, role: "OWNER" },
  });

  console.log(
    `\nRealm "${realm.name}" (${realm.id}) ready.\n` +
      `  Owner: ${OWNER_EMAIL} / "${OWNER_PASSWORD}" (role OWNER)\n` +
      `  Set REALM_ID=${realm.id} in your .env.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
