-- Migration 0005: a display name a member chose for themselves (PATCH /api/me).
-- `members.name` is the name from the Cloudflare Access claim (or the email's local part) and is rewritten on every
-- /api/me call; `name_override` is never touched by that sign-in upsert. The name shown anywhere is
-- COALESCE(name_override, name). NULL = no override. Additive and nullable, so older code is unaffected.
-- SQLite has no IF NOT EXISTS for ADD COLUMN: run this once, via `wrangler d1 migrations apply` (scripts/deploy.sh does,
-- before the deploy). The same column is in schema.sql and in functions/_lib/db.js (for a fresh local database).
ALTER TABLE members ADD COLUMN name_override TEXT;
