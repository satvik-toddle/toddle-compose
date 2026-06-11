import { PrismaClient } from "../generated/client";
import bcrypt from "bcryptjs";

/**
 * Demo seed — LOCAL/dev convenience (shared password). Self-contained and
 * idempotent: it upserts the realm and a fixed cast of realm members so a fresh
 * `db push --force-reset` lands in a known state. Composes with `db:init`
 * (which also bootstraps the realm + owner). Do NOT run in production.
 *
 * Realm cast: 1 OWNER · 1 MAINTAINER · 3 MEMBERs · 1 realm-less outsider (bob).
 * This cast is also exactly what the backend e2e suite assumes — `db:seed` must
 * leave the DB in this state for those tests to pass on a fresh clone:
 *   owner  OWNER       — workspace ADMIN everywhere via the realm overlay
 *   alice  MAINTAINER  — added per-test as a workspace EDIT member
 *   carol  MEMBER      — added per-test as a workspace READ member (no overlay)
 *   dave   MEMBER      — realm member who is NOT in the test workspace
 *   eve    MEMBER      — plain realm member, used for the self-join / request flows
 *   bob    (no realm)  — the "complete outsider": a real user with NO realm
 *                        membership, so reads of in-realm resources are denied.
 */
const prisma = new PrismaClient();

const BCRYPT_COST = 12; // matches the auth service
const PASSWORD = process.env.REALM_OWNER_PASSWORD ?? "password123";
const REALM_ID = process.env.REALM_ID ?? "realm_toddle";
const REALM_NAME = process.env.REALM_NAME ?? "Toddle";
const OWNER_EMAIL = process.env.REALM_OWNER_EMAIL ?? "owner@toddle.test";
const OWNER_NAME = process.env.REALM_OWNER_NAME ?? "Realm Owner";

type RealmRole = "OWNER" | "MAINTAINER" | "MEMBER";
// `role: null` ⇒ the user exists (can log in) but holds NO realm membership.
type Seed = { email: string; name: string; color: string; role: RealmRole | null };

const PEOPLE: Seed[] = [
  { email: OWNER_EMAIL, name: OWNER_NAME, color: "#f04c54", role: "OWNER" },
  { email: "alice@toddle.test", name: "Alice", color: "#5a5ae2", role: "MAINTAINER" },
  { email: "carol@toddle.test", name: "Carol", color: "#e8653a", role: "MEMBER" },
  { email: "dave@toddle.test", name: "Dave", color: "#b646ee", role: "MEMBER" },
  { email: "eve@toddle.test", name: "Eve", color: "#0aa5d8", role: "MEMBER" },
  { email: "bob@toddle.test", name: "Bob", color: "#00ac8a", role: null },
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
    if (p.role === null) {
      // Outsider: ensure no realm membership lingers (e.g. a prior test run that
      // approved a join request), so re-seeding is deterministic.
      await prisma.realmMember.deleteMany({
        where: { realmId: realm.id, userId: user.id },
      });
      continue;
    }
    await prisma.realmMember.upsert({
      where: { realmId_userId: { realmId: realm.id, userId: user.id } },
      update: { role: p.role },
      create: { realmId: realm.id, userId: user.id, role: p.role },
    });
  }

  console.log(`Seeded realm "${realm.name}" (${realm.id}) with ${PEOPLE.length} users:`);
  for (const p of PEOPLE) console.log(`  - ${p.email.padEnd(22)} ${p.role ?? "(no realm membership)"}`);
  console.log(`\nLogin password for all demo users: "${PASSWORD}"`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
