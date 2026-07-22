// One-off manual backfill: copy rtc_documents.content_text -> documents.content_text (separate DBs).
// Normally unnecessary — the indexer worker backfills missing rows on boot (INDEXER_BACKFILL_ON_BOOT);
// kept only for an out-of-band re-run. Requires DATABASE_URL and RTC_DATABASE_URL in the environment.
const { Client } = require('pg');
const BACKEND = process.env.DATABASE_URL;
const RTC = process.env.RTC_DATABASE_URL;
if (!BACKEND || !RTC) {
  console.error('Set DATABASE_URL (backend) and RTC_DATABASE_URL (rtc) before running.');
  process.exit(1);
}
(async () => {
  const rtc = new Client({ connectionString: RTC });
  const be = new Client({ connectionString: BACKEND });
  await rtc.connect(); await be.connect();
  const { rows } = await rtc.query("SELECT id, content_text FROM rtc_documents WHERE content_text IS NOT NULL");
  console.log(`${rows.length} rtc rows with content`);
  let done = 0, updated = 0;
  for (const r of rows) {
    const res = await be.query("UPDATE documents SET content_text = $1 WHERE id = $2", [r.content_text, r.id]);
    done++; updated += res.rowCount;
    if (done % 100 === 0) console.log(`${done}/${rows.length}`);
  }
  console.log(`backfill done: ${updated}/${done} matched a backend doc`);
  await rtc.end(); await be.end();
})().catch(e => { console.error(e); process.exit(1); });
