-- Migration: email verification + password reset
-- ------------------------------------------------------------------------------
-- Adds User.email_verified_at and the two single-use token tables.
--
-- LEGACY USERS ARE INTENTIONALLY LEFT UNVERIFIED.
-- email_verified_at is added as a NULLABLE column with NO backfill, so every
-- pre-existing/organic user row keeps NULL = unverified. Login refuses an
-- unverified account (403 EMAIL_NOT_VERIFIED); those users become verified by
-- completing the sign-up verification email or a password reset (both prove
-- ownership of the address). Do NOT add an `UPDATE users SET email_verified_at`
-- here — that would silently auto-verify accounts whose emails were never
-- confirmed.
--
-- The deploy path applies the schema via `pnpm db:push` (Prisma has no managed
-- migrations dir in this repo); this file is the explicit, reviewable record of
-- the DDL and can also be applied directly:
--   prisma db execute --url "$DATABASE_URL" --file migrations/20260624_add_email_verification.sql
-- It is idempotent (IF NOT EXISTS guards), so re-running is safe.
-- ------------------------------------------------------------------------------

-- 1. Verification state on the user (nullable, no backfill).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);

-- 2. Sign-up email verification tokens (hashed, short-lived, single-use).
CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
    "id"          TEXT NOT NULL,
    "user_id"     TEXT NOT NULL,
    "token_hash"  TEXT NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_token_hash_key"
    ON "email_verification_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_user_id_idx"
    ON "email_verification_tokens" ("user_id");

-- 3. Forgot-password reset tokens (same shape).
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id"          TEXT NOT NULL,
    "user_id"     TEXT NOT NULL,
    "token_hash"  TEXT NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_key"
    ON "password_reset_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx"
    ON "password_reset_tokens" ("user_id");

-- 4. Foreign keys (cascade on user delete), added idempotently.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_verification_tokens_user_id_fkey') THEN
    ALTER TABLE "email_verification_tokens"
      ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_tokens_user_id_fkey') THEN
    ALTER TABLE "password_reset_tokens"
      ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
