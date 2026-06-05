import { PrismaClient } from "../generated/client";
import bcrypt from "bcryptjs";

/**
 * Demo seed — LOCAL/dev convenience (shared password). Self-contained and
 * idempotent: it upserts the realm and a fixed cast of realm members so a fresh
 * `db push --force-reset` lands in a known state. Composes with `db:init`
 * (which also bootstraps the realm + owner). Do NOT run in production.
 *
 * Realm cast: 1 OWNER · 2 MAINTAINERs · 2 MEMBERs.
 */
const prisma = new PrismaClient();

const BCRYPT_COST = 12; // matches the auth service
const PASSWORD = process.env.REALM_OWNER_PASSWORD ?? "password123";
const REALM_ID = process.env.REALM_ID ?? "realm_toddle";
const REALM_NAME = process.env.REALM_NAME ?? "Toddle";
const OWNER_EMAIL = process.env.REALM_OWNER_EMAIL ?? "owner@toddle.test";
const OWNER_NAME = process.env.REALM_OWNER_NAME ?? "Realm Owner";

type RealmRole = "OWNER" | "MAINTAINER" | "MEMBER";
type Seed = { email: string; name: string; color: string; role: RealmRole };

const PEOPLE: Seed[] = [
  { email: OWNER_EMAIL, name: OWNER_NAME, color: "#f04c54", role: "OWNER" },
  { email: "alice@toddle.test", name: "Alice", color: "#5a5ae2", role: "MAINTAINER" },
  { email: "bob@toddle.test", name: "Bob", color: "#00ac8a", role: "MAINTAINER" },
  { email: "carol@toddle.test", name: "Carol", color: "#e8653a", role: "MEMBER" },
  { email: "dave@toddle.test", name: "Dave", color: "#b646ee", role: "MEMBER" },
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_COST);

  const realm = await prisma.realm.upsert({
    where: { id: REALM_ID },
    update: { name: REALM_NAME },
    create: { id: REALM_ID, name: REALM_NAME },
  });

  for (const p of PEOPLE) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: { name: p.name, color: p.color },
      create: { email: p.email, name: p.name, color: p.color, passwordHash },
    });
    await prisma.realmMember.upsert({
      where: { realmId_userId: { realmId: realm.id, userId: user.id } },
      update: { role: p.role },
      create: { realmId: realm.id, userId: user.id, role: p.role },
    });
  }

  console.log(`Seeded realm "${realm.name}" (${realm.id}) with ${PEOPLE.length} members:`);
  for (const p of PEOPLE) console.log(`  - ${p.email.padEnd(22)} ${p.role}`);
  console.log(`\nLogin password for all demo users: "${PASSWORD}"`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
