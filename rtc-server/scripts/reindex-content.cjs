#!/usr/bin/env node
// Backfill content_text for every RTC doc by re-extracting plain text from its yjsState.
//   node scripts/reindex-content.cjs
// Reads RTC_DATABASE_URL from the environment (or ../.env). Best-effort: logs
// progress and continues past per-doc extraction/update errors.
const path = require('path');
const fs = require('fs');

// Load RTC_DATABASE_URL from repo root .env if not already set.
if (!process.env.RTC_DATABASE_URL) {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*RTC_DATABASE_URL\s*=\s*(.+)\s*$/);
      if (m) process.env.RTC_DATABASE_URL = m[1].replace(/^["']|["']$/g, '');
    }
  }
}

const { PrismaClient } = require(
  path.resolve(__dirname, '../../packages/rtc-database/generated/client'),
);
// Prisma 7 requires a driver adapter to instantiate the client.
const { PrismaPg } = require('@prisma/adapter-pg');
// Compiled server extractor (the same code the running server uses); requires a prior `nest build`.
const { extractFromBytesSync } = require(
  path.resolve(__dirname, '../dist/persistence/lexical-extract.core.js'),
);
// Compiled sheet extractor (same branch the server's extractText uses); requires a prior `nest build`.
const { probeSheet, sheetToSearchText } = require(
  path.resolve(__dirname, '../dist/persistence/searchable-text.js'),
);

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.RTC_DATABASE_URL }),
  });
  let scanned = 0;
  let updated = 0;
  let failed = 0;
  try {
    const docs = await prisma.rtcDocument.findMany({
      where: { yjsState: { not: null } },
      select: { id: true, yjsState: true },
    });
    console.log(`reindex: ${docs.length} doc(s) with a snapshot`);
    for (const doc of docs) {
      scanned += 1;
      try {
        const bytes = new Uint8Array(doc.yjsState);
        const sheet = probeSheet(bytes);
        const text = sheet ? sheetToSearchText(sheet) : extractFromBytesSync(bytes).plainText;
        await prisma.rtcDocument.update({
          where: { id: doc.id },
          data: { contentText: text },
        });
        updated += 1;
        console.log(`  [${scanned}/${docs.length}] ${doc.id} → ${text.length}ch${sheet ? ' (sheet)' : ''}`);
      } catch (e) {
        failed += 1;
        console.error(`  [${scanned}/${docs.length}] ${doc.id} FAILED:`, e && e.message ? e.message : e);
      }
    }
    console.log(`reindex done: updated=${updated} failed=${failed} scanned=${scanned}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
