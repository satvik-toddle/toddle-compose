#!/usr/bin/env node
// Report the persisted storage footprint of an RTC doc by id.
//   node scripts/doc-size.cjs <docId>
// Reads RTC_DATABASE_URL from the environment (or ../.env).
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

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

async function main() {
  const docId = process.argv[2];
  if (!docId) {
    console.error('usage: node scripts/doc-size.cjs <docId>');
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.RTC_DATABASE_URL }),
  });
  try {
    const doc = await prisma.rtcDocument.findUnique({ where: { id: docId } });
    if (!doc) {
      console.error(`no rtc_documents row for id='${docId}'`);
      process.exit(2);
    }
    const snapshotBytes = doc.yjsState ? doc.yjsState.byteLength : 0;

    const agg = await prisma.rtcDocumentUpdate.aggregate({
      where: { docId },
      _sum: { byteLen: true },
      _count: { _all: true },
      _max: { seq: true },
    });
    const logBytes = agg._sum.byteLen ?? 0;
    const logRows = agg._count._all ?? 0;

    console.log(`doc:               ${docId}`);
    console.log(`version:           ${doc.version}`);
    console.log(`snapshot_at_seq:   ${doc.snapshotAtSeq}  (head seq=${agg._max.seq ?? 0})`);
    console.log(`yjsState snapshot: ${human(snapshotBytes)}`);
    console.log(`update log:        ${human(logBytes)}  across ${logRows} row(s)`);
    console.log(`total on disk:     ${human(snapshotBytes + logBytes)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
