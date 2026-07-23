-- Out-of-order guard for the content_text projection (search-indexing.md G3): the indexer
-- worker stamps each push with the rtc snapshot seq; the backend upsert only applies a push
-- whose seq is newer than the stored one. Applied as raw SQL for parity with 001 (a plain
-- column that `prisma db push` also creates from schema.prisma — idempotent either way).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_seq integer;
