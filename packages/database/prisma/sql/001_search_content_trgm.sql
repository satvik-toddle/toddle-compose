-- Denormalized content search: content_text on documents + trigram indexes so title AND
-- content search run as one indexed query in the backend DB (no rtc round-trip). Prisma
-- can't express pg_trgm GIN indexes, so this is applied as raw SQL (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_text text;

-- Substring (ILIKE '%q%') search is index-accelerated via trigram GIN (q >= 3 chars).
CREATE INDEX IF NOT EXISTS documents_content_text_trgm
  ON documents USING gin (content_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_title_trgm
  ON documents USING gin (title gin_trgm_ops);
