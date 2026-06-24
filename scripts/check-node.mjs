// Preinstall guard: fail fast with a clear message when the active Node version
// is below the floor required by package.json#engines.node
// (^20.19 || ^22.12 || >=24.0).
//
// Why this exists: Prisma 7's CLI require()s an ESM dependency, which is only
// unflagged on Node >=20.19 / >=22.12. On older versions `prisma generate`
// dies with a cryptic `ERR_REQUIRE_ESM` deep inside @prisma/dev. This guard
// surfaces the real cause at install time instead.
//
// It validates ONLY the root engines range — unlike pnpm's `engine-strict`,
// which also enforces every dependency's engines and would wrongly reject the
// allowed Node >=24 path (a workspace dep caps at <23).
//
// Zero dependencies on purpose: this runs before `pnpm install` resolves the
// dependency tree, so it can only use the Node standard library.

const REQUIRED = '^20.19 || ^22.12 || >=24.0';

const [major, minor] = process.versions.node.split('.').map(Number);

const ok =
  (major === 20 && minor >= 19) ||
  (major === 22 && minor >= 12) ||
  major >= 24;

if (!ok) {
  console.error(
    `\n\x1b[31m✖ Unsupported Node.js version: ${process.version}\x1b[0m\n` +
      `  This project requires Node "${REQUIRED}" (see package.json#engines).\n` +
      `  Prisma 7's CLI fails with a cryptic ERR_REQUIRE_ESM on older versions.\n` +
      `  Switch with: nvm use   (or fnm use)  — see .node-version\n`,
  );
  process.exit(1);
}
