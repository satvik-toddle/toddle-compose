-- Migration: document stars (per-user "favorites")
-- Adds the document_stars join table (one row = a user starred a document).
-- Composite PK makes starring idempotent; both FKs cascade on delete.
-- Applied via `pnpm db:push`; idempotent (IF NOT EXISTS), so re-running is safe.

-- 1. The join table.
CREATE TABLE IF NOT EXISTS "document_stars" (
    "user_id"     TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_stars_pkey" PRIMARY KEY ("user_id", "document_id")
);

-- 2. Secondary index for lookups/cascades by document (PK already covers by-user).
CREATE INDEX IF NOT EXISTS "document_stars_document_id_idx"
    ON "document_stars" ("document_id");

-- 3. Foreign keys (cascade on user/document delete), added idempotently.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_stars_user_id_fkey') THEN
    ALTER TABLE "document_stars"
      ADD CONSTRAINT "document_stars_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_stars_document_id_fkey') THEN
    ALTER TABLE "document_stars"
      ADD CONSTRAINT "document_stars_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
