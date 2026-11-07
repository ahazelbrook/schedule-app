-- Migration 0010: an index on the transcript's time (08/11/2026). ADDITIVE ONLY: one index, nothing altered, so the previous
-- Worker runs against this schema unchanged. IF NOT EXISTS, as in 0004. The same statement is in schema.sql and functions/_lib/db.js.
--
-- Why: every assist seat reads "the last few minutes" with WHERE campaign = ? AND at >= ?. With no index on `at`, D1 walked every
-- line ever kept to find them: about 12,100 rows a read and 5.34M rows on the 07/11 night, past the free tier's 5M a day.
-- The read itself (functions/_lib/stt.js linesStmt) now orders by `at` too, so the planner keeps this index once it has stats.
CREATE INDEX IF NOT EXISTS gm_transcript_at ON gm_transcript (campaign, at);
