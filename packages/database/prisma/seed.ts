import { PrismaClient } from "../generated/client";
import bcrypt from "bcryptjs";

// Demo users only — LOCAL/dev convenience (shared password). Do NOT run in production.
const prisma = new PrismaClient();

const PASSWORD = "password123";

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
  console.log(`\nRealm + owner come from \`pnpm db:init\` — run it first if you haven't.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
